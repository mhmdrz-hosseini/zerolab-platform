import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { chats, images } from "@/db/schema";
import { AVAL_IMAGE_MODEL, getAvalClient } from "@/server/aval/client";
import {
  InsufficientCreditsError,
  consume,
  getOrCreateSession,
  refund,
  type CreditMovement,
} from "@/server/credits";
import { getStorage } from "@/server/storage";

const ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "5:4",
  "4:5",
  "21:9",
] as const;

const IMAGE_KINDS = ["generated", "standardized"] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ImageBody {
  prompt?: string;
  aspectRatio?: string;
  chatId?: string;
  /** Optional reference image (variation/standardize turns) — an images.id owned by this session. */
  refImageId?: string;
  /** 'generated' (default) | 'standardized' — stored on the images row (issue 13). */
  kind?: string;
}

/** Aval Gemini-image response shape (issue 01). */
interface AvalImageResponse {
  choices?: Array<{
    message?: {
      images?: Array<{ image_url?: { url?: string } }>;
    };
  }>;
}

/** Vision/reference content part (issue 01 — image input rides chat completions). */
interface AvalContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

function extForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/webp") return ".webp";
  return ".png";
}

export async function POST(req: Request) {
  let body: ImageBody;
  try {
    body = (await req.json()) as ImageBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt_required" }, { status: 400 });
  }
  const aspectRatio = (
    ASPECT_RATIOS as readonly string[]
  ).includes(body.aspectRatio ?? "")
    ? (body.aspectRatio as (typeof ASPECT_RATIOS)[number])
    : "1:1";
  const kind = (IMAGE_KINDS as readonly string[]).includes(body.kind ?? "")
    ? (body.kind as (typeof IMAGE_KINDS)[number])
    : "generated";

  const sessionId = await getOrCreateSession();
  const db = getDb();
  const storage = getStorage();

  let chatId: string | null = null;
  if (body.chatId) {
    const rows = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, body.chatId), eq(chats.sessionId, sessionId)))
      .limit(1);
    if (!rows[0]) {
      return NextResponse.json({ error: "chat_not_found" }, { status: 404 });
    }
    chatId = rows[0].id;
  }

  // Optional reference image (issue 13): must be an image row owned by this
  // session. Inlined as a base64 data URL — Aval's vision input accepts data
  // URLs (issue 01); the local driver's relative publicUrl would not be
  // fetchable by the provider.
  let refDataUrl: string | null = null;
  if (typeof body.refImageId === "string" && body.refImageId) {
    if (!UUID_RE.test(body.refImageId)) {
      return NextResponse.json({ error: "invalid_ref" }, { status: 400 });
    }
    const refRows = await db
      .select({ storageKey: images.storageKey, mime: images.mime })
      .from(images)
      .where(
        and(eq(images.id, body.refImageId), eq(images.sessionId, sessionId)),
      )
      .limit(1);
    const ref = refRows[0];
    const stored = ref ? await storage.get(ref.storageKey) : null;
    if (!ref || !stored) {
      return NextResponse.json({ error: "ref_not_found" }, { status: 404 });
    }
    refDataUrl = `data:${ref.mime};base64,${Buffer.from(stored.bytes).toString("base64")}`;
  }

  const imageId = randomUUID();
  let movement: CreditMovement;
  try {
    movement = await consume(sessionId, "image", imageId);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      // Ticket 05/16: the client shows the Persian lock banner on 402.
      return NextResponse.json(
        { error: "insufficient_credits", kind: err.kind },
        { status: 402 },
      );
    }
    throw err;
  }

  try {
    const client = getAvalClient();
    // Gemini image generation rides the chat-completions endpoint with
    // modalities + generationConfig extras (Aval-specific, issue 01).
    const content: string | AvalContentPart[] = refDataUrl
      ? [
          { type: "image_url", image_url: { url: refDataUrl } },
          { type: "text", text: prompt },
        ]
      : prompt;
    const completion = (await client.chat.completions.create({
      model: AVAL_IMAGE_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content }],
      generationConfig: {
        imageConfig: { aspectRatio, imageSize: "1K" },
      },
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as Awaited<
      ReturnType<typeof client.chat.completions.create>
    > &
      AvalImageResponse;

    const dataUrl =
      completion.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      throw new Error("Aval returned no image payload");
    }
    const [header, b64] = dataUrl.split(",", 2);
    const mime = /^data:([^;]+)/.exec(header ?? "")?.[1] ?? "image/png";
    const bytes = Buffer.from(b64 ?? "", "base64");
    if (bytes.length === 0) throw new Error("Aval image payload was empty");

    const key = `images/${sessionId}/${imageId}${extForMime(mime)}`;
    await storage.put(key, new Uint8Array(bytes), mime);

    await db.insert(images).values({
      id: imageId,
      sessionId,
      chatId,
      kind,
      storageKey: key,
      mime,
      meta: {
        prompt,
        aspectRatio,
        model: AVAL_IMAGE_MODEL,
        refImageId:
          typeof body.refImageId === "string" && body.refImageId
            ? body.refImageId
            : null,
      },
    });

    return NextResponse.json({ imageId, url: storage.publicUrl(key) });
  } catch (err) {
    await refund(sessionId, movement, imageId);
    console.error("[api/image] generation failed", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}
