import { listConversations, listMessages } from "./conversations";
import { listMemoryFiles, readMemoryFile } from "./memory";
import { getMaintenanceStatus } from "./maintenance";

export interface WorkspaceExport {
  exportedAt: string;
  format: "ai-memory-agent-demo-export/v1";
  conversations: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
      metadata: Record<string, unknown> | null;
    }>;
  }>;
  memoryFiles: Array<{
    path: string;
    room: string;
    content: string;
    updatedAt: string;
  }>;
  maintenance: ReturnType<typeof getMaintenanceStatus>;
}

/**
 * Export the full workspace (conversations + memory files + maintenance
 * status) as portable JSON. Provider settings and API keys are deliberately
 * excluded — an export must never carry secrets.
 */
export function exportWorkspace(): WorkspaceExport {
  const conversations = listConversations(500).map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    messages: listMessages(c.id, 5000).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      metadata: m.metadata ?? null,
    })),
  }));

  const memoryFiles = listMemoryFiles().map((f) => ({
    path: f.path,
    room: f.room,
    content: readMemoryFile(f.path).content,
    updatedAt: f.updatedAt,
  }));

  return {
    exportedAt: new Date().toISOString(),
    format: "ai-memory-agent-demo-export/v1",
    conversations,
    memoryFiles,
    maintenance: getMaintenanceStatus(),
  };
}
