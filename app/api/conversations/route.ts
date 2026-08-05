import { createConversation, getConversation, listConversations, listMessages } from "@/lib/conversations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/conversations — list all; GET /api/conversations?id=… — one with messages. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    const conversation = getConversation(id);
    if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
    return Response.json({ conversation, messages: listMessages(id, 500) });
  }

  return Response.json({ conversations: listConversations(100) });
}

/** POST /api/conversations { title? } — create a new thread. */
export async function POST(request: Request) {
  let title: string | undefined;
  try {
    const body = (await request.json()) as { title?: string };
    title = body.title;
  } catch {
    title = undefined;
  }
  const conversation = createConversation(title);
  return Response.json({ conversation }, { status: 201 });
}
