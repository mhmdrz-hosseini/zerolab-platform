import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { COSTS } from "@/config/credits";
import { MOLD_DEFAULTS } from "@/config/mold-params";
import { getDb } from "@/db";
import { images, moldJobs, threedTasks } from "@/db/schema";
import {
  InsufficientCreditsError,
  consume,
  getOrCreateSession,
  refund,
  type CreditMovement,
} from "@/server/credits";
import { EngineUnreachableError, engineGenerate } from "@/server/mold/engine";
import { glbBbox, modelScaleFor } from "@/server/mold/glb-bbox";
import { validateMoldParams } from "@/server/mold/params";
import { getStorage } from "@/server/storage";

interface MoldBody {
  taskId?: string;
  params?: Record<string, unknown>;
}

/**
 * POST /api/mold — start a mold build for a COMPLETED 3D task.
 * Body: { taskId, params? } where params keys come from the Persian catalog
 * (src/config/mold-params.ts); reserved model_scale is computed here from
 * viewerParams.sizeCm and model_rotation passes through validated.
 */
export async function POST(req: Request) {
  let body: MoldBody;
  try {
    body = (await req.json()) as MoldBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.taskId) {
    return NextResponse.json({ error: "taskId_required" }, { status: 400 });
  }

  const sessionId = await getOrCreateSession();
  const db = getDb();

  const [task] = await db
    .select()
    .from(threedTasks)
    .where(
      and(eq(threedTasks.id, body.taskId), eq(threedTasks.sessionId, sessionId)),
    )
    .limit(1);
  if (!task) {
    return NextResponse.json({ error: "task_not_found" }, { status: 404 });
  }
  if (task.status !== "success" || !task.glbKey) {
    return NextResponse.json({ error: "task_not_ready" }, { status: 409 });
  }
  // The mold engine needs one welded solid. Tasks from before the solid-twin
  // export only carry the UV-shattered textured GLB, which the engine always
  // dead-ends on — say so instead of burning a run (checked before consume).
  // The sample duck predates the column but is a clean solid, so it stays moldable.
  const moldGlbKey =
    task.solidGlbKey ?? (task.provider === "sample" ? task.glbKey : null);
  if (!moldGlbKey) {
    return NextResponse.json({ error: "model_too_old" }, { status: 409 });
  }

  // Size rides the input image's viewerParams (ticket 03: carried from lab).
  const [image] = await db
    .select({ meta: images.meta })
    .from(images)
    .where(eq(images.id, task.inputImageId))
    .limit(1);
  const sizeCm =
    image && typeof image.meta?.viewerParams === "object"
      ? Number((image.meta.viewerParams as Record<string, unknown>).sizeCm)
      : NaN;
  const safeSizeCm =
    Number.isFinite(sizeCm) && sizeCm >= 3 && sizeCm <= 20 ? sizeCm : 10;

  const stored = await getStorage().get(moldGlbKey);
  if (!stored) {
    return NextResponse.json({ error: "glb_missing" }, { status: 410 });
  }
  const bbox = glbBbox(stored.bytes);
  if (!bbox) {
    return NextResponse.json({ error: "glb_unreadable" }, { status: 422 });
  }
  const modelScale = modelScaleFor(safeSizeCm, bbox);

  const validated = validateMoldParams(body.params, modelScale);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error, key: validated.key ?? null },
      { status: 400 },
    );
  }

  // Ticket 06: mold is a first-class credit service — exhaustion maps to 402.
  let movement: CreditMovement;
  try {
    movement = await consume(sessionId, "mold");
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: "insufficient_credits", kind: err.kind },
        { status: 402 },
      );
    }
    throw err;
  }

  // Full-default snapshot: the engine fills missing keys itself, but the row
  // must record effective params (pricing reads contoured/vents/densities).
  const defaults = Object.fromEntries(
    Object.entries(MOLD_DEFAULTS).filter(([k]) => k !== "model_rotation"),
  ) as Record<string, unknown>;
  const engineParams: Record<string, unknown> = {
    ...defaults,
    ...validated.value.props,
    model_scale: validated.value.modelScale,
  };
  if (validated.value.modelRotation) {
    engineParams.model_rotation = validated.value.modelRotation;
  }

  try {
    const engineJobId = await engineGenerate(stored.bytes, engineParams);
    const [row] = await db
      .insert(moldJobs)
      .values({
        sessionId,
        threedTaskId: task.id,
        status: "queued",
        engineJobId,
        params: engineParams,
        movement: movement as unknown as Record<string, unknown>,
        creditsSpent: COSTS.mold,
      })
      .returning({ id: moldJobs.id });
    return NextResponse.json({ jobId: row.id, status: "queued" });
  } catch (err) {
    await refund(sessionId, movement);
    if (err instanceof EngineUnreachableError) {
      console.error("[api/mold] engine unreachable", err.message);
      return NextResponse.json(
        { error: "mold_engine_unreachable" },
        { status: 503 },
      );
    }
    console.error("[api/mold] submit failed", err);
    return NextResponse.json({ error: "mold_submit_failed" }, { status: 502 });
  }
}
