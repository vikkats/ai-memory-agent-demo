import { exportWorkspace } from "@/lib/exportData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export — download the full workspace as JSON (no secrets). */
export async function GET() {
  const data = await exportWorkspace();
  const filename = `workspace-export-${data.exportedAt.slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
    },
  });
}
