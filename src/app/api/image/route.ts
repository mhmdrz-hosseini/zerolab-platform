import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { chats, images } from "@/db/schema";
import {
  InsufficientCreditsError,
  consume,
  getOrCreateSession,
  refund,
  type CreditMovement,
} from "@/server/credits";
import { IMAGE_NEGATIVE_PROMPT } from "@/lib/image-prompt";
import { qaCheckImage } from "@/server/glm/image-qa";
import { enSubjectHint } from "@/server/glm/en-subject";
import { QWEN_IMAGE_MODEL, generateWithQwen } from "@/server/comfy/qwen";
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

/**
 * Append the English object phrase to the composed prompt (probe-proven
 * mode anchor). GLM failure degrades to the original prompt.
 */
async function withSubjectHint(
  prompt: string,
  brief?: string,
): Promise<string> {
  const hint = await enSubjectHint(brief?.trim() ? brief : prompt);
  if (!hint) return prompt;
  return `${prompt}\n(photograph of ${hint})`;
}

interface ImageBody {
  prompt?: string;
  /** The raw spec-card brief — used for the English subject hint. */
  brief?: string;
  aspectRatio?: string;
  chatId?: string;
  /** Optional reference image (variation/standardize turns) — an images.id owned by this session. */
  refImageId?: string;
  /** 'generated' (default) | 'standardized' — stored on the images row (issue 13). */
  kind?: string;
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
  // session. Its bytes are uploaded to ComfyUI and drive the Qwen edit graph
  // (ref = edit-encoder image1 + latent source).
  let ref: { bytes: Uint8Array; mime: string } | null = null;
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
    const refRow = refRows[0];
    const stored = refRow ? await storage.get(refRow.storageKey) : null;
    if (!refRow || !stored) {
      return NextResponse.json({ error: "ref_not_found" }, { status: 404 });
    }
    ref = { bytes: stored.bytes, mime: stored.mime };
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
    // Qwen Image 2.1 on the local ComfyUI server (chat stays on Aval).
    // English subject hint: Persian religious/architectural subjects render
    // as text documents without it (2026-10-08 shrine failure — the probe
    // isolated the hint as the decisive lever).
    const fullPrompt = await withSubjectHint(prompt, body.brief);
    const genOpts = {
      prompt: fullPrompt,
      negativePrompt: IMAGE_NEGATIVE_PROMPT,
      aspectRatio,
      refBytes: ref?.bytes ?? null,
      refMime: ref?.mime,
    };
    let result = await generateWithQwen(genOpts);
    const meta: Record<string, unknown> = {
      prompt,
      aspectRatio,
      model: QWEN_IMAGE_MODEL,
      seed: result.seed,
      refImageId:
        typeof body.refImageId === "string" && body.refImageId
          ? body.refImageId
          : null,
    };

    // QA gate (2026-10-08): the vision model judges every frame before it is
    // ever shown; text/document/multi-object frames get ONE free re-roll —
    // the shrine turn rendered the prompt as a document in all 4 slots. The
    // re-roll is on us (same 1 credit), and an unreachable judge skips the
    // gate instead of failing the request.
    const first = await qaCheckImage(result.bytes, result.mime);
    if (first.status === "fail") {
      const retried = await generateWithQwen(genOpts);
      const second = await qaCheckImage(retried.bytes, retried.mime);
      result = retried;
      meta.seed = result.seed;
      meta.qa =
        second.status === "pass"
          ? { retried: true, final: "pass", first: first.verdict }
          : second.status === "fail"
            ? { retried: true, final: "fail", first: first.verdict, second: second.verdict }
            : { retried: true, final: "skipped", reason: second.reason, first: first.verdict };
    } else if (first.status === "pass") {
      meta.qa = { retried: false, final: "pass", summary: first.verdict.summary };
    } else {
      meta.qa = { final: "skipped", reason: first.reason };
    }

    const mime = result.mime; // SaveImage output is always PNG
    const key = `images/${sessionId}/${imageId}.png`;
    await storage.put(key, result.bytes, mime);

    await db.insert(images).values({
      id: imageId,
      sessionId,
      chatId,
      kind,
      storageKey: key,
      mime,
      meta,
    });

    return NextResponse.json({ imageId, url: storage.publicUrl(key) });
  } catch (err) {
    await refund(sessionId, movement, imageId);
    console.error("[api/image] generation failed", err);
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }
}
