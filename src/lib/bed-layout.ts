/**
 * Print-bed shelf packing (mold-studio ticket 15, ported per research 08 from
 * the forge viewer.js:19-21, 202-247) — greedy shelf rows on the reference
 * 220×220 bed with 8mm gaps and 15mm margins. Pure math, no three imports.
 */

export const REF_BED = 220;
export const LAYOUT_GAP = 8;
export const PLATE_MARGIN = 15;

export interface BedPart {
  name: string;
  /** Bounding box [X, Y, Z] in mm in the part's baked print orientation. */
  dims: [number, number, number];
}

export interface BedPlaced {
  name: string;
  /** Top-left mm position on the bed (X, Y), bottom at Z=0. */
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface BedLayout {
  placed: BedPlaced[];
  /** Parts that could not fit the reference bed at all. */
  overflow: string[];
}

/** Greedy shelf packing, longest-side-first inside each row. */
export function layoutPrintBed(parts: BedPart[]): BedLayout {
  const placed: BedPlaced[] = [];
  const overflow: string[] = [];
  const inner = REF_BED - 2 * PLATE_MARGIN;

  // Footprint per part on the bed (X × Y in print orientation).
  const items = parts
    .map((p) => ({ ...p, w: p.dims[0], d: p.dims[1] }))
    .sort((a, b) => Math.max(b.w, b.d) - Math.max(a.w, a.d));

  let cursorX = PLATE_MARGIN;
  let cursorY = PLATE_MARGIN;
  let rowH = 0;

  for (const it of items) {
    const w = it.w;
    const d = it.d;
    if (w > inner || d > inner) {
      overflow.push(it.name);
      continue;
    }
    if (cursorX + w > REF_BED - PLATE_MARGIN) {
      // next shelf row
      cursorX = PLATE_MARGIN;
      cursorY += rowH + LAYOUT_GAP;
      rowH = 0;
    }
    if (cursorY + d > REF_BED - PLATE_MARGIN) {
      overflow.push(it.name);
      continue;
    }
    placed.push({ name: it.name, x: cursorX, y: cursorY, w, d });
    cursorX += w + LAYOUT_GAP;
    rowH = Math.max(rowH, d);
  }

  return { placed, overflow };
}
