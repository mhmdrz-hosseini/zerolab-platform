import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { chats, images, messages } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";
import { getStorage } from "@/server/storage";

/**
 * Session history (2026-10-05): the lab client used to own the transcript in
 * memory only — a reload lost everything even though Postgres had the rows.
 * This API lists the session's chats and images with cursor pagination
 * (opaque base64 cursor over (created_at, id)), so the drawer scales to
 * thousands of rows without offset scans.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(raw: string | null): { ts: Date; id: string } | null {
  if (!raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    const ts = new Date(iso ?? "");
    if (Number.isNaN(ts.getTime()) || !id) return null;
    return { ts, id };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") === "images" ? "images" : "chats";
  const limitRaw = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT));
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  const sessionId = await getOrCreateSession();
  const db = getDb();

  // Tuple comparison keeps the (created_at, id) index-ordered scan stable
  // across rows that share a timestamp.
  const cursorClause = cursor
    ? () => sql`(${chats.createdAt}, ${chats.id}) < (${cursor.ts}, ${cursor.id})`
    : null;

  if (type === "chats") {
    const rows = await db
      .select({
        id: chats.id,
        service: chats.service,
        title: chats.title,
        createdAt: chats.createdAt,
      })
      .from(chats)
      .where(
        cursorClause
          ? and(eq(chats.sessionId, sessionId), cursorClause())
          : eq(chats.sessionId, sessionId),
      )
      .orderBy(desc(chats.createdAt), desc(chats.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);

    // Per-chat excerpt + counts in one grouped query over the page's chat ids
    // (messages_chat_idx; correlated subqueries render unreliably here).
    const ids = page.map((r) => r.id);
    const stats = ids.length
      ? await db
          .select({
            chatId: messages.chatId,
            count: sql<number>`count(*)::int`,
            firstUser: sql<string | null>`(array_remove(array_agg(${messages.content} order by ${messages.createdAt}, ${messages.id}) filter (where ${messages.role} = 'user'), null))[1]`,
          })
          .from(messages)
          .where(sql`${messages.chatId} in ${ids}`)
          .groupBy(messages.chatId)
      : [];
    const byChat = new Map(stats.map((s) => [s.chatId, s]));

    const last = page[page.length - 1];
    return NextResponse.json({
      items: page.map((r) => ({
        id: r.id,
        service: r.service,
        createdAt: r.createdAt,
        messageCount: byChat.get(r.id)?.count ?? 0,
        excerpt: (r.title || byChat.get(r.id)?.firstUser || "").slice(0, 120),
      })),
      nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
    });
  }

  const rows = await db
    .select({
      id: images.id,
      kind: images.kind,
      mime: images.mime,
      storageKey: images.storageKey,
      createdAt: images.createdAt,
      chatId: images.chatId,
    })
    .from(images)
    .where(
      cursor
        ? and(
            eq(images.sessionId, sessionId),
            sql`(${images.createdAt}, ${images.id}) < (${cursor.ts}, ${cursor.id})`,
          )
        : eq(images.sessionId, sessionId),
    )
    .orderBy(desc(images.createdAt), desc(images.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const storage = getStorage();
  return NextResponse.json({
    items: page.map((r) => ({
      id: r.id,
      kind: r.kind,
      url: storage.publicUrl(r.storageKey),
      createdAt: r.createdAt,
      chatId: r.chatId,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  });
}
