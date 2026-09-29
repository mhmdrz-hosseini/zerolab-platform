import * as THREE from "three";

/**
 * Image-plane geometry + pixel-grid sampling for the point-cloud morph
 * (ticket 14, pattern 1 of issue 04): particles start as a grid "painted"
 * with the image's pixels, then converge onto the GLB surface.
 */

/** Shared plane metrics so the HTML/3D image plane and the particle grid agree. */
export const PLANE_MAX_W = 1.5;
export const PLANE_MAX_H = 1.15;
/** Plane sits slightly behind the model so particles fly "out of the picture". */
export const PLANE_Z = -0.85;
/** Bottom edge lift above the grid. */
export const PLANE_LIFT = 0.03;

export function planeRect(aspect: number): { width: number; height: number } {
  const safe = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  let width = PLANE_MAX_W;
  let height = width / safe;
  if (height > PLANE_MAX_H) {
    height = PLANE_MAX_H;
    width = height * safe;
  }
  return { width, height };
}

export interface PixelGrid {
  /** Start positions (x, y, z) — plane rect in stage space, top-to-bottom rows. */
  positions: Float32Array;
  /** Per-point linear RGB (0..1), sampled from the image pixels. */
  colors: Float32Array;
  aspect: number;
  count: number;
}

function gridSizeFor(count: number, aspect: number): { cols: number; rows: number } {
  const cols = Math.max(2, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(2, Math.round(count / cols));
  return { cols, rows };
}

/**
 * Downscale the image to a cols×rows canvas and read one pixel per grid cell.
 * Returns null when the image cannot be loaded (CORS/404) — callers fall back
 * to an untextured grid.
 */
export async function loadImagePixels(
  url: string,
  count: number,
): Promise<PixelGrid | null> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";

  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
  });
  img.src = url;
  try {
    await loaded;
  } catch {
    return null;
  }

  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  const { cols, rows } = gridSizeFor(count, aspect);

  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cols, rows);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, cols, rows).data;
  } catch {
    // Tainted canvas (should not happen — same-origin storage URLs).
    return null;
  }

  const rect = planeRect(aspect);
  const count2 = cols * rows;
  const positions = new Float32Array(count2 * 3);
  const colors = new Float32Array(count2 * 3);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      // Bottom-up rows so the picture reads upright in world space.
      const x = -rect.width / 2 + ((c + 0.5) / cols) * rect.width;
      const y = PLANE_LIFT + (1 - (r + 0.5) / rows) * rect.height;
      const z = PLANE_Z + (Math.random() - 0.5) * 0.04;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      // sRGB → linear-ish: cheap gamma so colors don't wash out.
      const s = 1 / 255;
      colors[i * 3] = Math.pow(data[i * 4] * s, 2.2);
      colors[i * 3 + 1] = Math.pow(data[i * 4 + 1] * s, 2.2);
      colors[i * 3 + 2] = Math.pow(data[i * 4 + 2] * s, 2.2);
    }
  }

  return { positions, colors, aspect, count: count2 };
}

/** Fallback grid with paper-toned particles when pixels are unavailable. */
export function fallbackPixelGrid(count: number): PixelGrid {
  const aspect = 1;
  const { cols, rows } = gridSizeFor(count, aspect);
  const rect = planeRect(aspect);
  const count2 = cols * rows;
  const positions = new Float32Array(count2 * 3);
  const colors = new Float32Array(count2 * 3);
  const base = new THREE.Color("#cdbbb8");
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      positions[i * 3] = -rect.width / 2 + ((c + 0.5) / cols) * rect.width;
      positions[i * 3 + 1] = PLANE_LIFT + (1 - (r + 0.5) / rows) * rect.height;
      positions[i * 3 + 2] = PLANE_Z + (Math.random() - 0.5) * 0.04;
      const shade = 0.85 + 0.15 * ((c + r) % 2);
      colors[i * 3] = base.r * shade;
      colors[i * 3 + 1] = base.g * shade;
      colors[i * 3 + 2] = base.b * shade;
    }
  }
  return { positions, colors, aspect, count: count2 };
}
