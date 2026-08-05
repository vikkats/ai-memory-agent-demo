import { getMaintenanceStatus, runMaintenanceCycle } from "@/lib/maintenance";
import { getActiveProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/maintenance — current maintenance status. */
export async function GET() {
  return Response.json({ status: getMaintenanceStatus() });
}

/** POST /api/maintenance { force?, summarize? } — run a maintenance cycle. */
export async function POST(request: Request) {
  let options: { force?: boolean; summarize?: boolean } = {};
  try {
    options = (await request.json()) as { force?: boolean; summarize?: boolean };
  } catch {
    options = {};
  }

  const provider = getActiveProvider();
  if (!provider) return Response.json({ error: "No active provider." }, { status: 400 });

  const result = await runMaintenanceCycle(provider, {
    force: options.force === true,
    summarize: options.summarize,
  });
  return Response.json({ result });
}
