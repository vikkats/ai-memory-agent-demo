import test from "node:test";
import assert from "node:assert/strict";
import {
  parseToolArguments,
  prepareToolDefinitions,
  runToolLoop,
  validateToolArguments,
} from "../lib/toolLoop";
import type { RuntimeTool } from "../lib/tools";
import type { ModelDriver } from "../lib/mockModel";
import type { ModelToolCall } from "../lib/openaiCompat";

const echoTool: RuntimeTool = {
  name: "echo",
  description: "Echo the provided text back.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
};

function toolCall(name: string, args: Record<string, unknown>): ModelToolCall {
  return {
    id: `call_${name}_1`,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

test("prepareToolDefinitions dedupes colliding names", () => {
  const { definitions, nameBySafe } = prepareToolDefinitions([echoTool, echoTool, echoTool]);
  const names = definitions.map((d) => d.function.name);
  assert.equal(new Set(names).size, 3);
  assert.equal(names[0], "echo");
  for (const def of definitions) {
    assert.ok(def.function.name.length <= 64);
    assert.equal(nameBySafe.get(def.function.name), "echo");
  }
});

test("parseToolArguments rejects non-objects", () => {
  assert.deepEqual(parseToolArguments(""), {});
  assert.deepEqual(parseToolArguments(undefined), {});
  assert.deepEqual(parseToolArguments('{"a":1}'), { a: 1 });
  assert.throws(() => parseToolArguments("[1,2,3]"), /JSON object/);
  assert.throws(() => parseToolArguments('"hello"'), /JSON object/);
});

test("validateToolArguments enforces required fields and types", () => {
  const schema = echoTool.inputSchema;
  assert.equal(validateToolArguments(schema, { text: "hi" }), null);
  assert.match(validateToolArguments(schema, {}) ?? "", /Missing required argument: text/);
  assert.match(validateToolArguments(schema, { text: 42 }) ?? "", /must be of type string/);
});

test("runToolLoop executes a tool call and returns the final answer", async () => {
  let calls = 0;
  const driver: ModelDriver = async (messages, tools) => {
    calls += 1;
    if (calls === 1) {
      assert.ok(tools.length > 0, "tools must be offered on the first pass");
      return {
        text: "",
        toolCalls: [toolCall("echo", { text: "hello" })],
        assistantMessage: { role: "assistant", content: null, tool_calls: [toolCall("echo", { text: "hello" })] },
      };
    }
    const toolResult = messages.at(-1);
    assert.equal(toolResult?.role, "tool");
    return {
      text: "done",
      toolCalls: [],
      assistantMessage: { role: "assistant", content: "done" },
    };
  };

  const result = await runToolLoop({
    modelMessages: [{ role: "user", content: "say hello" }],
    tools: [echoTool],
    maxToolCalls: 6,
    driver,
    executeTool: async (name, args) => {
      assert.equal(name, "echo");
      return { ok: true, echoed: args.text };
    },
  });

  assert.equal(result.finalText, "done");
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0].ok, true);
  assert.equal(result.hitToolLimit, false);
});

test("runToolLoop surfaces validation errors to the model instead of throwing", async () => {
  let calls = 0;
  const driver: ModelDriver = async (messages) => {
    calls += 1;
    if (calls === 1) {
      return {
        text: "",
        toolCalls: [toolCall("echo", {})], // missing required "text"
        assistantMessage: { role: "assistant", content: null, tool_calls: [toolCall("echo", {})] },
      };
    }
    const toolResult = messages.at(-1);
    const payload = JSON.parse(String(toolResult?.content ?? "{}")) as { ok: boolean; error?: string };
    assert.equal(payload.ok, false);
    assert.match(payload.error ?? "", /Missing required argument/);
    return { text: "recovered", toolCalls: [], assistantMessage: { role: "assistant", content: "recovered" } };
  };

  const result = await runToolLoop({
    modelMessages: [{ role: "user", content: "echo nothing" }],
    tools: [echoTool],
    maxToolCalls: 6,
    driver,
    executeTool: async () => ({ ok: true }),
  });

  assert.equal(result.finalText, "recovered");
  assert.equal(result.executions[0].ok, false);
  assert.match(result.executions[0].error ?? "", /Missing required argument/);
});
