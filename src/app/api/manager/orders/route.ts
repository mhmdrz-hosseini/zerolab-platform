import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { images, moldJobs, moldOrders, threedTasks } from "@/db/schema";
import { requireManager } from "@/server/manager/auth";
import { getStorage } from "@/server/storage";

/**
 * GET /api/manager/orders — the manager orders list (ticket 15).
 * Joins job → threed task → input image for the thumbnail, and surfaces the
 * print-report essentials the bed view needs.
 */
export async function GET() {
  const denied = await requireManager();
  if (denied) return denied;

  const db = getDb();
  const rows = await db
    .select({
      id: moldOrders.id,
      status: moldOrders.status,
      priceTomans: moldOrders.priceTomans,
      sizeCm: moldOrders.sizeCm,
      createdAt: moldOrders.createdAt,
      jobStatus: moldJobs.status,
      jobResult: moldJobs.result,
      jobArtifacts: moldJobs.artifacts,
      jobErrorCode: moldJobs.errorCode,
      inputImageId: threedTasks.inputImageId,
    })
    .from(moldOrders)
    .innerJoin(moldJobs, eq(moldOrders.moldJobId, moldJobs.id))
    .innerJoin(threedTasks, eq(moldJobs.threedTaskId, threedTasks.id))
    .orderBy(desc(moldOrders.createdAt))
    .limit(200);

  const storage = getStorage();
  const imageIds = [...new Set(rows.map((r) => r.inputImageId))];
  const thumbs = new Map<string, string>();
  for (const imageId of imageIds) {
    const [img] = await db
      .select({ key: images.storageKey })
      .from(images)
      .where(eq(images.id, imageId))
      .limit(1);
    if (img) thumbs.set(imageId, storage.publicUrl(img.key));
  }

  return NextResponse.json({
    orders: rows.map((r) => {
      const result = (r.jobResult ?? null) as
        | {
            volumes?: Record<string, number>;
            print?: {
              parts?: Array<{
                name: string;
                dims?: number[];
                fits_ref_bed?: boolean;
              }>;
            };
            summary?: Record<string, unknown>;
          }
        | null;
      const artifacts = r.jobArtifacts as
        | {
            files?: Array<{ name: string; role: string; bytes: number; key: string }>;
            zipKey?: string;
          }
        | null;
      return {
        id: r.id,
        status: r.status,
        jobStatus: r.jobStatus,
        jobErrorCode: r.jobErrorCode,
        priceTomans: r.priceTomans,
        sizeCm: r.sizeCm,
        createdAt: r.createdAt,
        thumbnailUrl: thumbs.get(r.inputImageId) ?? null,
        parts: (result?.print?.parts ?? []).map((p) => ({
          name: p.name,
          dims: p.dims ?? null,
          fitsRefBed: p.fits_ref_bed ?? null,
        })),
        volumes: result?.volumes ?? null,
        artifacts: artifacts
          ? {
              files: (artifacts.files ?? []).map((f) => ({
                name: f.name,
                role: f.role,
                bytes: f.bytes,
                url: storage.publicUrl(f.key),
              })),
              zipUrl: artifacts.zipKey
                ? storage.publicUrl(artifacts.zipKey)
                : null,
            }
          : null,
      };
    }),
  });
}
