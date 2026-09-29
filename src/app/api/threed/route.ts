import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { COSTS } from "@/config/credits";
import { getDb } from "@/db";
import { images, threedTasks } from "@/db/schema";
import {
  InsufficientCreditsError,
  consume,
  getOrCreateSession,
  refund,
} from "@/server/credits";
import { getStorage } from "@/server/storage";
import { createImageToModelTask, hasTripoKey } from "@/server/tripo/client";
import { startPolling } from "@/server/tripo/poller";

const SAMPLE_GLB_KEY = "samples/duck.glb";

// Placeholder model: KhronosGroup/glTF-Sample-Models "Duck",
// CC-BY 4.0 by Sony — used until a real TRIPO_API_KEY is configured.
async function ensureSampleGlb(): Promise<string> {
  const storage = getStorage();
  const existing = await storage.get(SAMPLE_GLB_KEY);
  if (existing) return SAMPLE_GLB_KEY;
  const bytes = await readFile(
    path.join(process.cwd(), "public", "samples", "duck.glb"),
  );
  await storage.put(SAMPLE_GLB_KEY, new Uint8Array(bytes), "model/gltf-binary");
  return SAMPLE_GLB_KEY;
}

interface ThreedBody {
  imageId?: string;
}

export async function POST(req: Request) {
  let body: ThreedBody;
  try {
    body = (await req.json()) as ThreedBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.imageId) {
    return NextResponse.json({ error: "imageId_required" }, { status: 400 });
  }

  const sessionId = await getOrCreateSession();
  const db = getDb();

  const [image] = await db
    .select()
    .from(images)
    .where(and(eq(images.id, body.imageId), eq(images.sessionId, sessionId)))
    .limit(1);
  if (!image) {
    return NextResponse.json({ error: "image_not_found" }, { status: 404 });
  }

  // Ticket 14 contract: exhaustion maps to 402 so the client can show the
  // Persian lock banner with «افزودن اعتبار».
  let movement;
  try {
    movement = await consume(sessionId, "threed", image.id);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: "insufficient_credits", kind: err.kind },
        { status: 402 },
      );
    }
    throw err;
  }

  try {
    if (!hasTripoKey()) {
      // Sample mode — hand back the placeholder GLB immediately.
      const glbKey = await ensureSampleGlb();
      const [row] = await db
        .insert(threedTasks)
        .values({
          sessionId,
          inputImageId: image.id,
          provider: "sample",
          status: "success",
          glbKey,
          creditsSpent: COSTS.threed,
        })
        .returning({ id: threedTasks.id });
      return NextResponse.json({
        taskId: row.id,
        status: "success",
        glbUrl: getStorage().publicUrl(glbKey),
        sample: true,
      });
    }

    // Real Tripo task — the image URL must be reachable from Tripo's servers
    // (public deploy or a tunnel in dev).
    const origin = new URL(req.url).origin;
    const imageUrl = `${origin}${getStorage().publicUrl(image.storageKey)}`;
    const providerTaskId = await createImageToModelTask(imageUrl);
    const [row] = await db
      .insert(threedTasks)
      .values({
        sessionId,
        inputImageId: image.id,
        provider: "tripo",
        providerTaskId,
        status: "queued",
        creditsSpent: COSTS.threed,
      })
      .returning({ id: threedTasks.id });

    startPolling(row.id);
    return NextResponse.json({ taskId: row.id, status: "queued" });
  } catch (err) {
    await refund(sessionId, movement, image.id);
    console.error("[api/threed] task creation failed", err);
    return NextResponse.json({ error: "threed_failed" }, { status: 502 });
  }
}
