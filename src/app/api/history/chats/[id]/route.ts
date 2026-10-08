import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { chats, messages } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";

/** Full transcript of one chat — session-scoped, for history restore. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = await getOrCreateSession();
  const db = getDb();

  const [chat] = await db
    .select({ id: chats.id, service: chats.service })
    .from(chats)
    .where(and(eq(chats.id, id), eq(chats.sessionId, sessionId)))
    .limit(1);
  if (!chat) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rows = await db
    .select({ role: messages.role, content: messages.content, imageUrl: messages.imageUrl })
    .from(messages)
    .where(eq(messages.chatId, id))
    .orderBy(asc(messages.createdAt), asc(messages.id));

  return NextResponse.json({
    id: chat.id,
    service: chat.service,
    messages: rows.map((r) => ({
      role: r.role,
      content: r.content,
      ...(r.imageUrl ? { imageUrl: r.imageUrl } : {}),
    })),
  });
}
