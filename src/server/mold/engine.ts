import "server-only";

/**
 * HTTP client for the mold engine sidecar (vendored MOLD-FORAGE under
 * mold-engine/, started with `node scripts/mold-engine.mjs`).
 *
 * Contract per ticket 07: single-worker in-memory queue, no auth/CORS —
 * server-to-server only, never exposed to the browser.
 */

const BASE = () =>
  process.env.MOLD_ENGINE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

export type EngineJobStatus = "queued" | "running" | "done" | "error";

export interface EngineJob {
  id: string;
  status: EngineJobStatus;
  progress: number; // 0..1
  phase: string | null;
  error: string | null;
  error_code: string | null;
  peak_rss_mb: number | null;
  result: EngineResult | null;
}

export interface EngineResult {
  ok: boolean;
  summary?: Record<string, unknown>;
  volumes?: {
    cavity_volume?: number;
    silicone_volume?: number;
    plastic_volume?: number;
  };
  notes?: Record<string, unknown>;
  warnings?: unknown[];
  parts?: Array<{
    name: string;
    file: string;
    bytes: number;
    role: string;
    faces?: number;
  }>;
  print?: Record<string, unknown>;
  skin?: string | null;
  [k: string]: unknown;
}

export class EngineUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`mold engine unreachable: ${String(cause)}`);
    this.name = "EngineUnreachableError";
  }
}

async function fetchOrThrow(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  try {
    const res = await fetch(`${BASE()}${path}`, init);
    if (!res.ok && res.status !== 404) {
      throw new Error(`engine HTTP ${res.status} on ${path}`);
    }
    return res;
  } catch (err) {
    if (err instanceof EngineUnreachableError) throw err;
    throw new EngineUnreachableError(err);
  }
}

export async function engineHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE()}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Submit a mesh + params JSON; returns the engine job id (12 hex). */
export async function engineGenerate(
  glbBytes: Uint8Array,
  params: Record<string, unknown>,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([glbBytes as unknown as BlobPart], { type: "model/gltf-binary" }),
    "model.glb",
  );
  form.append("params", JSON.stringify(params));
  const res = await fetchOrThrow("/api/generate", { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`engine rejected generate (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { job_id: string };
  return data.job_id;
}

/** Poll a job; 404 maps to null (sidecar restarted — job vanished). */
export async function engineJob(jobId: string): Promise<EngineJob | null> {
  const res = await fetchOrThrow(`/api/job/${jobId}`);
  if (res.status === 404) return null;
  return (await res.json()) as EngineJob;
}

/** Download one output STL (part / skin / master). */
export async function enginePart(
  jobId: string,
  filename: string,
): Promise<Uint8Array> {
  const res = await fetchOrThrow(`/api/job/${jobId}/parts/${filename}`);
  if (!res.ok) throw new Error(`part fetch failed: ${filename} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Download the full artifact zip (includes parts, skin and master). */
export async function engineZip(jobId: string): Promise<Uint8Array> {
  const res = await fetchOrThrow(`/api/job/${jobId}/zip`);
  if (!res.ok) throw new Error(`zip fetch failed (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
