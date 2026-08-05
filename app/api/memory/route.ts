import { indexMemoryFiles } from "@/lib/indexing";
import { editMemoryFileWithBackup, listMemoryFiles, readMemoryFile } from "@/lib/memory";
import { listPendingEdits, proposeMemoryEdit, resolvePendingEdit } from "@/lib/pendingEdits";
import { getActiveProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/memory              → list all memory files
 * GET /api/memory?path=…       → read one file
 * GET /api/memory?proposals=1  → list pending edit proposals
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  if (searchParams.get("proposals") === "1") {
    return Response.json({ proposals: listPendingEdits("pending") });
  }

  const path = searchParams.get("path");
  if (path) {
    try {
      const file = await readMemoryFile(path);
      return Response.json({ file });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 404 },
      );
    }
  }

  const files = await listMemoryFiles();
  return Response.json({
    files: files.map((f) => ({ path: f.path, name: f.name, updatedAt: f.updatedAt })),
  });
}

/** PUT /api/memory { path, content } — overwrite with automatic backup. */
export async function PUT(request: Request) {
  const body = (await request.json()) as { path?: string; content?: string };
  if (!body.path || typeof body.content !== "string") {
    return Response.json({ error: "path and content are required." }, { status: 400 });
  }
  try {
    const result = await editMemoryFileWithBackup(body.path, body.content);
    return Response.json({ file: result.file, backupPath: result.backupPath });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

/**
 * POST /api/memory — actions:
 *   { action: "propose", path, proposedContent, reason? }
 *   { action: "accept" | "reject", id }
 *   { action: "reindex", paths? }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string;
    id?: string;
    path?: string;
    proposedContent?: string;
    reason?: string;
    paths?: string[];
  };

  try {
    switch (body.action) {
      case "propose": {
        if (!body.path || typeof body.proposedContent !== "string") {
          return Response.json({ error: "path and proposedContent are required." }, { status: 400 });
        }
        const proposal = await proposeMemoryEdit({
          path: body.path,
          proposedContent: body.proposedContent,
          reason: body.reason,
        });
        return Response.json({ proposal }, { status: 201 });
      }
      case "accept":
      case "reject": {
        if (!body.id) return Response.json({ error: "id is required." }, { status: 400 });
        const resolved = await resolvePendingEdit(body.id, body.action);
        return Response.json({ proposal: resolved, backupPath: resolved.backupPath });
      }
      case "reindex": {
        const provider = getActiveProvider();
        if (!provider) return Response.json({ error: "No active provider." }, { status: 400 });
        const result = await indexMemoryFiles(body.paths, provider);
        return Response.json({ result });
      }
      default:
        return Response.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
