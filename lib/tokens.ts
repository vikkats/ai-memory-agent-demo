import type { ChatMessage } from "./types";

/**
 * Rough, provider-agnostic token estimate. Good enough for prompt budgeting
 * without pulling in a tokenizer dependency. English-heavy text averages
 * ~4 chars/token; markdown and code vary, so we bias slightly conservative.
 */
export function estimateTokens(text: string) {
  return Math.ceil(text.length / 3.7);
}

export function estimateMessageTokens(message: Pick<ChatMessage, "role" | "content">) {
  return estimateTokens(message.content) + 6; // role/message overhead
}

/**
 * Keeps the most recent messages that fit the budget. Always keeps at least
 * the newest message, even if it alone exceeds the budget.
 */
export function trimHistoryToBudget(history: ChatMessage[], budgetTokens: number) {
  if (!Number.isFinite(budgetTokens) || budgetTokens <= 0) return history;

  const kept: ChatMessage[] = [];
  let used = 0;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    const cost = estimateMessageTokens(message);
    if (kept.length > 0 && used + cost > budgetTokens) break;
    kept.unshift(message);
    used += cost;
  }

  return kept;
}
