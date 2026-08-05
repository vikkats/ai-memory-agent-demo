import fs from "node:fs/promises";
import path from "node:path";
import { CORE_MEMORY_DIR, JOURNAL_DIR, MEMORY_BACKUP_DIR, MEMORY_DIR } from "./paths";
import type { MemoryFile } from "./types";
import { estimateTokens } from "./tokens";
import { getAppTimezone } from "./appSettings";
import { localDateKey, localTimestamp } from "./time";

const SAFE_FILE_RE = /^[a-zA-Z0-9_\-/]+\.md$/;

const MEMORY_ROOM_DIRS = ["notes", "projects", "scratchpad"];

const STARTER_FILES: Array<{ path: string; content: string }> = [
  {
    path: "core/START_HERE.md",
    content: `# START HERE — Agent Runtime Orientation

Purpose: first memory file the agent should treat as an active orientation map
when a conversation starts, when a model/provider changes, or when behavior
feels off.

## Load Order

1. Read this file first.
2. Treat core/*.md as the active operating stack, not passive storage.
3. Use journal/*.md for dated continuity logs.
4. Use notes/*.md for durable user/project facts.
5. Use projects/*.md for active work and open loops.
6. Use scratchpad/*.md for temporary working notes.

## Core Files

- core/agent_identity.md — what the agent is and how it should behave.
- core/behavior_guidelines.md — operating principles and failure modes.
- core/product_principles.md — the product rules this workspace enforces.
- core/live_state.md — current working state, refreshed by maintenance runs.

## File Tool Guidance

- read_memory_file: orientation and context.
- append_journal_entry: dated continuity logs.
- edit_memory_file: intentional updates; creates automatic backups.
- create_memory_draft: new files outside core/.
- propose_memory_edit: only when the user wants to review before writing.
`,
  },
  {
    path: "core/agent_identity.md",
    content: `# Agent Identity

A memory-augmented workspace agent. It answers from persistent memory,
explicit retrieval, and reviewable background behavior — not from a blank
context window.

Replace this text with the identity of your own deployment.
`,
  },
  {
    path: "core/behavior_guidelines.md",
    content: `# Behavior Guidelines

- Ground answers in retrieved memory when it exists; say when it does not.
- Never invent continuity. Admit gaps instead of fabricating history.
- Background actions (check-ins, maintenance) must be logged and reversible.
- Tool use is auditable: every call is recorded on the message metadata.
- When facts matter, check files/tools or state the uncertainty plainly.
`,
  },
  {
    path: "core/product_principles.md",
    content: `# Product Principles

- Memory is inspectable: the user can see what was retrieved and why.
- Memory is editable: files can be changed directly or via reviewed proposals.
- Autonomy is bounded: scheduled actions have cooldowns, logs, and an off switch.
- Vectors are a rebuildable index; raw messages and memory files are the archive.
- Provider config is portable: any OpenAI-compatible endpoint should work.
`,
  },
  {
    path: "core/live_state.md",
    content: `# Live State

Current working state of the workspace. The maintenance cycle refreshes this
file so each new conversation starts oriented.

- Status: freshly initialized demo workspace.
`,
  },
  {
    path: "notes/demo_notes.md",
    content: `# Demo Notes

Durable facts the agent should remember across conversations go here.

Example: the user prefers concise answers with concrete next steps.
`,
  },
  {
    path: "projects/demo_project.md",
    content: `# Demo Project

## Open Loops

- Evaluate retrieval quality with a real embedding model.
- Add tags/favorites to the memory browser.
`,
  },
  {
    path: "scratchpad/working_notes.md",
    content: `# Working Notes

Temporary scratch space. Reorganize into notes/ or projects/ later.
`,
  },
];

async function fileExists(absolutePath: string) {
  try {
    await fs.stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureMemoryDirs() {
  await fs.mkdir(CORE_MEMORY_DIR, { recursive: true });
  await fs.mkdir(JOURNAL_DIR, { recursive: true });
  await fs.mkdir(MEMORY_BACKUP_DIR, { recursive: true });
  for (const room of MEMORY_ROOM_DIRS) {
    await fs.mkdir(path.join(MEMORY_DIR, room), { recursive: true });
  }

  for (const starter of STARTER_FILES) {
    const absolute = path.join(MEMORY_DIR, starter.path);
    if (!(await fileExists(absolute))) {
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, starter.content, "utf8");
    }
  }
}

export function assertSafeMemoryPath(relativePath: string) {
  const normalized = relativePath.replace(/^\/+/, "");
  if (!SAFE_FILE_RE.test(normalized) || normalized.includes("..")) {
    throw new Error("Unsafe memory path. Use paths like core/agent_identity.md or projects/demo_project.md");
  }
  return normalized;
}

function backupPathFor(relativePath: string, date = new Date()) {
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  const parsed = path.parse(relativePath);
  return path.join(MEMORY_BACKUP_DIR, parsed.dir, `${parsed.name}.${timestamp}.md`);
}

function coreSortKey(file: MemoryFile) {
  const order: Record<string, number> = {
    "core/START_HERE.md": 0,
    "core/agent_identity.md": 1,
    "core/behavior_guidelines.md": 2,
    "core/product_principles.md": 3,
    "core/live_state.md": 4,
  };
  return order[file.path] ?? 100;
}

export async function listMemoryFiles() {
  await ensureMemoryDirs();
  const files: MemoryFile[] = [];

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const stat = await fs.stat(absolute);
      const relative = path.relative(MEMORY_DIR, absolute).replaceAll(path.sep, "/");
      files.push({
        path: relative,
        name: entry.name,
        content: await fs.readFile(absolute, "utf8"),
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }

  await walk(MEMORY_DIR);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readMemoryFile(relativePath: string) {
  await ensureMemoryDirs();
  const safePath = assertSafeMemoryPath(relativePath);
  const absolute = path.join(MEMORY_DIR, safePath);

  try {
    const stat = await fs.stat(absolute);
    return {
      path: safePath,
      name: path.basename(safePath),
      content: await fs.readFile(absolute, "utf8"),
      updatedAt: stat.mtime.toISOString(),
    } satisfies MemoryFile;
  } catch (error) {
    const message =
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
        ? `Memory file does not exist yet: ${safePath}.`
        : `Could not read memory file ${safePath}.`;
    throw new Error(message);
  }
}

export async function backupMemoryFile(relativePath: string) {
  await ensureMemoryDirs();
  const safePath = assertSafeMemoryPath(relativePath);
  const absolute = path.join(MEMORY_DIR, safePath);

  if (!(await fileExists(absolute))) return null;

  const backupAbsolute = backupPathFor(safePath);
  await fs.mkdir(path.dirname(backupAbsolute), { recursive: true });
  await fs.copyFile(absolute, backupAbsolute);

  return path.relative(MEMORY_BACKUP_DIR, backupAbsolute).replaceAll(path.sep, "/");
}

export async function writeMemoryFile(relativePath: string, content: string) {
  await ensureMemoryDirs();
  const safePath = assertSafeMemoryPath(relativePath);
  const absolute = path.join(MEMORY_DIR, safePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf8");
  return readMemoryFile(safePath);
}

export async function editMemoryFileWithBackup(relativePath: string, content: string) {
  const safePath = assertSafeMemoryPath(relativePath);
  const backupPath = await backupMemoryFile(safePath);
  const file = await writeMemoryFile(safePath, content);
  return { file, backupPath };
}

export async function appendJournalEntry(content: string, date = new Date()) {
  await ensureMemoryDirs();
  const relativePath = `journal/${localDateKey(date, getAppTimezone())}.md`;
  const absolute = path.join(MEMORY_DIR, relativePath);
  const entry = `\n\n## ${localTimestamp(date, getAppTimezone())}\n${content.trim()}\n`;

  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.appendFile(absolute, entry, "utf8");
  return readMemoryFile(relativePath);
}

/**
 * Loads core memory files into the prompt under a token budget. Core files
 * are injected in a stable priority order; anything that does not fit is
 * reported rather than silently dropped.
 */
export async function loadCoreMemoryForPrompt(maxTokens = Number.POSITIVE_INFINITY) {
  await ensureMemoryDirs();
  const files = await listMemoryFiles();
  const coreFiles = files
    .filter((file) => file.path.startsWith("core/"))
    .sort((a, b) => coreSortKey(a) - coreSortKey(b) || a.path.localeCompare(b.path));

  const chunks: string[] = [];
  let usedTokens = 0;
  let skipped = 0;

  for (const file of coreFiles) {
    const chunk = `### ${file.path}\n${file.content.trim()}`;
    const chunkTokens = estimateTokens(chunk);

    if (Number.isFinite(maxTokens) && chunks.length > 0 && usedTokens + chunkTokens > maxTokens) {
      skipped += 1;
      continue;
    }

    chunks.push(chunk);
    usedTokens += chunkTokens;
  }

  if (skipped > 0) {
    chunks.push(`[Memory budget note: ${skipped} core file(s) were not injected because the context window budget was reached.]`);
  }

  return chunks.join("\n\n---\n\n");
}
