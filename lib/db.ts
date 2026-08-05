import fs from "node:fs";
import Database from "better-sqlite3";
import { DATA_DIR, DB_PATH } from "./paths";

let db: Database.Database | null = null;

export function getDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!db) {
    db = new Database(DB_PATH, {
      timeout: Number(process.env.AGENT_SQLITE_BUSY_TIMEOUT_MS ?? 5000),
    });
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    migrate(db);
  }

  return db;
}

function migrate(database: Database.Database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL DEFAULT '',
      model_id TEXT NOT NULL,
      api_format TEXT NOT NULL DEFAULT 'openai-compatible',
      temperature REAL NOT NULL DEFAULT 0.7,
      top_p REAL NOT NULL DEFAULT 0.95,
      max_tokens INTEGER NOT NULL DEFAULT 1200,
      context_window_tokens INTEGER NOT NULL DEFAULT 131072,
      history_message_limit INTEGER NOT NULL DEFAULT 80,
      presence_penalty REAL,
      frequency_penalty REAL,
      seed INTEGER,
      embedding_model TEXT,
      embedding_base_url TEXT,
      embedding_api_key TEXT,
      vector_backend TEXT NOT NULL DEFAULT 'local',
      qdrant_url TEXT,
      qdrant_api_key TEXT,
      qdrant_collection TEXT,
      retrieval_top_k INTEGER NOT NULL DEFAULT 8,
      retrieval_score_threshold REAL NOT NULL DEFAULT 0.25,
      retrieval_token_budget INTEGER NOT NULL DEFAULT 4000,
      auto_index_cadence INTEGER NOT NULL DEFAULT 1,
      tools_enabled INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pending_file_edits (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      old_content TEXT NOT NULL DEFAULT '',
      proposed_content TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      summary_key TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(conversation_id, summary_key),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (last_message_id) REFERENCES messages(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS check_ins (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      title TEXT NOT NULL,
      intent TEXT NOT NULL,
      fallback_message TEXT NOT NULL,
      due_at TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      recurrence TEXT NOT NULL DEFAULT 'none',
      status TEXT NOT NULL DEFAULT 'pending',
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      fired_at TEXT,
      last_error TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_index_state (
      conversation_id TEXT PRIMARY KEY,
      last_indexed_message_id TEXT,
      completed_turns_since_index INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (last_indexed_message_id) REFERENCES messages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages(conversation_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_pending_file_edits_status_created
      ON pending_file_edits(status, created_at);

    CREATE INDEX IF NOT EXISTS idx_check_ins_due_status
      ON check_ins(status, due_at);

    CREATE INDEX IF NOT EXISTS idx_conversation_summaries_key
      ON conversation_summaries(conversation_id, summary_key);
  `);
}

export function nowIso() {
  return new Date().toISOString();
}
