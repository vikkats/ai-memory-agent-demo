import { cancelCheckIn, createCheckIn, listCheckIns, runCheckInCycle } from "@/lib/checkIns";
import { getActiveProvider } from "@/lib/providers";
import type { CheckInRecurrence } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/checkins — list all scheduled check-ins. */
export async function GET() {
  return Response.json({ checkIns: listCheckIns(100) });
}

/**
 * POST /api/checkins — either run a cycle or create a check-in:
 *   { action: "run" }
 *   { title, intent, fallbackMessage, dueAt, recurrence?, conversationId? }
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    action?: string;
    title?: string;
    intent?: string;
    fallbackMessage?: string;
    dueAt?: string;
    recurrence?: CheckInRecurrence;
    conversationId?: string;
  };

  try {
    if (body.action === "run") {
      const provider = getActiveProvider();
      if (!provider) return Response.json({ error: "No active provider." }, { status: 400 });
      const result = await runCheckInCycle(provider);
      return Response.json({ result });
    }

    if (!body.title || !body.intent || !body.fallbackMessage || !body.dueAt) {
      return Response.json(
        { error: "title, intent, fallbackMessage and dueAt are required." },
        { status: 400 },
      );
    }
    const checkIn = createCheckIn({
      title: body.title,
      intent: body.intent,
      fallbackMessage: body.fallbackMessage,
      dueAt: body.dueAt,
      recurrence: body.recurrence,
      conversationId: body.conversationId,
    });
    return Response.json({ checkIn }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

/** DELETE /api/checkins?id=… — cancel a pending check-in. */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ error: "id is required." }, { status: 400 });
  const ok = cancelCheckIn(id);
  if (!ok) return Response.json({ error: "Check-in not found or already resolved." }, { status: 404 });
  return Response.json({ ok: true });
}
