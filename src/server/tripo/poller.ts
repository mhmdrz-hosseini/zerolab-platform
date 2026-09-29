import { eq } from "drizzle-orm";
import "server-only";
import { getDb } from "@/db";
import { threedTasks, type ThreedTask } from "@/db/schema";
import { getStorage } from "@/server/storage";
import { getTripoTask, type TripoTask } from "./client";

const POLL_INTERVAL_MS = 2000;
/** ~6 minutes, per Tripo docs recommendation (issue 02). */
const MAX_POLLS = 180;

const inFlight = new Set<string>();

/**
 * Fire-and-forget background poller: updates the threed_tasks row and
 * downloads the GLB into our storage on success.
 */
export function startPolling(taskRowId: string): void {
  if (inFlight.has(taskRowId)) return;
  inFlight.add(taskRowId);
  void poll(taskRowId).finally(() => inFlight.delete(taskRowId));
}

async function poll(taskRowId: string): Promise<void> {
  const db = getDb();
  try {
    const [row] = await db
      .select()
      .from(threedTasks)
      .where(eq(threedTasks.id, taskRowId))
      .limit(1);
    if (!row || !row.providerTaskId) return;

    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS);
      const task = await getTripoTask(row.providerTaskId);
      if (task.status === "success") {
        await finishSuccess(row, task);
        return;
      }
      if (task.status !== "queued" && task.status !== "running") {
        await markFailed(taskRowId);
        return;
      }
    }
    await markFailed(taskRowId);
  } catch (err) {
    console.error("[tripo/poller] task failed", err);
    await markFailed(taskRowId).catch(() => {});
  }
}

async function finishSuccess(
  row: ThreedTask,
  task: TripoTask,
): Promise<void> {
  const glbUrl = task.output?.model_url;
  if (!glbUrl) throw new Error("Tripo task succeeded without model_url");
  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB download failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const key = `threed/${row.sessionId}/${row.id}.glb`;
  await getStorage().put(key, bytes, "model/gltf-binary");
  await getDb()
    .update(threedTasks)
    .set({ status: "success", glbKey: key })
    .where(eq(threedTasks.id, row.id));
}

async function markFailed(taskRowId: string): Promise<void> {
  await getDb()
    .update(threedTasks)
    .set({ status: "failed" })
    .where(eq(threedTasks.id, taskRowId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
