import type {
  DriverResponse,
  ModelDriver,
} from "./mockModel";
import type { ModelMessage, ModelToolCall, ModelToolDefinition } from "./openaiCompat";
import type { RuntimeTool } from "./tools";

export interface ToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  error?: string;
  resultChars: number;
}

export interface ToolLoopResult {
  finalText: string;
  executions: ToolExecution[];
  hitToolLimit: boolean;
}

export const DEFAULT_MAX_RESULT_CHARS = 30000;

/** Sanitise a tool name so it survives provider-side validation. */
export function safeToolName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return cleaned.length > 0 ? cleaned.slice(0, 64) : "tool";
}

/**
 * Convert runtime tools into provider tool definitions, deduplicating names
 * (a duplicate gets a numeric suffix) and capping name length at 64 chars.
 */
export function prepareToolDefinitions(tools: RuntimeTool[]): {
  definitions: ModelToolDefinition[];
  nameBySafe: Map<string, string>;
} {
  const seen = new Map<string, number>();
  const nameBySafe = new Map<string, string>();
  const definitions: ModelToolDefinition[] = [];

  for (const tool of tools) {
    const base = safeToolName(tool.name);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const safeName = count === 0 ? base : `${base.slice(0, 60)}_${count + 1}`;
    nameBySafe.set(safeName, tool.name);
    definitions.push({
      type: "function",
      function: {
        name: safeName,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    });
  }

  return { definitions, nameBySafe };
}

/** Parse a tool-call argument string into an object, tolerating empty input. */
export function parseToolArguments(raw: string | undefined | null): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function valueMatchesJsonType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Validate parsed arguments against a JSON-schema-ish inputSchema.
 * Returns an error string when invalid, null when valid.
 */
export function validateToolArguments(
  schema: Record<string, unknown>,
  args: Record<string, unknown>,
): string | null {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (!(key in args)) return `Missing required argument: ${key}`;
  }

  const properties =
    typeof schema.properties === "object" && schema.properties !== null
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};

  for (const [key, value] of Object.entries(args)) {
    const prop = properties[key];
    if (!prop) continue; // open properties are tolerated
    const type = typeof prop.type === "string" ? prop.type : "";
    if (type && !valueMatchesJsonType(value, type)) {
      return `Argument "${key}" must be of type ${type}.`;
    }
    if (Array.isArray(prop.enum) && !prop.enum.includes(value)) {
      return `Argument "${key}" must be one of: ${(prop.enum as unknown[]).join(", ")}.`;
    }
  }
  return null;
}

/** Clip a tool result so it cannot blow up the prompt budget. */
export function clipToolResult(result: string, maxChars = DEFAULT_MAX_RESULT_CHARS): string {
  if (result.length <= maxChars) return result;
  return `${result.slice(0, maxChars)}\n…[result clipped at ${maxChars} chars]`;
}

interface RunToolLoopArgs {
  modelMessages: ModelMessage[];
  tools: RuntimeTool[];
  maxToolCalls: number;
  driver: ModelDriver;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  onToolStart?: (name: string) => void;
  maxResultChars?: number;
}

/**
 * Run the model/tool loop: the model may emit tool calls, each call is
 * validated and executed, results are fed back, and the loop continues until
 * the model produces a plain text answer or the per-turn call cap is hit.
 * When the cap is hit, one final pass runs with tools disabled so the model
 * must answer with what it has.
 */
export async function runToolLoop(args: RunToolLoopArgs): Promise<ToolLoopResult> {
  const messages: ModelMessage[] = [...args.modelMessages];
  const { definitions, nameBySafe } = prepareToolDefinitions(args.tools);
  const executions: ToolExecution[] = [];
  let attemptedCalls = 0;
  let hitToolLimit = false;

  for (let round = 0; round <= args.maxToolCalls; round += 1) {
    const toolsAllowed = attemptedCalls < args.maxToolCalls && definitions.length > 0;
    const response: DriverResponse = await args.driver.complete({
      messages,
      tools: toolsAllowed ? definitions : undefined,
    });

    const toolCalls: ModelToolCall[] = response.toolCalls ?? [];

    if (toolCalls.length === 0) {
      return { finalText: response.text ?? "", executions, hitToolLimit };
    }

    if (!toolsAllowed) {
      // Model tried to call tools after the cap: force a plain answer.
      hitToolLimit = true;
      messages.push({
        role: "user",
        content:
          "Tool use is disabled for the remainder of this turn. Answer directly using the information you already have.",
      });
      const finalResponse = await args.driver.complete({ messages });
      return { finalText: finalResponse.text ?? "", executions, hitToolLimit: true };
    }

    // Append the assistant message that carried the tool calls exactly once.
    messages.push({
      role: "assistant",
      content: response.text ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      attemptedCalls += 1;
      const runtimeName = nameBySafe.get(call.function.name) ?? call.function.name;
      args.onToolStart?.(runtimeName);

      let parsedArgs: Record<string, unknown>;
      try {
        parsedArgs = parseToolArguments(call.function.arguments);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        executions.push({
          name: runtimeName,
          arguments: {},
          ok: false,
          error: message,
          resultChars: 0,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({ ok: false, error: message }),
        });
        continue;
      }

      const tool = args.tools.find((t) => t.name === runtimeName);
      const validationError = tool ? validateToolArguments(tool.inputSchema, parsedArgs) : `Unknown tool: ${runtimeName}`;
      if (validationError) {
        executions.push({
          name: runtimeName,
          arguments: parsedArgs,
          ok: false,
          error: validationError,
          resultChars: 0,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({ ok: false, error: validationError }),
        });
        continue;
      }

      const result = await args.executeTool(runtimeName, parsedArgs);
      const clipped = clipToolResult(JSON.stringify(result), args.maxResultChars);
      const ok = result.ok === true;
      executions.push({
        name: runtimeName,
        arguments: parsedArgs,
        ok,
        error: ok ? undefined : String(result.error ?? "Tool failed."),
        resultChars: clipped.length,
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: clipped,
      });
    }
  }

  // Exhausted rounds without a plain answer: one last tools-disabled pass.
  hitToolLimit = true;
  const finalResponse = await args.driver.complete({ messages });
  return { finalText: finalResponse.text ?? "", executions, hitToolLimit };
}
