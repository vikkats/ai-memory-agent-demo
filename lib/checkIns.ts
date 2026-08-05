import { randomUUID } from "node:crypto";
import { addMessage, listConversations, listMessages } from "./conversations";
import { getDb, nowIso } from "./db";
import { getAppTimezone, getWatcherConversationId } from "./appSettings";
import { resolveModelDriver } from "./mockModel";
import { isMockProvider } from "./providers";
import { buildModelMessages } from "./prompt";
import { resolveTimezone } from "./time";
import type { CheckIn, CheckInRecurrence, ProviderSettings } from "./types";

export const ALLOWED_RECURRENCES: CheckInRecurrence[] = ["none", "daily", "weekly"];

export const MAX_DUE_PER_CYCLE = 12;
export const PROCESSING_STALE_MINUTES = 15;

interface CheckInRow {
  id: string;
  conversation_id: string;
  title: string;
  intent: string;
  fallback_message: string;
  due_at: string;
  timezone: string;
  recurrence: string;
  status: string;
  occurrence_count: number;
  created_at: string;
  updated_at: string;
  fired_at: string | null;
  last_error: string | null;
}

function rowToCheckIn(row: CheckInRow): CheckIn {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    intent: row.intent,
    fallbackMessage: row.fallback_message,
    dueAt: row.due_at,
    timezone: row.timezone,
    recurrence: row.recurrence as CheckInRecurrence,
    status: row.status as CheckIn["status"],
    occurrenceCount: row.occurrence_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    firedAt: row.fired_at,
    lastError: row.last_error,
  };
}

function resolveTargetConversation(explicit?: string | null): string {
  if (explicit) return explicit;
  const watcherId = getWatcherConversationId();
  if (watcherId) return watcherId;
  const latest = listConversations(1)[0];
  if (!latest) throw new Error("No conversation exists yet — create one before scheduling check-ins.");
  return latest.id;
}

/** Require an explicit timezone suffix (Z or ±hh:mm) so due times are unambiguous. */
function parseDueAt(raw: string): string {
  const trimmed = raw.trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)) {
    throw new Error("dueAt must include a timezone offset (e.g. 2026-08-06T09:00:00Z).");
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid dueAt: ${raw}`);
  return date.toISOString();
}

function nextDueAt(fromIso: string, recurrence: CheckInRecurrence): string {
  const date = new Date(fromIso);
  if (recurrence === "daily") date.setUTCDate(date.getUTCDate() + 1);
  else if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString();
}

export function createCheckIn(input: {
  title: string;
  intent: string;
  fallbackMessage: string;
  dueAt: string;
  recurrence?: CheckInRecurrence;
  conversationId?: string | null;
  timezone?: string;
}): CheckIn {
  const recurrence = input.recurrence ?? "none";
  if (!ALLOWED_RECURRENCES.includes(recurrence)) {
    throw new Error(`recurrence must be one of: ${ALLOWED_RECURRENCES.join(", ")}`);
  }
  const db = getDb();
  const id = randomUUID();
  const now = nowIso();
  db.prepare(
    `INSERT INTO check_ins
       (id, conversation_id, title, intent, fallback_message, due_at, timezone, recurrence, status, occurrence_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  ).run(
    id,
    resolveTargetConversation(input.conversationId),
    input.title.trim(),
    input.intent.trim(),
    input.fallbackMessage.trim(),
    parseDueAt(input.dueAt),
    resolveTimezone(input.timezone ?? getAppTimezone()),
    recurrence,
    now,
    now,
  );
  return getCheckIn(id)!;
}

export function getCheckIn(id: string): CheckIn | null {
  const row = getDb().prepare(`SELECT * FROM check_ins WHERE id = ?`).get(id) as CheckInRow | undefined;
  return row ? rowToCheckIn(row) : null;
}

export function listCheckIns(limit = 100): CheckIn[] {
  const rows = getDb()
    .prepare(`SELECT * FROM check_ins ORDER BY due_at ASC LIMIT ?`)
    .all(limit) as CheckInRow[];
  return rows.map(rowToCheckIn);
}

export function cancelCheckIn(id: string): boolean {
  const result = getDb()
    .prepare(`UPDATE check_ins SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('pending','processing')`)
    .run(nowIso(), id);
  return result.changes > 0;
}

/** Recover check-ins stuck in 'processing' past the stale window (crashed worker). */
export function recoverStaleProcessing(): number {
  const cutoff = new Date(Date.now() - PROCESSING_STALE_MINUTES * 60_000).toISOString();
  const result = getDb()
    .prepare(
      `UPDATE check_ins SET status = 'pending', updated_at = ?
       WHERE status = 'processing' AND updated_at < ?`,
    )
    .run(nowIso(), cutoff);
  return result.changes;
}

/** Atomically claim due check-ins so concurrent watcher runs don't double-deliver. */
export function claimDueCheckIns(now = new Date()): CheckIn[] {
  const db = getDb();
  const isoNow = now.toISOString();
  const claimed: CheckIn[] = [];
  const claim = db.transaction(() => {
    const due = db
      .prepare(
        `SELECT * FROM check_ins WHERE status = 'pending' AND due_at <= ?
         ORDER BY due_at ASC LIMIT ?`,
      )
      .all(isoNow, MAX_DUE_PER_CYCLE) as CheckInRow[];
    for (const row of due) {
      const result = db
        .prepare(
          `UPDATE check_ins SET status = 'processing', updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(isoNow, row.id);
      if (result.changes > 0) claimed.push(rowToCheckIn({ ...row, status: "processing", updated_at: isoNow }));
    }
  });
  claim();
  return claimed;
}

export function occurrenceKey(checkIn: CheckIn): string {
  return `${checkIn.id}:${checkIn.dueAt}`;
}

/** Dedupe guard: has this exact occurrence already been delivered to the thread? */
export function occurrenceAlreadyDelivered(checkIn: CheckIn): boolean {
  const key = occurrenceKey(checkIn);
  const row = getDb()
    .prepare(
      `SELECT id FROM messages
       WHERE conversation_id = ? AND json_extract(metadata_json, '$.source') = 'scheduled-check-in'
         AND json_extract(metadata_json, '$.occurrenceKey') = ?
       LIMIT 1`,
    )
    .get(checkIn.conversationId, key);
  return row !== undefined;
}

async function generateDueMessage(provider: ProviderSettings, checkIn: CheckIn): Promise<string> {
  if (isMockProvider(provider)) return checkIn.fallbackMessage;
  try {
    const driver = resolveModelDriver(provider);
    const history = listMessages(checkIn.conversationId, 40);
    const messages = await buildModelMessages(history, provider, []);
    messages.push({
      role: "user",
      content: `[Scheduled check-in fired: "${checkIn.title}" — due ${checkIn.dueAt}]\nIntent: ${checkIn.intent}\nWrite the check-in message now, in your own voice. Keep it short and natural. If you have nothing useful to add beyond the intent, reply with exactly: ${checkIn.fallbackMessage}`,
    });
    const response = await driver(messages, []);
    const text = response.text?.trim();
    return text && text.length > 0 ? text : checkIn.fallbackMessage;
  } catch {
    return checkIn.fallbackMessage;
  }
}

function markDelivered(checkIn: CheckIn): string | null {
  const now = nowIso();
  if (checkIn.recurrence === "none") {
    getDb()
      .prepare(
        `UPDATE check_ins SET status = 'fired', fired_at = ?, last_error = NULL,
           occurrence_count = occurrence_count + 1, updated_at = ? WHERE id = ?`,
      )
      .run(now, now, checkIn.id);
    return null;
  }
  const rescheduled = nextDueAt(checkIn.dueAt, checkIn.recurrence);
  getDb()
    .prepare(
      `UPDATE check_ins SET status = 'pending', due_at = ?, fired_at = ?, last_error = NULL,
         occurrence_count = occurrence_count + 1, updated_at = ? WHERE id = ?`,
    )
    .run(rescheduled, now, now, checkIn.id);
  return rescheduled;
}

function markFailed(checkIn: CheckIn, error: string): void {
  getDb()
    .prepare(
      `UPDATE check_ins SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`,
    )
    .run(error.slice(0, 500), nowIso(), checkIn.id);
}

export interface CheckInDeliveryResult {
  checkInId: string;
  title: string;
  delivered: boolean;
  messageId?: string;
  error?: string;
  rescheduledTo?: string;
}

async function deliverCheckIn(
  provider: ProviderSettings,
  checkIn: CheckIn,
): Promise<CheckInDeliveryResult> {
  if (occurrenceAlreadyDelivered(checkIn)) {
    const rescheduledTo = markDelivered(checkIn) ?? undefined;
    return {
      checkInId: checkIn.id,
      title: checkIn.title,
      delivered: false,
      error: "Duplicate occurrence skipped.",
      rescheduledTo,
    };
  }

  const text = await generateDueMessage(provider, checkIn);
  const message = addMessage({
    conversationId: checkIn.conversationId,
    role: "assistant",
    content: text,
    metadata: {
      source: "scheduled-check-in",
      checkInId: checkIn.id,
      occurrenceKey: occurrenceKey(checkIn),
      title: checkIn.title,
      dueAt: checkIn.dueAt,
      recurrence: checkIn.recurrence,
    },
  });
  const rescheduled = markDelivered(checkIn);
  return {
    checkInId: checkIn.id,
    title: checkIn.title,
    delivered: true,
    messageId: message.id,
    rescheduledTo: rescheduled ?? undefined,
  };
}

export interface CheckInCycleResult {
  claimed: number;
  delivered: number;
  recovered: number;
  failed: number;
  results: CheckInDeliveryResult[];
}

/** One full check-in cycle: recover stale claims, claim due items, deliver each. */
export async function runCheckInCycle(provider: ProviderSettings): Promise<CheckInCycleResult> {
  const recovered = recoverStaleProcessing();
  const due = claimDueCheckIns();
  const results: CheckInDeliveryResult[] = [];
  let delivered = 0;
  let failed = 0;

  for (const checkIn of due) {
    try {
      const result = await deliverCheckIn(provider, checkIn);
      results.push(result);
      if (result.delivered) delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markFailed(checkIn, message);
      results.push({ checkInId: checkIn.id, title: checkIn.title, delivered: false, error: message });
      failed += 1;
    }
  }

  return { claimed: due.length, delivered, recovered, failed, results };
}
