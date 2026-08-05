import test from "node:test";
import assert from "node:assert/strict";
import { estimateTokens, trimHistoryToBudget } from "../lib/tokens";
import type { ChatMessage } from "../lib/types";

function message(content: string, index: number): ChatMessage {
  return {
    id: `m-${index}`,
    conversationId: "c-1",
    role: index % 2 === 0 ? "user" : "assistant",
    content,
    createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
    metadata: null,
  };
}

test("estimateTokens grows monotonically with length", () => {
  assert.ok(estimateTokens("") <= estimateTokens("a"));
  assert.ok(estimateTokens("a".repeat(100)) > estimateTokens("a".repeat(10)));
});

test("trimHistoryToBudget keeps the newest messages first", () => {
  const history = Array.from({ length: 10 }, (_, i) => message("x".repeat(200), i));
  const trimmed = trimHistoryToBudget(history, 150);
  assert.ok(trimmed.length > 0);
  assert.ok(trimmed.length < history.length);
  // Newest message must survive, and order is preserved.
  assert.equal(trimmed.at(-1)?.id, history.at(-1)?.id);
  for (let i = 1; i < trimmed.length; i += 1) {
    const prevIndex = Number(trimmed[i - 1].id.split("-")[1]);
    const curIndex = Number(trimmed[i].id.split("-")[1]);
    assert.ok(curIndex > prevIndex);
  }
});

test("trimHistoryToBudget always keeps the newest message, even over budget", () => {
  const history = [message("old", 0), message("y".repeat(10000), 1)];
  const trimmed = trimHistoryToBudget(history, 10);
  assert.equal(trimmed.length, 1);
  assert.equal(trimmed[0].id, "m-1");
});

test("non-positive budget still returns the newest message", () => {
  const history = [message("a", 0), message("b", 1)];
  const trimmed = trimHistoryToBudget(history, 0);
  assert.equal(trimmed.at(-1)?.id, "m-1");
});
