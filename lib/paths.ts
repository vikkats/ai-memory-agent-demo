import path from "node:path";

/**
 * All runtime state lives under one data directory so the whole agent
 * (SQLite, memory files, local vector index, backups) can be mounted on a
 * single persistent volume in deployment.
 */
export const DATA_DIR = process.env.AGENT_DATA_DIR
  ? path.resolve(process.env.AGENT_DATA_DIR)
  : path.join(process.cwd(), "data");

export const DB_PATH = path.join(DATA_DIR, "agent.db");
export const MEMORY_DIR = path.join(DATA_DIR, "memory");
export const CORE_MEMORY_DIR = path.join(MEMORY_DIR, "core");
export const JOURNAL_DIR = path.join(MEMORY_DIR, "journal");
export const MEMORY_BACKUP_DIR = path.join(DATA_DIR, "memory-backups");
export const LOCAL_VECTOR_PATH = path.join(DATA_DIR, "local-vectors.json");
