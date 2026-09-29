import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { images, threedTasks } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";
import { getStorage } from "@/server/storage";
import { getTripoTask } from "@/server/tripo/client";

/** Viewer params persisted per task (ticket 14) — see images.meta below. */
export interface ViewerParamsMeta {
  sizeCm: number;
  color: string;
}

function extractViewerParams(meta: unknown): ViewerParamsMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>).viewerParams;
  if (!raw || typeof raw !== "object") return null;
  const { sizeCm, color } = raw as Record<string, unknown>;
  if (typeof sizeCm !== "number" || typeof color !== "string") return null;
  return { sizeCm, color };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = await getOrCreateSession();
  const db = getDb();

  const [row] = await db
    .select()
    .from(threedTasks)
    .where(and(eq(threedTasks.id, id), eq(threedTasks.sessionId, sessionId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Ticket 14: expose live Tripo progress while queued/running (best effort —
  // a failed provider call just leaves progress null and the client keeps its
  // damped display).
  let progress: number | null = null;
  if (
    row.provider === "tripo" &&
    row.providerTaskId &&
    (row.status === "queued" || row.status === "running")
  ) {
    try {
      const task = await getTripoTask(row.providerTaskId);
      if (typeof task.progress === "number") {
        progress = Math.max(0, Math.min(100, Math.round(task.progress)));
      }
    } catch {
      // Poller keeps its own state; progress display just stalls.
    }
  }

  // Viewer params ride the input image's jsonb meta (session-scoped); the
  // threed_tasks table has no meta column in lab-v1.
  const [image] = await db
    .select({ meta: images.meta })
    .from(images)
    .where(eq(images.id, row.inputImageId))
    .limit(1);

  return NextResponse.json({
    id: row.id,
    status: row.status,
    provider: row.provider,
    progress,
    glbUrl: row.glbKey ? getStorage().publicUrl(row.glbKey) : null,
    sample: row.provider === "sample",
    viewerParams: image ? extractViewerParams(image.meta) : null,
  });
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface PatchBody {
  sizeCm?: unknown;
  color?: unknown;
}

/**
 * PATCH /api/threed/[id] — persist {sizeCm, color} viewer params into the
 * task's meta (stored on the input image row, session-scoped). Merges over
 * the previous viewerParams so partial updates are safe.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch: Partial<ViewerParamsMeta> = {};
  if (body.sizeCm !== undefined) {
    if (typeof body.sizeCm !== "number" || !Number.isFinite(body.sizeCm)) {
      return NextResponse.json({ error: "invalid_sizeCm" }, { status: 400 });
    }
    patch.sizeCm = Math.max(5, Math.min(20, Math.round(body.sizeCm)));
  }
  if (body.color !== undefined) {
    if (typeof body.color !== "string" || !HEX_COLOR.test(body.color)) {
      return NextResponse.json({ error: "invalid_color" }, { status: 400 });
    }
    patch.color = body.color.toLowerCase();
  }
  if (patch.sizeCm === undefined && patch.color === undefined) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const sessionId = await getOrCreateSession();
  const db = getDb();

  const [row] = await db
    .select({ inputImageId: threedTasks.inputImageId })
    .from(threedTasks)
    .where(and(eq(threedTasks.id, id), eq(threedTasks.sessionId, sessionId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [image] = await db
    .select({ meta: images.meta })
    .from(images)
    .where(eq(images.id, row.inputImageId))
    .limit(1);
  if (!image) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const prevMeta =
    image.meta && typeof image.meta === "object"
      ? (image.meta as Record<string, unknown>)
      : {};
  const prevParams = extractViewerParams(prevMeta) ?? { sizeCm: 10, color: "#f5f0eb" };
  const viewerParams: ViewerParamsMeta = { ...prevParams, ...patch };

  await db
    .update(images)
    .set({ meta: { ...prevMeta, viewerParams } })
    .where(eq(images.id, row.inputImageId));

  return NextResponse.json({ ok: true, viewerParams });
}
