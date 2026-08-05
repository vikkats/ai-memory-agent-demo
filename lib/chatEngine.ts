import { addMessage, createConversation, getConversation, listMessages } from "./conversations";
import { maybeAutoIndexConversation } from "./indexing";
import { resolveModelDriver } from "./mockModel";
import { buildModelMessages } from "./prompt";
import { getActiveProvider } from "./providers";
import { formatRetrievedMemories, searchMemories } from "./retrieval";
import { runToolLoop } from "./toolLoop";
import { executeRuntimeTool, listAvailableTools } from "./tools";
import type { ChatStreamEvent, ProviderSettings, RetrievedMemory } from "./types";

export const MAX_TOOL_CALLS_PER_TURN = 6;

const RETRIEVAL_QUERY_MAX_CHARS = 2000;
const PREV_ASSISTANT_CHARS = 400;

/** Build the retrieval query from the newest user turn plus a tail of the previous reply. */
function buildRetrievalQuery(conversationId: string, latestUserText: string): string {
  const recent = listMessages(conversationId, 6);
  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");
  const parts = [latestUserText];
  if (lastAssistant) parts.push(lastAssistant.content.slice(0, PREV_ASSISTANT_CHARS));
  return parts.join("\n").slice(0, RETRIEVAL_QUERY_MAX_CHARS);
}

/** Chunk a final answer into small buffers so the SSE stream visibly types. */
async function* streamTextInChunks(text: string, chunkSize = 24): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += chunkSize) {
    yield text.slice(i, i + chunkSize);
  }
}

export interface RunChatTurnArgs {
  conversationId?: string;
  message: string;
  provider?: ProviderSettings;
}

/**
 * Run one full chat turn and yield SSE-ready events as it goes:
 *   status → meta → (tool events) → token… → done | error
 * The turn persists both messages, records tool usage + retrieval metadata
 * on the assistant message, and feeds the auto-index cadence gate.
 */
export async function* runChatTurn(args: RunChatTurnArgs): AsyncGenerator<ChatStreamEvent> {
  const message = args.message.trim();
  if (!message) {
    yield { type: "error", error: "Message must not be empty." };
    return;
  }

  let provider: ProviderSettings;
  try {
    provider = args.provider ?? getActiveProvider();
  } catch (error) {
    yield { type: "error", error: error instanceof Error ? error.message : String(error) };
    return;
  }

  let conversationId = args.conversationId;
  if (conversationId && !getConversation(conversationId)) {
    yield { type: "error", error: `Conversation not found: ${conversationId}` };
    return;
  }
  if (!conversationId) {
    const title = message.split("\n")[0].slice(0, 60);
    conversationId = createConversation(title).id;
  }

  addMessage({ conversationId, role: "user", content: message });
  yield { type: "status", stage: "retrieving", conversationId };

  let retrieved: RetrievedMemory[] = [];
  let retrievalError: string | undefined;
  try {
    const query = buildRetrievalQuery(conversationId, message);
    retrieved = await searchMemories(provider, query, provider.retrievalTopK);
  } catch (error) {
    retrievalError = error instanceof Error ? error.message : String(error);
  }

  yield {
    type: "meta",
    conversationId,
    retrieved: retrieved.map((r) => ({
      id: r.id,
      source: r.source,
      score: r.score,
      rankScore: r.rankScore,
      summaryRescued: r.summaryRescued === true,
      text: r.text.slice(0, 400),
    })),
    retrievalError,
  };

  const modelMessages = buildModelMessages(provider, conversationId, retrieved);
  const tools = listAvailableTools(provider.toolsEnabled);
  const driver = resolveModelDriver(provider);

  let loopResult;
  try {
    loopResult = await runToolLoop({
      modelMessages,
      tools,
      maxToolCalls: MAX_TOOL_CALLS_PER_TURN,
      driver,
      executeTool: (name, toolArgs) => executeRuntimeTool(provider, name, toolArgs, { conversationId }),
      onToolStart: (name) => {
        // surfaced through executions below; start events are optional
        void name;
      },
    });
  } catch (error) {
    yield { type: "error", error: error instanceof Error ? error.message : String(error), conversationId };
    return;
  }

  for (const execution of loopResult.executions) {
    yield {
      type: "tool",
      conversationId,
      name: execution.name,
      ok: execution.ok,
      error: execution.error,
    };
  }

  const finalText =
    loopResult.finalText.trim() ||
    "(The model produced no text for this turn. Check the provider configuration.)";

  for await (const chunk of streamTextInChunks(finalText)) {
    yield { type: "token", conversationId, token: chunk };
  }

  const assistantMessage = addMessage({
    conversationId,
    role: "assistant",
    content: finalText,
    metadata: {
      provider: provider.name,
      model: provider.modelId,
      mock: provider.mock,
      retrievedCount: retrieved.length,
      retrievedIds: retrieved.map((r) => r.id),
      retrievalError,
      toolUsage: {
        enabled: tools.length > 0,
        calls: loopResult.executions.map((e) => ({ name: e.name, ok: e.ok, error: e.error })),
        hitToolLimit: loopResult.hitToolLimit,
      },
    },
  });

  try {
    await maybeAutoIndexConversation(provider, conversationId);
  } catch {
    // Auto-indexing is best-effort; never fail the turn over it.
  }

  yield { type: "done", conversationId, messageId: assistantMessage.id };
}

export { formatRetrievedMemories };
