import test from "node:test";
import assert from "node:assert/strict";
import { rescueBestSummary } from "../lib/retrieval";
import { createLocalEmbedding, cosineSimilarity } from "../lib/embeddings";
import type { RetrievedMemory } from "../lib/types";

type Ranked = RetrievedMemory & { rankScore: number };

function memory(id: string, type: string, score: number, rankScore = score): Ranked {
  return {
    id,
    score,
    text: `text of ${id}`,
    source: "test",
    rankScore,
    payload: { type },
  };
}

test("summary rescue swaps in a decent summary that missed the top-K cut", () => {
  const candidates: Ranked[] = [
    memory("msg-1", "conversation_message", 0.9, 0.9),
    memory("msg-2", "conversation_message", 0.8, 0.8),
    memory("msg-3", "conversation_message", 0.7, 0.7),
    memory("sum-1", "conversation_summary", 0.65, 0.81), // boosted but still ranked 4th… wait
  ];
  const rescued = rescueBestSummary(candidates, 3);
  assert.equal(rescued.length, 3);
  assert.ok(rescued.some((m) => m.id === "sum-1"), "summary should be rescued into the top-K");
  const rescuedSummary = rescued.find((m) => m.id === "sum-1");
  assert.equal(rescuedSummary?.payload?.summaryRescued, true);
});

test("summary rescue leaves the selection alone when a summary already ranks", () => {
  const candidates: Ranked[] = [
    memory("sum-1", "conversation_summary", 0.9, 1.06),
    memory("msg-1", "conversation_message", 0.8, 0.8),
    memory("msg-2", "conversation_message", 0.7, 0.7),
    memory("sum-2", "conversation_summary", 0.5, 0.66),
  ];
  const rescued = rescueBestSummary(candidates, 3);
  assert.deepEqual(
    rescued.map((m) => m.id),
    ["sum-1", "msg-1", "msg-2"],
  );
  assert.ok(!rescued.some((m) => m.payload?.summaryRescued === true));
});

test("summary rescue ignores summaries below the raw-score floor", () => {
  const candidates: Ranked[] = [
    memory("msg-1", "conversation_message", 0.9, 0.9),
    memory("msg-2", "conversation_message", 0.8, 0.8),
    memory("sum-weak", "conversation_summary", 0.05, 0.21),
  ];
  const rescued = rescueBestSummary(candidates, 2);
  assert.deepEqual(
    rescued.map((m) => m.id),
    ["msg-1", "msg-2"],
  );
});

test("local embeddings are deterministic and reward token overlap", async () => {
  const a1 = createLocalEmbedding("the agent indexes memory chunks");
  const a2 = createLocalEmbedding("the agent indexes memory chunks");
  const b = createLocalEmbedding("the agent indexes memory files");
  const c = createLocalEmbedding("completely unrelated sentence about weather");

  assert.deepEqual(a1, a2, "same input must produce the same vector");
  assert.ok(Math.abs(cosineSimilarity(a1, a2) - 1) < 1e-9);
  assert.ok(cosineSimilarity(a1, b) > cosineSimilarity(a1, c), "overlap should score higher");
});
