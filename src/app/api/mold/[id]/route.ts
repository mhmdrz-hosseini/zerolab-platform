import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { moldPhaseFa } from "@/config/mold-params";
import { getDb } from "@/db";
import { moldJobs, type MoldJob } from "@/db/schema";
import {
  refund,
  getOrCreateSession,
  type CreditMovement,
} from "@/server/credits";
import {
  EngineResult,
  engineJob,
  enginePart,
  engineZip,
} from "@/server/mold/engine";
import { getStorage } from "@/server/storage";
import { priceMoldResult } from "@/server/mold/pricing";

interface ArtifactFile {
  name: string;
  role: string;
  bytes: number;
  key: string;
}

/** Transient engine state while the job is still in flight. */
interface LiveProgress {
  progress: number | null; // 0..100
  phase: string | null;
}

/**
 * GET /api/mold/[id] — poll proxy for the engine job. On the first sight of a
 * terminal engine state the row is claimed (conditional update) and the STL
 * artifacts are ingested into our storage; afterwards the row serves alone.
 * Engine failures refund the credit movement recorded at creation.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const sessionId = await getOrCreateSession();
  const db = getDb();

  const [row] = await db
    .select()
    .from(moldJobs)
    .where(and(eq(moldJobs.id, id), eq(moldJobs.sessionId, sessionId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  let live: LiveProgress | null = null;
  if (row.status === "queued" || row.status === "running") {
    live = await syncFromEngine(row, sessionId);
    const [fresh] = await db
      .select()
      .from(moldJobs)
      .where(eq(moldJobs.id, row.id))
      .limit(1);
    return NextResponse.json(shape(fresh ?? row, live));
  }

  return NextResponse.json(shape(row, null));
}

/* ------------------------------------------------------------------ */

async function syncFromEngine(
  row: MoldJob,
  sessionId: string,
): Promise<LiveProgress | null> {
  const db = getDb();
  if (!row.engineJobId) return null;

  let job;
  try {
    job = await engineJob(row.engineJobId);
  } catch {
    return null; // transient engine hiccup — keep polling
  }
  if (!job) {
    // Sidecar restarted — its in-memory job store is gone.
    await failJob(row, sessionId, "ERROR_ENGINE_VANISHED");
    return null;
  }
  if (job.status === "queued" || job.status === "running") {
    if (row.status === "queued" && job.status === "running") {
      await db
        .update(moldJobs)
        .set({ status: "running" })
        .where(eq(moldJobs.id, row.id));
    }
    return {
      progress:
        typeof job.progress === "number"
          ? Math.max(0, Math.min(100, Math.round(job.progress * 100)))
          : null,
      phase: job.phase ?? null,
    };
  }
  if (job.status === "error") {
    await failJob(row, sessionId, job.error_code ?? "ERROR_INTERNAL");
    return null;
  }

  // done — claim the row exactly once (concurrent pollers race here).
  const claimed = await db
    .update(moldJobs)
    .set({ status: "success", result: job.result as Record<string, unknown> })
    .where(
      and(
        eq(moldJobs.id, row.id),
        inArray(moldJobs.status, ["queued", "running"]),
      ),
    )
    .returning({ id: moldJobs.id });
  if (claimed.length === 0) return null;

  // Ingest artifacts (best effort — on failure files stay on the engine disk).
  try {
    const artifacts = await ingestArtifacts(
      row.id,
      row.engineJobId!,
      job.result!,
    );
    await db
      .update(moldJobs)
      .set({ artifacts: artifacts as unknown as Record<string, unknown> })
      .where(eq(moldJobs.id, row.id));
  } catch (err) {
    console.error("[api/mold] artifact ingest failed", err);
  }
  return null;
}

async function failJob(
  row: MoldJob,
  sessionId: string,
  errorCode: string,
): Promise<void> {
  const db = getDb();
  const claimed = await db
    .update(moldJobs)
    .set({ status: "failed", errorCode })
    .where(
      and(
        eq(moldJobs.id, row.id),
        inArray(moldJobs.status, ["queued", "running"]),
      ),
    )
    .returning({ id: moldJobs.id });
  if (claimed.length === 0) return;

  if (row.movement && !row.refunded) {
    const movement = row.movement as unknown as CreditMovement;
    try {
      await refund(sessionId, movement, row.id);
      await db
        .update(moldJobs)
        .set({ refunded: true })
        .where(eq(moldJobs.id, row.id));
    } catch (err) {
      console.error("[api/mold] refund failed", err);
    }
  }
}

async function ingestArtifacts(
  jobId: string,
  engineJobId: string,
  result: EngineResult,
): Promise<{ files: ArtifactFile[]; zipKey: string }> {
  const storage = getStorage();
  const wanted = new Map<string, string>(); // filename -> role
  for (const part of result.parts ?? []) {
    if (part?.file) wanted.set(part.file, part.role ?? "part");
  }
  if (result.skin) wanted.set(result.skin, "skin");

  const files: ArtifactFile[] = [];
  for (const [filename, role] of wanted) {
    const bytes = await enginePart(engineJobId, filename);
    const key = `mold/${jobId}/${filename}`;
    await storage.put(key, bytes, "model/stl");
    files.push({ name: filename, role, bytes: bytes.byteLength, key });
  }

  const zipKey = `mold/${jobId}/artifacts.zip`;
  await storage.put(zipKey, await engineZip(engineJobId), "application/zip");
  return { files, zipKey };
}

function shape(row: MoldJob, live: LiveProgress | null) {
  const result = (row.result ?? null) as EngineResult | null;
  const artifacts = row.artifacts as
    | { files: ArtifactFile[]; zipKey: string }
    | null;
  const storage = getStorage();
  return {
    id: row.id,
    status: row.status,
    progress: live?.progress ?? null,
    phase: live?.phase ?? null,
    faPhase: moldPhaseFa(live?.phase ?? null),
    errorCode: row.errorCode,
    refunded: row.refunded,
    result: result
      ? {
          summary: result.summary ?? null,
          volumes: result.volumes ?? null, // mm³ — ml = /1000 (ticket 07)
          warnings: result.warnings ?? [],
          parts: result.parts ?? [],
          print: result.print ?? null,
        }
      : null,
    // Ticket 14: grams×rate × complexity — computed server-side so the order
    // record (ticket 15) and the studio card can never disagree.
    pricing:
      result && row.params
        ? priceMoldResult(result, row.params as Record<string, unknown>)
        : null,
    artifacts: artifacts
      ? {
          files: artifacts.files.map((f) => ({
            name: f.name,
            role: f.role,
            bytes: f.bytes,
            url: storage.publicUrl(f.key),
          })),
          zipUrl: storage.publicUrl(artifacts.zipKey),
        }
      : null,
  };
}
