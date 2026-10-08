import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { images, moldJobs, moldOrders, threedTasks } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";
import { priceMoldResult } from "@/server/mold/pricing";
import type { EngineResult } from "@/server/mold/engine";
import { getStorage } from "@/server/storage";

/**
 * POST /api/mold/[id]/order — «ثبت سفارش قالب» (mold-studio ticket 15).
 * Session-scoped, idempotent per job: re-posting returns the existing order.
 * Price comes from the server-side pricing of the stored engine result —
 * never from the client. No payment in v1.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = await getOrCreateSession();
  const db = getDb();

  const [job] = await db
    .select()
    .from(moldJobs)
    .where(and(eq(moldJobs.id, id), eq(moldJobs.sessionId, sessionId)))
    .limit(1);
  if (!job) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (job.status !== "success") {
    return NextResponse.json(
      { error: "job_not_ready" },
      { status: 409 },
    );
  }

  // Idempotent placement.
  const [existing] = await db
    .select()
    .from(moldOrders)
    .where(eq(moldOrders.moldJobId, job.id))
    .limit(1);
  if (existing) {
    return NextResponse.json({ orderId: existing.id, placed: true });
  }

  const result = (job.result ?? null) as EngineResult | null;
  const pricing = result
    ? priceMoldResult(result, job.params as Record<string, unknown>)
    : null;
  if (!pricing) {
    return NextResponse.json(
      { error: "price_unavailable" },
      { status: 409 },
    );
  }

  // Size snapshot rides the input image's viewerParams (same source the job
  // took its scale from — POST /api/mold).
  const [task] = await db
    .select({ inputImageId: threedTasks.inputImageId })
    .from(threedTasks)
    .where(eq(threedTasks.id, job.threedTaskId))
    .limit(1);
  let sizeCm: number | null = null;
  if (task) {
    const [image] = await db
      .select({ meta: images.meta })
      .from(images)
      .where(eq(images.id, task.inputImageId))
      .limit(1);
    const vp = image?.meta?.viewerParams as
      | { sizeCm?: unknown }
      | undefined;
    if (vp && typeof vp.sizeCm === "number") sizeCm = Math.round(vp.sizeCm);
  }

  const params = job.params as Record<string, unknown>;

  const [order] = await db
    .insert(moldOrders)
    .values({
      sessionId,
      moldJobId: job.id,
      status: "placed",
      priceTomans: pricing.totalTomans,
      sizeCm,
      params,
    })
    .returning({ id: moldOrders.id });

  // Fix the printable bundle under the order's own key (ticket 15 contract);
  // per-part STLs stay under mold/<jobId>/ (immutable per job).
  try {
    const artifacts = job.artifacts as { zipKey?: string } | null;
    if (artifacts?.zipKey) {
      const stored = await getStorage().get(artifacts.zipKey);
      if (stored) {
        await getStorage().put(
          `mold/orders/${order.id}/bundle.zip`,
          stored.bytes,
          "application/zip",
        );
      }
    }
  } catch (err) {
    console.error("[api/mold/order] bundle fixation failed", err);
  }

  return NextResponse.json({
    orderId: order.id,
    placed: true,
    priceTomans: pricing.totalTomans,
  });
}
