import type { ProviderSettings } from "./types";
import { isMockProvider } from "./providers";
import type { ModelMessage, ModelToolCall, ModelToolDefinition } from "./openaiCompat";
import { callOpenAICompatibleDetailed } from "./openaiCompat";
import { getAppTimezone } from "./appSettings";
import { localDateTimeForPrompt } from "./time";

/**
 * A deterministic offline model. It exercises the exact same loop contract
 * as a real provider (text or tool calls), so the demo's retrieval, tool
 * loop, and check-in machinery run end-to-end with zero API keys.
 *
 * Behavior is heuristic on purpose: it demonstrates *what the architecture
 * does* (retrieve → maybe use a tool → answer with visible grounding),
 * not what a real LLM would say.
 */

export type DriverResponse = {
  text: string;
  toolCalls: ModelToolCall[];
  assistantMessage: ModelMessage;
};

export type ModelDriver = (
  messages: ModelMessage[],
  tools: ModelToolDefinition[],
) => Promise<DriverResponse>;

function lastUserText(messages: ModelMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "user" && typeof message.content === "string") return message.content;
  }
  return "";
}

function toolResultTexts(messages: ModelMessage[]) {
  return messages.filter((message) => message.role === "tool");
}

function mockToolCall(name: string, args: Record<string, unknown>): ModelToolCall {
  return {
    id: `mock_call_${name}_${Date.now()}`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function mockModel(messages: ModelMessage[], tools: ModelToolDefinition[]): DriverResponse {
  const available = new Set(tools.map((tool) => tool.function.name));
  const toolResults = toolResultTexts(messages);

  // Second pass: a tool has already run — synthesize the final answer from it.
  if (toolResults.length > 0) {
    const last = toolResults.at(-1)!;
    const text = [
      "Here's what I found using the workspace tools:",
      "",
      typeof last.content === "string" ? last.content : "",
      "",
      "_(Offline demo model — connect an OpenAI-compatible provider in Settings for real generation.)_",
    ].join("\n");
    return {
      text,
      toolCalls: [],
      assistantMessage: { role: "assistant", content: text },
    };
  }

  const userText = lastUserText(messages);
  const lowered = userText.toLowerCase();

  // Heuristic tool routing — shows the tool lane working without keys.
  if (/\b(time|date|clock)\b/.test(lowered) && available.has("get_current_time")) {
    return {
      text: "",
      toolCalls: [mockToolCall("get_current_time", {})],
      assistantMessage: {
        role: "assistant",
        content: null,
        tool_calls: [mockToolCall("get_current_time", {})],
      },
    };
  }

  if (/\b(remember|recall|memory|what do you know)\b/.test(lowered) && available.has("search_memory")) {
    return {
      text: "",
      toolCalls: [mockToolCall("search_memory", { query: userText, limit: 5 })],
      assistantMessage: {
        role: "assistant",
        content: null,
        tool_calls: [mockToolCall("search_memory", { query: userText, limit: 5 })],
      },
    };
  }

  if (/\b(summari[sz]e)\b/.test(lowered) && available.has("summarize_conversation")) {
    return {
      text: "",
      toolCalls: [mockToolCall("summarize_conversation", {})],
      assistantMessage: {
        role: "assistant",
        content: null,
        tool_calls: [mockToolCall("summarize_conversation", {})],
      },
    };
  }

  const retrievedBlock = messages
    .filter((message) => message.role === "system" && typeof message.content === "string")
    .map((message) => message.content as string)
    .join("\n");
  const retrievedCount = (retrievedBlock.match(/### Retrieved/g) ?? []).length;

  const text = [
    `You said: "${userText.slice(0, 280)}${userText.length > 280 ? "…" : ""}"`,
    "",
    `For this turn I retrieved **${retrievedCount}** semantic memor${retrievedCount === 1 ? "y" : "ies"} from the vector index, loaded the core memory stack under a token budget, and trimmed history to fit the context window.`,
    retrievedCount > 0
      ? "Open the retrieval inspector on this message to see scores, re-rank boosts, and sources."
      : "No memories matched above the score threshold yet — chat a few turns and auto-indexing will warm the index.",
    "",
    `Local time: ${localDateTimeForPrompt(new Date(), getAppTimezone())}.`,
    "",
    "_(Offline demo model — deterministic by design. Connect an OpenAI-compatible provider in Settings for real generation.)_",
  ].join("\n");

  return {
    text,
    toolCalls: [],
    assistantMessage: { role: "assistant", content: text },
  };
}

/**
 * Resolves the model driver for a provider: real OpenAI-compatible calls
 * when configured, the deterministic mock otherwise.
 */
export function resolveModelDriver(provider: ProviderSettings): ModelDriver {
  if (isMockProvider(provider)) {
    return async (messages, tools) => mockModel(messages, tools);
  }

  return async (messages, tools) => {
    const response = await callOpenAICompatibleDetailed(provider, messages, {
      tools: tools.length ? tools : undefined,
    });
    return {
      text: response.text,
      toolCalls: response.toolCalls,
      assistantMessage: response.assistantMessage,
    };
  };
}

/** Simple one-shot generation for summaries/maintenance (no tools). */
export async function generateText(provider: ProviderSettings, messages: ModelMessage[]) {
  const driver = resolveModelDriver(provider);
  const response = await driver(messages, []);
  return response.text;
}
