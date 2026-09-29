import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { images } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";
import { getStorage } from "@/server/storage";

/**
 * «ذخیره در لایبریری من» (ticket 15, issue 08 two-way contract): the final
 * confirmed image from the chat/image flow gets a session-scoped copy row
 * with kind='saved'. The copy shares the original storageKey — no duplicate
 * bytes. Consumes no credits.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let body: { imageId?: unknown };
  try {
    body = (await req.json()) as { imageId?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const imageId = typeof body.imageId === "string" ? body.imageId : "";
  if (!UUID_RE.test(imageId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const sessionId = await getOrCreateSession();
  const db = getDb();

  // Session-scoped: only the owner may save a copy of this image.
  const rows = await db
    .select()
    .from(images)
    .where(and(eq(images.id, imageId), eq(images.sessionId, sessionId)))
    .limit(1);
  const source = rows[0];
  if (!source) {
    return NextResponse.json(
      { error: "not_found", message: "تصویری برای ذخیره پیدا نشد." },
      { status: 404 },
    );
  }

  const sourceMeta = (source.meta ?? {}) as Record<string, unknown>;
  const str = (key: string): string | null => {
    const value = sourceMeta[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  const copyId = randomUUID();
  const meta = {
    title: "طرح ذخیره‌شده",
    category: str("category"),
    description: str("description") ?? str("prompt") ?? "",
    seedPrompt: null,
    savedFrom: imageId,
    savedFromKind: source.kind,
  };

  await db.insert(images).values({
    id: copyId,
    sessionId,
    chatId: source.chatId,
    kind: "saved",
    storageKey: source.storageKey,
    mime: source.mime,
    isSeed: false,
    meta,
  });

  const url = getStorage().publicUrl(source.storageKey);
  return NextResponse.json({
    imageId: copyId,
    url,
    item: {
      id: copyId,
      title: meta.title,
      category: meta.category,
      categoryLabel: null,
      description: meta.description,
      seedPrompt: null,
      url,
      kind: "saved",
      isSeed: false,
      createdAt: new Date().toISOString(),
    },
  });
}
