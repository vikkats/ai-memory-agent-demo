import { getDb, nowIso } from "./db";
import { DEFAULT_TIMEZONE } from "./time";

type AppSettingRow = {
  key: string;
  value: string;
  updated_at: string;
};

export function getAppSetting(key: string, fallback = "") {
  const row = getDb().prepare("SELECT * FROM app_settings WHERE key = ?").get(key) as AppSettingRow | undefined;
  return row?.value ?? fallback;
}

export function setAppSetting(key: string, value: string) {
  const updatedAt = nowIso();
  getDb()
    .prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `)
    .run(key, value, updatedAt);

  return { key, value, updatedAt };
}

export function getAppTimezone() {
  return getAppSetting("timezone", DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
}

export function getWatcherConversationId() {
  return getAppSetting("watcher_conversation_id", "") || null;
}

export function setWatcherConversationId(conversationId: string) {
  return setAppSetting("watcher_conversation_id", conversationId);
}

export function getAppSettings() {
  return {
    timezone: getAppTimezone(),
    watcherConversationId: getWatcherConversationId(),
  };
}

export function setAppSettings(input: { timezone?: string; watcherConversationId?: string | null }) {
  if (input.timezone) setAppSetting("timezone", input.timezone);
  if (typeof input.watcherConversationId === "string") setWatcherConversationId(input.watcherConversationId);
  return getAppSettings();
}
