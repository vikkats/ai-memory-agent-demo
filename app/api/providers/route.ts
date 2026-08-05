import { getAppSettings, setAppSettings } from "@/lib/appSettings";
import {
  getActiveProvider,
  isMockProvider,
  listProviders,
  redactProvider,
  setActiveProvider,
  upsertProvider,
} from "@/lib/providers";
import { getVectorStore } from "@/lib/vectorStore";
import type { ProviderSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/providers — redacted provider list, app settings, vector status. */
export async function GET() {
  const providers = listProviders().map(redactProvider);
  const active = getActiveProvider();
  let vectorPointCount = 0;
  let vectorBackend = "local";
  if (active) {
    try {
      const store = getVectorStore(active);
      vectorBackend = store.kind;
      vectorPointCount = await store.count();
    } catch {
      vectorPointCount = 0;
    }
  }
  return Response.json({
    providers,
    appSettings: getAppSettings(),
    vectorBackend,
    vectorPointCount,
    mockMode: active ? isMockProvider(active) : true,
  });
}

/**
 * POST /api/providers — actions:
 *   { action: "activate", id }
 *   { action: "app-settings", timezone?, watcherConversationId? }
 *   { action: "upsert", provider: {…}, activate? }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string;
    id?: string;
    timezone?: string;
    watcherConversationId?: string;
    provider?: Partial<ProviderSettings> & { name: string };
    activate?: boolean;
  };

  try {
    switch (body.action) {
      case "activate": {
        if (!body.id) return Response.json({ error: "id is required." }, { status: 400 });
        const ok = setActiveProvider(body.id);
        if (!ok) return Response.json({ error: "Provider not found." }, { status: 404 });
        return Response.json({ ok: true });
      }
      case "app-settings": {
        const settings = setAppSettings({
          timezone: body.timezone,
          watcherConversationId: body.watcherConversationId,
        });
        return Response.json({ appSettings: settings });
      }
      case "upsert": {
        if (!body.provider?.name) {
          return Response.json({ error: "provider.name is required." }, { status: 400 });
        }
        const saved = upsertProvider(body.provider);
        if (body.activate) setActiveProvider(saved.id);
        return Response.json({ provider: redactProvider(saved) }, { status: 201 });
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
