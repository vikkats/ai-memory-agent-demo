import type { ProviderSettings } from "./types";

/**
 * Minimal OpenAI-compatible client: non-streaming chat completions with
 * tool-call support. Any provider exposing /chat/completions works —
 * hosted gateways, local servers, or proxies.
 */

export type ModelToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ModelToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string | Record<string, unknown>;
  };
};

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
  name?: string;
  [key: string]: unknown;
};

export type ModelResponse = {
  text: string;
  toolCalls: ModelToolCall[];
  assistantMessage: ModelMessage;
  finishReason?: string;
};

export class OpenAICompatibleRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail: string,
    readonly url: string,
  ) {
    super(message);
    this.name = "OpenAICompatibleRequestError";
  }
}

type ModelCallOptions = {
  modelId?: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  tools?: ModelToolDefinition[];
  toolChoice?: "auto" | "none";
};

export function chatCompletionsUrl(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
}

function makeBody(provider: ProviderSettings, messages: ModelMessage[], options: ModelCallOptions | undefined) {
  const body: Record<string, unknown> = {
    model: options?.modelId ?? provider.modelId,
    messages,
    temperature: options?.temperature ?? provider.temperature,
    top_p: provider.topP,
    max_tokens: options?.maxTokens ?? provider.maxTokens,
  };

  if (typeof provider.presencePenalty === "number") body.presence_penalty = provider.presencePenalty;
  if (typeof provider.frequencyPenalty === "number") body.frequency_penalty = provider.frequencyPenalty;
  if (typeof provider.seed === "number" && provider.seed >= 0) body.seed = Math.floor(provider.seed);

  if (options?.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }

  return body;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function callOpenAICompatibleDetailed(
  provider: ProviderSettings,
  messages: ModelMessage[],
  options?: ModelCallOptions,
): Promise<ModelResponse> {
  const url = chatCompletionsUrl(provider.baseUrl);
  const response = await fetch(url, {
    method: "POST",
    signal: options?.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(makeBody(provider, messages, options)),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new OpenAICompatibleRequestError(
      `Model request failed at ${url}: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ""}`,
      response.status,
      detail,
      url,
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice.message);
  const toolCalls = Array.isArray(message.tool_calls) ? (message.tool_calls as ModelToolCall[]) : [];
  const rawText = message.content ?? choice.text ?? "";
  if (typeof rawText !== "string" && toolCalls.length === 0) {
    throw new Error("Model response did not include text content.");
  }

  return {
    text: typeof rawText === "string" ? rawText : "",
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content: typeof rawText === "string" ? rawText : null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : undefined,
  };
}

export async function callOpenAICompatible(
  provider: ProviderSettings,
  messages: ModelMessage[],
  options?: ModelCallOptions,
) {
  const response = await callOpenAICompatibleDetailed(provider, messages, options);
  return response.text;
}
