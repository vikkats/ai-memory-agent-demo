import { runChatTurn } from "@/lib/chatEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chat { conversationId?, message }
 * Streams one chat turn as server-sent events:
 *   data: {"type":"status"|"meta"|"token"|"tool"|"done"|"error", ...}
 */
export async function POST(request: Request) {
  let body: { conversationId?: string; message?: string };
  try {
    body = (await request.json()) as { conversationId?: string; message?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message is required." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of runChatTurn({
          conversationId: body.conversationId,
          message,
        })) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
