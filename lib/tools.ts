import { summarizeAndIndexConversation } from "./conversationSummaries";
import {
  appendJournalEntry,
  editMemoryFileWithBackup,
  listMemoryFiles,
  readMemoryFile,
} from "./memory";
import { proposeMemoryEdit } from "./pendingEdits";
import { formatRetrievedMemories, searchMemories } from "./retrieval";
import { localDateTimeForPrompt } from "./time";
import type { ProviderSettings } from "./types";

export interface RuntimeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolExecutionContext {
  conversationId: string;
}

/**
 * The runtime tool surface exposed to the model. Every tool maps to a real
 * workspace capability: memory files, retrieval, journaling, summaries.
 */
export const RUNTIME_TOOLS: RuntimeTool[] = [
  {
    name: "read_memory_file",
    description: "Read the full contents of a memory file by its workspace-relative path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative .md path, e.g. notes/demo_notes.md" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_memory_files",
    description: "List all memory files in the workspace with size and last-modified metadata.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "append_journal_entry",
    description: "Append a timestamped entry to today's journal file.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Markdown content of the journal entry." },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_memory_file",
    description:
      "Overwrite a memory file directly. A timestamped backup is created first. Prefer propose_memory_edit for significant rewrites.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string", description: "Full new file content." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_memory_edit",
    description:
      "Propose a change to a memory file without applying it. The proposal is queued for human review and can be accepted or rejected.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        proposedContent: { type: "string", description: "Full proposed file content." },
        reason: { type: "string", description: "Why this change should be made." },
      },
      required: ["path", "proposedContent", "reason"],
      additionalProperties: false,
    },
  },
  {
    name: "search_memory",
    description:
      "Semantic search over indexed memory files, conversation messages, and conversation summaries.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        limit: { type: "number", description: "Max results to return (1-15, default 6)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_current_time",
    description: "Get the current local date/time in the configured workspace timezone.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "summarize_conversation",
    description:
      "Summarize the current conversation (optionally for a date window), persist the summary, and index it for retrieval.",
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "Optional YYYY-MM-DD window start." },
        endDate: { type: "string", description: "Optional YYYY-MM-DD window end." },
      },
      additionalProperties: false,
    },
  },
];

export function listAvailableTools(enabled: boolean): RuntimeTool[] {
  return enabled ? RUNTIME_TOOLS : [];
}

function clampLimit(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 6;
  return Math.min(15, Math.max(1, n));
}

/**
 * Execute one runtime tool. Returns a plain JSON-serialisable result object;
 * failures are returned as { ok: false, error } instead of throwing so the
 * model can see and react to the error.
 */
export async function executeRuntimeTool(
  provider: ProviderSettings,
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
): Promise<Record<string, unknown>> {
  try {
    switch (toolName) {
      case "read_memory_file": {
        const file = readMemoryFile(String(args.path ?? ""));
        return { ok: true, path: file.path, content: file.content, sizeBytes: file.sizeBytes };
      }
      case "list_memory_files": {
        const files = listMemoryFiles().map((f) => ({
          path: f.path,
          room: f.room,
          sizeBytes: f.sizeBytes,
          updatedAt: f.updatedAt,
        }));
        return { ok: true, count: files.length, files };
      }
      case "append_journal_entry": {
        const result = appendJournalEntry(String(args.content ?? ""));
        return { ok: true, path: result.path, timestamp: result.timestamp };
      }
      case "edit_memory_file": {
        const result = editMemoryFileWithBackup(String(args.path ?? ""), String(args.content ?? ""));
        return { ok: true, path: result.path, backupPath: result.backupPath };
      }
      case "propose_memory_edit": {
        const edit = proposeMemoryEdit({
          path: String(args.path ?? ""),
          proposedContent: String(args.proposedContent ?? ""),
          reason: String(args.reason ?? ""),
          conversationId: context.conversationId,
        });
        return { ok: true, proposalId: edit.id, path: edit.path, status: edit.status };
      }
      case "search_memory": {
        const results = await searchMemories(provider, String(args.query ?? ""), clampLimit(args.limit));
        return {
          ok: true,
          count: results.length,
          results: results.map((r) => ({
            id: r.id,
            source: r.source,
            score: r.score,
            rankScore: r.rankScore,
            text: r.text.slice(0, 500),
          })),
        };
      }
      case "get_current_time": {
        return { ok: true, local: localDateTimeForPrompt() };
      }
      case "summarize_conversation": {
        const startDate = typeof args.startDate === "string" ? args.startDate : undefined;
        const endDate = typeof args.endDate === "string" ? args.endDate : undefined;
        const summary = await summarizeAndIndexConversation(provider, context.conversationId, {
          startDate,
          endDate,
        });
        if (!summary) return { ok: false, error: "Nothing to summarize in that window." };
        return {
          ok: true,
          summaryId: summary.id,
          messageCount: summary.messageCount,
          indexed: true,
          preview: formatRetrievedMemories(
            [{ id: summary.id, source: "conversation_summary", score: 1, rankScore: 1, text: summary.summaryText }],
            400,
          ),
        };
      }
      default:
        return { ok: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
