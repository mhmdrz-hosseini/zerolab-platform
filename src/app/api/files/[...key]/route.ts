import { NextResponse } from "next/server";
import { getStorage } from "@/server/storage";

/**
 * Serves storage-driver keys (local driver default): /api/files/<key...>
 * This is the target of StorageDriver.publicUrl().
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const { key } = await ctx.params;
  const file = await getStorage().get(
    key.map(decodeURIComponent).join("/"),
  );
  if (!file) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Copy into a plain ArrayBuffer-backed view so it satisfies BodyInit.
  const body = new Uint8Array(file.bytes);
  return new Response(body, {
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
