import { randomUUID } from "node:crypto";
import { getDb, nowIso } from "./db";
import { backupMemoryFile, readMemoryFile, writeMemoryFile } from "./memory";
import type { PendingFileEdit } from "./types";

type PendingEditRow = {
  id: string;
  path: string;
  old_content: string;
  proposed_content: string;
  reason: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
};

function rowToEdit(row: PendingEditRow): PendingFileEdit {
  return {
    id: row.id,
    path: row.path,
    oldContent: row.old_content,
    proposedContent: row.proposed_content,
    reason: row.reason,
    status: row.status as PendingFileEdit["status"],
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/**
 * The agent (or the UI) can propose a memory-file change without applying it.
 * A human accepts or rejects the proposal — memory writes are reviewable.
 */
export async function proposeMemoryEdit(input: { path: string; proposedContent: string; reason?: string }) {
  const current = await readMemoryFile(input.path).catch(() => null);
  const edit: PendingFileEdit = {
    id: randomUUID(),
    path: input.path,
    oldContent: current?.content ?? "",
    proposedContent: input.proposedContent,
    reason: input.reason?.trim() || "",
    status: "pending",
    createdAt: nowIso(),
    resolvedAt: null,
  };

  getDb()
    .prepare(`
      INSERT INTO pending_file_edits (id, path, old_content, proposed_content, reason, status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)
    `)
    .run(edit.id, edit.path, edit.oldContent, edit.proposedContent, edit.reason, edit.createdAt);

  return edit;
}

export function listPendingEdits(status: PendingFileEdit["status"] = "pending") {
  const rows = getDb()
    .prepare("SELECT * FROM pending_file_edits WHERE status = ? ORDER BY created_at DESC LIMIT 100")
    .all(status) as PendingEditRow[];
  return rows.map(rowToEdit);
}

export async function resolvePendingEdit(id: string, action: "accept" | "reject") {
  const row = getDb().prepare("SELECT * FROM pending_file_edits WHERE id = ?").get(id) as PendingEditRow | undefined;
  if (!row) throw new Error(`Pending edit not found: ${id}`);
  if (row.status !== "pending") throw new Error(`Pending edit ${id} is already ${row.status}.`);

  const resolvedAt = nowIso();
  let backupPath: string | null = null;

  if (action === "accept") {
    backupPath = await backupMemoryFile(row.path);
    await writeMemoryFile(row.path, row.proposed_content);
  }

  getDb()
    .prepare("UPDATE pending_file_edits SET status = ?, resolved_at = ? WHERE id = ?")
    .run(action === "accept" ? "accepted" : "rejected", resolvedAt, id);

  return { ...rowToEdit({ ...row, status: action === "accept" ? "accepted" : "rejected", resolved_at: resolvedAt }), backupPath };
}
