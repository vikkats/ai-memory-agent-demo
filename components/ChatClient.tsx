"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RetrievedMemory = {
  id: string;
  score: number;
  text: string;
  source?: string | null;
  speaker?: string | null;
  timestamp?: string | null;
  payload?: Record<string, unknown>;
};

type ToolCallInfo = { name: string; ok: boolean; error?: string };

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  mock?: boolean;
  toolCalls?: ToolCallInfo[];
  retrieved?: RetrievedMemory[];
  pending?: boolean;
};

type ConversationListItem = { id: string; title: string; updatedAt: string };

type SseEvent =
  | { type: "status"; message: string }
  | { type: "meta"; conversationId: string; retrieved: RetrievedMemory[] }
  | { type: "token"; content: string }
  | { type: "tool"; name: string; ok: boolean; detail?: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

async function* readSseStream(response: Response): AsyncGenerator<SseEvent> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const raw of events) {
      const line = raw.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as SseEvent;
      } catch {
        // ignore malformed events
      }
    }
  }
}

function RetrievalInspector({ memories }: { memories: RetrievedMemory[] }) {
  if (memories.length === 0) {
    return <p className="muted">No memories cleared the score threshold for this turn.</p>;
  }
  return (
    <div className="retrieval-inspector">
      {memories.map((memory) => {
        const rankScore =
          typeof memory.payload?.rankScore === "number" ? (memory.payload.rankScore as number) : null;
        const rescued = memory.payload?.summaryRescued === true;
        const type = typeof memory.payload?.type === "string" ? (memory.payload.type as string) : "memory";
        return (
          <div key={memory.id} className="retrieval-card">
            <div className="retrieval-meta">
              <span className="badge blue">{type.replaceAll("_", " ")}</span>
              <span>score {memory.score.toFixed(3)}</span>
              {rankScore !== null ? <span>→ rank {rankScore.toFixed(3)}</span> : null}
              {rescued ? <span className="badge green">summary-rescued</span> : null}
              {memory.source ? <span className="muted">{memory.source}</span> : null}
            </div>
            <p>{memory.text.slice(0, 220)}{memory.text.length > 220 ? "…" : ""}</p>
          </div>
        );
      })}
    </div>
  );
}

export function ChatClient() {
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [inspectorFor, setInspectorFor] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    const data = (await res.json()) as { conversations: ConversationListItem[] };
    setConversations(data.conversations ?? []);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations?id=${encodeURIComponent(id)}`);
    const data = (await res.json()) as {
      messages: Array<{
        id: string;
        role: string;
        content: string;
        createdAt: string;
        metadata?: Record<string, unknown> | null;
      }>;
    };
    const loaded: UiMessage[] = (data.messages ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const toolUsage = m.metadata?.toolUsage as { calls?: ToolCallInfo[] } | undefined;
        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          createdAt: m.createdAt,
          mock: m.metadata?.mock === true,
          toolCalls: toolUsage?.calls,
        };
      });
    setMessages(loaded);
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusLine]);

  async function selectConversation(id: string) {
    setConversationId(id);
    setInspectorFor(null);
    await loadConversation(id);
  }

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setInspectorFor(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInput("");
    setStatusLine("Connecting…");

    const tempUser: UiMessage = { id: `tmp-u-${Date.now()}`, role: "user", content: text };
    const tempAssistant: UiMessage = {
      id: `tmp-a-${Date.now()}`,
      role: "assistant",
      content: "",
      pending: true,
      retrieved: [],
      toolCalls: [],
    };
    setMessages((prev) => [...prev, tempUser, tempAssistant]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversationId ?? undefined, message: text }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Chat request failed: ${response.status} ${detail}`);
      }

      for await (const event of readSseStream(response)) {
        if (event.type === "status") {
          setStatusLine(event.message);
        } else if (event.type === "meta") {
          if (!conversationId) setConversationId(event.conversationId);
          setMessages((prev) =>
            prev.map((m) => (m.id === tempAssistant.id ? { ...m, retrieved: event.retrieved } : m)),
          );
        } else if (event.type === "tool") {
          setStatusLine(`Tool: ${event.name} ${event.ok ? "✓" : "✗"}`);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAssistant.id
                ? {
                    ...m,
                    toolCalls: [
                      ...(m.toolCalls ?? []),
                      { name: event.name, ok: event.ok, error: event.ok ? undefined : event.detail },
                    ],
                  }
                : m,
            ),
          );
        } else if (event.type === "token") {
          setStatusLine(null);
          setMessages((prev) =>
            prev.map((m) => (m.id === tempAssistant.id ? { ...m, content: m.content + event.content } : m)),
          );
        } else if (event.type === "done") {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempAssistant.id ? { ...m, id: event.messageId, pending: false } : m)),
          );
        } else if (event.type === "error") {
          throw new Error(event.message);
        }
      }
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempAssistant.id
            ? {
                ...m,
                pending: false,
                content: `⚠ ${error instanceof Error ? error.message : String(error)}`,
              }
            : m,
        ),
      );
    } finally {
      setStatusLine(null);
      setBusy(false);
      void refreshConversations();
    }
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <button type="button" className="btn primary full" onClick={newConversation}>
          + New conversation
        </button>
        <div className="conversation-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.id === conversationId ? "conversation-item active" : "conversation-item"}
              onClick={() => void selectConversation(c.id)}
            >
              <span className="conversation-title">{c.title}</span>
              <span className="muted small">{c.updatedAt.slice(0, 10)}</span>
            </button>
          ))}
          {conversations.length === 0 ? <p className="muted small">No conversations yet.</p> : null}
        </div>
      </aside>

      <section className="chat-main">
        <div className="message-list">
          {messages.length === 0 ? (
            <p className="muted">
              Start a conversation. Try: <em>"What do you remember about my preferences?"</em> or{" "}
              <em>"What time is it?"</em> — the mock model routes those through real tools.
            </p>
          ) : null}
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="message-bubble">
                {message.content || (message.pending ? <span className="muted">…</span> : null)}
              </div>
              <div className="message-meta">
                {message.mock ? <span className="badge amber">mock</span> : null}
                {message.toolCalls?.map((call, i) => (
                  <span key={`${call.name}-${i}`} className={call.ok ? "badge blue" : "badge amber"}>
                    ⚙ {call.name} {call.ok ? "✓" : "✗"}
                  </span>
                ))}
                {message.role === "assistant" && message.retrieved ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setInspectorFor(inspectorFor === message.id ? null : message.id)}
                  >
                    ⌕ {message.retrieved.length} retrieved
                  </button>
                ) : null}
              </div>
              {inspectorFor === message.id && message.retrieved ? (
                <RetrievalInspector memories={message.retrieved} />
              ) : null}
            </div>
          ))}
          {statusLine ? <p className="status-line">{statusLine}</p> : null}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-row">
          <textarea
            value={input}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            rows={2}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" className="btn primary" disabled={busy || !input.trim()} onClick={() => void send()}>
            Send
          </button>
        </div>
      </section>
    </div>
  );
}
