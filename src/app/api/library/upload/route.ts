import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { images } from "@/db/schema";
import { getOrCreateSession } from "@/server/credits";
import { getStorage } from "@/server/storage";

/**
 * Library upload API (ticket 15, rules from issue 08):
 * - jpg/png/webp only, ≤ 8MB.
 * - Largest side > 4096px → Persian 400 (no image library in v1 — dimensions
 *   are parsed straight from the file header; ticket 15 rejects instead of
 *   downscaling).
 * - Stored as kind='uploaded', session-owned; shows up ONLY in the user's
 *   «مال من» tab, never in the public seed library.
 */

/** 7-category taxonomy — hand-synced twin of the list in /api/library. */
const CATEGORIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "confectionery", label: "قنادی و خوراکی" },
  { slug: "resin", label: "رزین و زیورآلات" },
  { slug: "candle", label: "شمع" },
  { slug: "soap", label: "صابون و بهداشتی" },
  { slug: "plaster", label: "گچ، بتن و پودر سنگ" },
  { slug: "figures", label: "فیگور و مینیاتور" },
  { slug: "keepsake", label: "یادگاری و سفارشی" },
];

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIDE_PX = 4096;

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

type ImageMime = keyof typeof EXT_BY_MIME;

function bad(error: string, message: string) {
  return NextResponse.json({ error, message }, { status: 400 });
}

/** Magic-byte sniffing — the declared Content-Type is never trusted. */
function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 //    P
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Header-only dimension parser (no sharp / image lib). Returns null when the
 * header cannot be parsed — the caller rejects unknown files.
 */
function imageDimensions(bytes: Uint8Array, mime: ImageMime) {
  try {
    if (mime === "image/png" && bytes.length >= 24) {
      // IHDR: width/height as uint32 BE at offsets 16/20.
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }

    if (mime === "image/jpeg") {
      // Walk SOF segments: [FF marker][len 2B][precision 1B][h 2B][w 2B].
      let off = 2;
      while (off + 9 < bytes.length) {
        if (bytes[off] !== 0xff) {
          off += 1;
          continue;
        }
        const marker = bytes[off + 1];
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
          off += 2; // standalone markers
          continue;
        }
        const segLen = (bytes[off + 2] << 8) | bytes[off + 3];
        if (segLen < 2) return null;
        const isSof =
          marker >= 0xc0 &&
          marker <= 0xcf &&
          marker !== 0xc4 && // DHT
          marker !== 0xc8 && // JPG
          marker !== 0xcc; //  DAC
        if (isSof) {
          const height = (bytes[off + 5] << 8) | bytes[off + 6];
          const width = (bytes[off + 7] << 8) | bytes[off + 8];
          return { width, height };
        }
        off += 2 + segLen;
      }
      return null;
    }

    if (mime === "image/webp" && bytes.length >= 20) {
      const fourcc = String.fromCharCode(
        bytes[12],
        bytes[13],
        bytes[14],
        bytes[15],
      );
      if (fourcc === "VP8 " && bytes.length >= 30) {
        // Lossy: sync 0x9D 0x01 0x2A then 14-bit LE dims.
        const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
        const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;
        return { width, height };
      }
      if (fourcc === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
        // Lossless: 14-bit (size-1) pairs packed into 4 bytes.
        const b0 = bytes[21];
        const b1 = bytes[22];
        const b2 = bytes[23];
        const b3 = bytes[24];
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height =
          1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height };
      }
      if (fourcc === "VP8X" && bytes.length >= 30) {
        // Extended: canvas size-1 as uint24 LE at 24/27.
        const width =
          1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const height =
          1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width, height };
      }
      return null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(req: Request) {
  const sessionId = await getOrCreateSession();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("invalid_form", "فایل آپلودی خوانده نشد؛ دوباره تلاش کن.");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return bad("invalid_form", "فایلی انتخاب نشده است.");
  }
  if (file.size > MAX_BYTES) {
    return bad("too_big", "حجم تصویر باید حداکثر ۸ مگابایت باشد.");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImageMime(bytes);
  if (!mime) {
    return bad("invalid_type", "فقط فرمت‌های JPG، PNG یا WebP پذیرفته می‌شود.");
  }

  const dims = imageDimensions(bytes, mime);
  if (!dims || dims.width <= 0 || dims.height <= 0) {
    return bad("invalid_file", "خواندن ابعاد تصویر ممکن نشد؛ فایل سالم را آپلود کن.");
  }
  if (Math.max(dims.width, dims.height) > MAX_SIDE_PX) {
    return bad(
      "too_large_px",
      "ابعاد تصویر بیش از حد مجاز است؛ حداکثر ۴۰۹۶ پیکسل در ضلع بزرگ‌تر.",
    );
  }

  const categoryRaw = form.get("category");
  const categoryStr = typeof categoryRaw === "string" ? categoryRaw.trim() : "";
  const category = CATEGORIES.some((c) => c.slug === categoryStr)
    ? categoryStr
    : null;

  const titleRaw = form.get("title");
  const fromField =
    typeof titleRaw === "string" ? titleRaw.trim().slice(0, 120) : "";
  const fromName = file.name
    ? file.name.replace(/\.[a-z0-9]+$/i, "").trim().slice(0, 120)
    : "";
  const title = fromField || fromName || "طرح آپلودی";

  const imageId = randomUUID();
  const key = `images/${sessionId}/${imageId}${EXT_BY_MIME[mime]}`;
  const storage = getStorage();
  await storage.put(key, bytes, mime);

  const meta = {
    title,
    category,
    description: "عکس آپلودی کاربر برای ساخت قالب.",
    uploaded: true,
    originalName: file.name ?? null,
    width: dims.width,
    height: dims.height,
  };

  await getDb().insert(images).values({
    id: imageId,
    sessionId,
    kind: "uploaded",
    storageKey: key,
    mime,
    isSeed: false,
    meta,
  });

  const known = CATEGORIES.find((c) => c.slug === category);
  return NextResponse.json({
    imageId,
    url: storage.publicUrl(key),
    item: {
      id: imageId,
      title,
      category,
      categoryLabel: known ? known.label : null,
      description: meta.description,
      seedPrompt: null,
      url: storage.publicUrl(key),
      kind: "uploaded",
      isSeed: false,
      createdAt: new Date().toISOString(),
    },
  });
}
