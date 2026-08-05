import { getConversation, listConversations, listMessages } from "./conversations";
import { summarizeAndIndexConversation } from "./conversationSummaries";
import { getAppSetting, setAppSetting, getAppTimezone } from "./appSettings";
import { indexMemoryFiles } from "./indexing";
import { appendJournalEntry, editMemoryFileWithBackup, readMemoryFile } from "./memory";
import { generateText } from "./mockModel";
import { isMockProvider } from "./providers";
import { localDateTimeForPrompt } from "./time";
import type { ProviderSettings } from "./types";

const KEY_LAST_RUN_AT = "maintenance_last_run_at";
const KEY_LAST_CONVERSATION_ID = "maintenance_last_conversation_id";
const KEY_LAST_CONVERSATION_UPDATED_AT = "maintenance_last_conversation_updated_at";
const KEY_LAST_STATUS = "maintenance_last_status";

export const DEFAULT_INTERVAL_MINUTES = 360;
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 10080; // one week

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (Date.now() - then) / 60_000;
}

function getSettingOrNull(key: string): string | null {
  const value = getAppSetting(key, "");
  return value || null;
}

export interface MaintenanceStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt: string | null;
  minutesSinceLastRun: number | null;
  lastConversationId: string | null;
  lastConversationUpdatedAt: string | null;
  lastStatus: string | null;
}

export function getMaintenanceStatus(): MaintenanceStatus {
  const interval = Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, envNumber("AGENT_MAINTENANCE_INTERVAL_MINUTES", DEFAULT_INTERVAL_MINUTES)),
  );
  const lastRunAt = getSettingOrNull(KEY_LAST_RUN_AT);
  return {
    enabled: envFlag("AGENT_MAINTENANCE_ENABLED", true),
    intervalMinutes: interval,
    lastRunAt,
    minutesSinceLastRun: minutesSince(lastRunAt),
    lastConversationId: getSettingOrNull(KEY_LAST_CONVERSATION_ID),
    lastConversationUpdatedAt: getSettingOrNull(KEY_LAST_CONVERSATION_UPDATED_AT),
    lastStatus: getSettingOrNull(KEY_LAST_STATUS),
  };
}

async function refreshLiveState(provider: ProviderSettings, conversationId: string): Promise<string> {
  const conversation = getConversation(conversationId);
  const recent = listMessages(conversationId, 20).slice(-12);
  const lastUser = [...recent].reverse().find((m) => m.role === "user");
  const now = localDateTimeForPrompt(new Date(), getAppTimezone());

  let body: string;
  if (isMockProvider(provider)) {
    body = [
      `# Live State`,
      ``,
      `- Refreshed: ${now}`,
      `- Active thread: ${conversation?.title ?? conversationId}`,
      `- Recent turns: ${recent.length}`,
      lastUser ? `- Last user input: ${lastUser.content.slice(0, 200)}` : `- Last user input: (none yet)`,
      ``,
      `This file is rewritten by the maintenance cycle. Keep it short — it is loaded into every prompt.`,
    ].join("\n");
  } else {
    const transcript = recent.map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 300)}`).join("\n");
    body = await generateText(provider, [
      {
        role: "system",
        content:
          "You maintain the agent's live_state.md: a compact briefing of what is happening right now. Max 12 lines. Markdown. No speculation.",
      },
      {
        role: "user",
        content: `Current time: ${now}\nActive thread: ${conversation?.title ?? conversationId}\nRecent turns:\n${transcript}\n\nWrite the new live_state.md content.`,
      },
    ]);
    if (!body.trim()) throw new Error("Model returned empty live_state content.");
  }

  await editMemoryFileWithBackup("core/live_state.md", body);
  return "core/live_state.md";
}

export interface MaintenanceCycleOptions {
  force?: boolean;
  conversationId?: string;
  intervalMinutes?: number;
  requireNewMessages?: boolean;
  updateLiveState?: boolean;
  writeJournal?: boolean;
  summarize?: boolean;
  autoIndex?: boolean;
}

export interface MaintenanceCycleResult {
  enabled: boolean;
  force: boolean;
  skippedReason?: string;
  ranAt?: string;
  conversationId?: string;
  steps: string[];
  errors: string[];
  touchedPaths: string[];
  indexedChunks?: number;
  summaryId?: string;
}

/**
 * The maintenance cycle keeps the workspace fresh between conversations:
 * it rewrites core/live_state.md, appends a journal note, optionally
 * summarizes the active thread, and re-indexes everything it touched.
 * Cooldown + change guards prevent redundant work.
 */
export async function runMaintenanceCycle(
  provider: ProviderSettings,
  options: MaintenanceCycleOptions = {},
): Promise<MaintenanceCycleResult> {
  const force = options.force === true;
  const result: MaintenanceCycleResult = { enabled: true, force, steps: [], errors: [], touchedPaths: [] };

  if (!envFlag("AGENT_MAINTENANCE_ENABLED", true)) {
    return { ...result, enabled: false, skippedReason: "Maintenance is disabled (AGENT_MAINTENANCE_ENABLED)." };
  }

  const status = getMaintenanceStatus();
  const interval = Math.min(
    MAX_INTERVAL_MINUTES,
    Math.max(MIN_INTERVAL_MINUTES, options.intervalMinutes ?? status.intervalMinutes),
  );

  if (!force && status.minutesSinceLastRun !== null && status.minutesSinceLastRun < interval) {
    return {
      ...result,
      skippedReason: `Cooldown: last run ${Math.round(status.minutesSinceLastRun)}m ago (interval ${interval}m).`,
    };
  }

  const conversationId =
    options.conversationId ?? status.lastConversationId ?? listConversations(1)[0]?.id;
  if (!conversationId || !getConversation(conversationId)) {
    return { ...result, skippedReason: "No conversation to maintain yet." };
  }
  const conversation = getConversation(conversationId)!;

  const requireNewMessages = options.requireNewMessages ?? true;
  if (
    !force &&
    requireNewMessages &&
    status.lastConversationId === conversationId &&
    status.lastConversationUpdatedAt === conversation.updatedAt
  ) {
    return { ...result, skippedReason: "No new messages since the last maintenance run." };
  }

  result.conversationId = conversationId;
  const ranAt = new Date().toISOString();

  const updateLiveState = options.updateLiveState ?? envFlag("AGENT_MAINTENANCE_UPDATE_LIVE_STATE", true);
  const writeJournal = options.writeJournal ?? envFlag("AGENT_MAINTENANCE_WRITE_JOURNAL", true);
  const summarize = options.summarize ?? envFlag("AGENT_MAINTENANCE_SUMMARIZE", false);
  const autoIndex = options.autoIndex ?? envFlag("AGENT_MAINTENANCE_AUTO_INDEX", true);

  if (updateLiveState) {
    try {
      const path = await refreshLiveState(provider, conversationId);
      result.touchedPaths.push(path);
      result.steps.push(`live_state refreshed → ${path}`);
    } catch (error) {
      result.errors.push(`live_state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (writeJournal) {
    try {
      const file = await appendJournalEntry(
        `Maintenance cycle ran at ${localDateTimeForPrompt(new Date(), getAppTimezone())}. Steps so far: ${result.steps.join("; ") || "none"}.${result.errors.length ? ` Errors: ${result.errors.join("; ")}` : ""}`,
      );
      result.touchedPaths.push(file.path);
      result.steps.push(`journal entry → ${file.path}`);
    } catch (error) {
      result.errors.push(`journal: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (summarize) {
    try {
      const summary = await summarizeAndIndexConversation(provider, conversationId);
      if (summary) {
        result.summaryId = summary.id;
        result.steps.push(`summary saved + indexed (${summary.messageCount} messages)`);
      } else {
        result.steps.push("summary skipped (nothing to summarize)");
      }
    } catch (error) {
      result.errors.push(`summary: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (autoIndex && result.touchedPaths.length > 0) {
    try {
      const indexed = await indexMemoryFiles(result.touchedPaths, provider);
      result.indexedChunks = indexed.chunks;
      result.steps.push(`re-indexed ${indexed.chunks} chunk(s) from ${result.touchedPaths.length} file(s)`);
    } catch (error) {
      result.errors.push(`indexing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  result.ranAt = ranAt;
  setAppSetting(KEY_LAST_RUN_AT, ranAt);
  setAppSetting(KEY_LAST_CONVERSATION_ID, conversationId);
  setAppSetting(KEY_LAST_CONVERSATION_UPDATED_AT, conversation.updatedAt);
  setAppSetting(KEY_LAST_STATUS, JSON.stringify({ ranAt, steps: result.steps, errors: result.errors }));
  return result;
}

/** Convenience read used by the export endpoint. */
export async function readLiveState(): Promise<string> {
  try {
    const file = await readMemoryFile("core/live_state.md");
    return file.content;
  } catch {
    return "";
  }
}
