import "server-only";
import { getGlmClient, GLM_VISION_MODEL } from "./client";

/**
 * Vision QA gate for generated images (2026-10-08). The shrine turn rendered
 * the prompt itself as a Persian text document in all 4 slots — Qwen Image's
 * text-rendering strength plus religious/architectural subjects (inscriptions)
 * makes "text/document" a real failure class, so every generation is judged
 * before it is shown. Hard-failure classes get one automatic re-roll in the
 * route; a 429/1305 from the vision model skips the gate honestly (same
 * degrade path as the vision chat).
 */

export interface ImageQaVerdict {
  floatingText: boolean;
  isDocument: boolean;
  singleObject: boolean;
  summary: string;
}

export type ImageQaResult =
  | { status: "pass"; verdict: ImageQaVerdict }
  | { status: "fail"; verdict: ImageQaVerdict }
  | { status: "skipped"; reason: string };

const QA_PROMPT = `You are a strict QA judge for studio product images destined for a mold-manufacturing pipeline (a 3D model will be built from the image).
Judge ONLY these hard-failure classes and answer ONLY with compact JSON, no markdown:
{"floating_text": <true if text appears OUTSIDE/ABOVE the object as typeset content: document pages, banners, captions, overlays, speech bubbles. Lettering carved INTO the object surface (tilework, engraved ornament) is physically part of the object — that is floating_text=false>,
"is_document": <true if the image is a text page / document / screenshot rather than a photo of a physical object>,
"single_object": <true if exactly one connected physical object is shown>,
"summary": "<one short English sentence>"}`;

function parseVerdict(raw: string): ImageQaVerdict | null {
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    return {
      floatingText: v.floating_text === true,
      isDocument: v.is_document === true,
      singleObject: v.single_object !== false,
      summary: typeof v.summary === "string" ? v.summary : "",
    };
  } catch {
    return null;
  }
}

async function judgeOnce(dataUrl: string): Promise<ImageQaVerdict | null> {
  const res = await getGlmClient().chat.completions.create({
    model: GLM_VISION_MODEL,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: QA_PROMPT },
        ],
      },
    ],
  });
  return parseVerdict(res.choices[0]?.message?.content ?? "");
}

export function qaHardFail(v: ImageQaVerdict): boolean {
  return v.floatingText || v.isDocument || !v.singleObject;
}

/**
 * Judge one rendered image. Retries the vision call once on failure (the
 * flash vision tier is routinely 429-saturated); if it is unreachable the
 * gate skips — an unjudged image beats no image.
 */
export async function qaCheckImage(
  bytes: Uint8Array,
  mime = "image/png",
): Promise<ImageQaResult> {
  const dataUrl = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const verdict = await judgeOnce(dataUrl);
      if (!verdict) return { status: "skipped", reason: "unparseable_verdict" };
      return {
        status: qaHardFail(verdict) ? "fail" : "pass",
        verdict,
      };
    } catch (err) {
      if (attempt === 1) {
        return {
          status: "skipped",
          reason: err instanceof Error ? err.message.slice(0, 120) : "vision_error",
        };
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  return { status: "skipped", reason: "unreachable" };
}
