import "server-only";
import { getStorage } from "@/server/storage";

/**
 * Resolves chat image references into base64 data URLs for GLM vision input.
 *
 * Library/upload images live behind `/api/files/<key>` (local driver) —
 * relative URLs Z.ai can never fetch — so local keys are read straight from
 * the storage driver. Absolute URLs (proxied seeds) are fetched server-side
 * with a byte cap; weserv URLs get an on-the-fly downscale hint because
 * vision tokens scale with resolution.
 */

const MAX_BYTES = 6 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
/** Token economy: long-edge cap for weserv-proxied images. */
const WESERV_WIDTH = 1024;
/** Upper bound on images resolved per chat request. */
export const MAX_IMAGES_PER_REQUEST = 4;

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function weservCapped(url: string): string {
  if (!url.includes("images.weserv.nl")) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has("w")) u.searchParams.set("w", String(WESERV_WIDTH));
    return u.toString();
  } catch {
    return url;
  }
}

/** `/api/files/<key…>` → storage key, or null for anything else. */
export function storageKeyOf(url: string): string | null {
  if (!url.startsWith("/api/files/")) return null;
  return decodeURIComponent(url.slice("/api/files/".length));
}

/**
 * One image URL → data URL, or null when unresolvable (missing key, fetch
 * failure, oversized). Callers drop nulls so a dead reference never kills
 * the chat turn.
 */
export async function resolveImageDataUrl(url: string): Promise<string | null> {
  try {
    const key = storageKeyOf(url);
    if (key) {
      const file = await getStorage().get(key);
      if (!file || file.bytes.byteLength > MAX_BYTES) return null;
      return toDataUrl(file.bytes, file.mime);
    }
    if (/^https?:\/\//i.test(url)) {
      const res = await fetch(weservCapped(url), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "";
      if (!mime.startsWith("image/")) return null;
      return toDataUrl(bytes, mime);
    }
    return null;
  } catch {
    return null;
  }
}
