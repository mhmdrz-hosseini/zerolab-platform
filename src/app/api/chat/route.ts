import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { chats, messages } from "@/db/schema";
import { SERVICE_COOKIE, isServiceSlug } from "@/config/services";
import { SYSTEM_PROMPT, buildServiceContext } from "@/lib/chat-context";
import { GLM_CHAT_MODEL, GLM_VISION_MODEL, getGlmClient } from "@/server/glm/client";
import { MAX_IMAGES_PER_REQUEST, resolveImageDataUrl } from "@/server/glm/images";
import {
  InsufficientCreditsError,
  consume,
  getOrCreateSession,
  refund,
} from "@/server/credits";

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
type IncomingMessage = {
  role: "user" | "assistant";
  content: string | Array<TextPart | ImagePart>;
};

interface ChatBody {
  messages?: IncomingMessage[];
  chatId?: string;
}

/** Ticket 06/12: only the last 20 transcript messages reach the model. */
const HISTORY_LIMIT = 20;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimal chunk shape we consume from GLM's SSE stream. */
interface ChatChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
}

function textOf(m: IncomingMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

function stripImages(history: IncomingMessage[]): IncomingMessage[] {
  return history.map((m) => {
    if (typeof m.content === "string") return m;
    const text = textOf(m);
    return { ...m, content: text };
  });
}

/**
 * Inline image parts into data URLs the vision model can consume — library
 * references arrive as `/api/files/…` (local storage) or proxied remote URLs,
 * neither of which Z.ai can fetch by itself. Newest references win when a
 * long transcript exceeds the per-request image cap; unresolvable parts are
 * dropped so one dead URL never kills the turn.
 */
async function inlineImages(
  history: IncomingMessage[],
): Promise<{ messages: IncomingMessage[]; imageCount: number }> {
  const urls: string[] = [];
  for (const m of [...history].reverse()) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const part of m.content) {
      if (part.type === "image_url") urls.push(part.image_url.url);
    }
  }
  const capped = [...new Set(urls)].slice(0, MAX_IMAGES_PER_REQUEST);
  const resolved = new Map<string, string>();
  await Promise.all(
    capped.map(async (url) => {
      const dataUrl = await resolveImageDataUrl(url);
      if (dataUrl) resolved.set(url, dataUrl);
    }),
  );
  if (resolved.size === 0) {
    return { messages: stripImages(history), imageCount: 0 };
  }
  const messages = history.map((m) => {
    if (typeof m.content === "string") return m;
    const content = m.content
      .map((part) => {
        if (part.type !== "image_url") return part;
        const dataUrl = resolved.get(part.image_url.url);
        return dataUrl
          ? ({ type: "image_url", image_url: { url: dataUrl } } as ImagePart)
          : null;
      })
      .filter((part): part is TextPart | ImagePart => part !== null);
    return { ...m, content };
  });
  return { messages, imageCount: resolved.size };
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const history = body.messages ?? [];
  if (history.length === 0) {
    return NextResponse.json({ error: "messages_required" }, { status: 400 });
  }

  const sessionId = await getOrCreateSession();
  const db = getDb();
  const jar = await cookies();

  // Service world (ticket 11) — read-only here; the picker route owns the
  // cookie. Falls back to the schema default when unset/invalid.
  const serviceCookie = jar.get(SERVICE_COOKIE)?.value;
  const service = isServiceSlug(serviceCookie) ? serviceCookie : "silicone-mold";

  // Resolve (and own) or create the chat. A client-generated chatId that is
  // not found yet is created as-is, so the panel can hold a stable chat id
  // for `lab:generate-image` before the first request ever succeeded.
  let chatId: string;
  if (body.chatId) {
    if (!UUID_RE.test(body.chatId)) {
      return NextResponse.json({ error: "invalid_chat_id" }, { status: 400 });
    }
    const rows = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, body.chatId), eq(chats.sessionId, sessionId)))
      .limit(1);
    if (rows[0]) {
      chatId = rows[0].id;
    } else {
      // Id already owned by another session (uuid probe) → 404, not a 500.
      const [row] = await db
        .insert(chats)
        .values({ id: body.chatId, sessionId, service })
        .onConflictDoNothing()
        .returning({ id: chats.id });
      if (!row) {
        return NextResponse.json({ error: "chat_not_found" }, { status: 404 });
      }
      chatId = row.id;
    }
  } else {
    const [row] = await db
      .insert(chats)
      .values({ sessionId, service })
      .returning({ id: chats.id });
    chatId = row.id;
  }

  let movement: Awaited<ReturnType<typeof consume>>;
  try {
    movement = await consume(sessionId, "chat", chatId);
  } catch (err) {
    // Quota exhausted (ticket 05) — the client shows the credit wall on 402.
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: "insufficient_credits", kind: err.kind },
        { status: 402 },
      );
    }
    throw err;
  }

  // Persist only the newest turn — the client owns the full transcript.
  const trimmed = history.slice(-HISTORY_LIMIT);
  const last = trimmed[trimmed.length - 1];
  if (last.role === "user") {
    const firstImage =
      typeof last.content === "string"
        ? null
        : (last.content.find((p) => p.type === "image_url")?.image_url.url ??
          null);
    await db.insert(messages).values({
      chatId,
      role: "user",
      content: textOf(last),
      ...(firstImage ? { imageUrl: firstImage } : {}),
    });
  }

  // Reference images → data URLs for the vision model.
  const prepared = await inlineImages(trimmed);
  const useVision = prepared.imageCount > 0;

  try {
    const client = getGlmClient();
    const createStream = async (model: string, system: string, msgs: IncomingMessage[]) =>
      (await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: system }, ...msgs],
        stream: true,
        thinking: { type: "disabled" },
      } as Parameters<typeof client.chat.completions.create>[0])) as unknown as AsyncIterable<ChatChunk>;
    // Verbatim system prompt (ticket 06) + one-line service context (ticket 12).
    const serviceContext = buildServiceContext(serviceCookie ?? null);
    let systemContent = serviceContext
      ? `${SYSTEM_PROMPT}\n\n${serviceContext}`
      : SYSTEM_PROMPT;
    // glm-4.5-flash thinks by default — disable for cheap, fast ideation
    // (same intent as the old reasoning_effort:"low"; Z.ai-specific param).
    let stream: AsyncIterable<ChatChunk>;
    try {
      stream = useVision
        ? await createStream(GLM_VISION_MODEL, systemContent, prepared.messages)
        : await createStream(GLM_CHAT_MODEL, systemContent, prepared.messages);
    } catch (err) {
      if (!useVision) throw err;
      // Vision model unavailable (saturated/entitlement) — degrade honestly:
      // the text model must say it cannot see the image right now and keep
      // working from the textual design metadata instead of faking vision.
      console.warn(
        `[api/chat] vision model ${GLM_VISION_MODEL} unavailable — degrading to text`,
        err instanceof Error ? err.message : err,
      );
      systemContent +=
        "\n\nیادداشت: تصویر پیوست‌شده به مدل تصویری نرسید و الان قابل دیدن نیست؛ همین را در یک جملهٔ کوتاه صادقانه به کاربر بگو و فعلاً بر اساس توضیحات متنیِ همان طرح پیش برو — از صفر شروع نکن.";
      stream = await createStream(
        GLM_CHAT_MODEL,
        systemContent,
        stripImages(prepared.messages),
      );
    }

    const encoder = new TextEncoder();
    let full = "";
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`),
              );
            }
          }
          if (full) {
            await db
              .insert(messages)
              .values({ chatId, role: "assistant", content: full });
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(sse, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    // Upstream never produced anything billable — give the credit back.
    await refund(sessionId, movement, chatId);
    console.error("[api/chat] glm request failed", err);
    return NextResponse.json({ error: "upstream_failed" }, { status: 502 });
  }
}
