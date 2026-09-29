import "server-only";

const BASE = "https://openapi.tripo3d.ai/v3";

/** H3.1 default model per issue 02. */
export const TRIPO_IMAGE_TO_MODEL = "v3.1-20260211";

export interface TripoTask {
  task_id: string;
  status:
    | "queued"
    | "running"
    | "success"
    | "failed"
    | "cancelled"
    | "banned"
    | "expired";
  progress?: number;
  output?: {
    model_url?: string;
    rendered_image_url?: string;
  };
}

interface TripoEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

export function hasTripoKey(): boolean {
  return Boolean(process.env.TRIPO_API_KEY);
}

async function tripoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.TRIPO_API_KEY;
  if (!apiKey) throw new Error("TRIPO_API_KEY is not set");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as TripoEnvelope<T>;
  if (json.code !== 0) {
    throw new Error(`Tripo error ${json.code}: ${json.message ?? "unknown"}`);
  }
  return json.data as T;
}

/** Create an image-to-model task; returns the provider task id. */
export async function createImageToModelTask(imageUrl: string): Promise<string> {
  const data = await tripoFetch<{ task_id: string }>(
    "/generation/image-to-model",
    {
      method: "POST",
      body: JSON.stringify({
        input: { url: imageUrl },
        model: TRIPO_IMAGE_TO_MODEL,
        enable_image_autofix: true,
        texture: false, // geometry is enough for mold drafting (issue 02)
        pbr: true,
        geometry_quality: "detailed",
      }),
    },
  );
  return data.task_id;
}

export async function getTripoTask(taskId: string): Promise<TripoTask> {
  return tripoFetch<TripoTask>(`/tasks/${taskId}`);
}
