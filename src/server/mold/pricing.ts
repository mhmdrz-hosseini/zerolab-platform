import "server-only";
import { computeMoldPrice, type MoldPricing, type MoldPricingInputs } from "@/config/mold-pricing";
import type { EngineResult } from "@/server/mold/engine";

/**
 * Map an engine result + the params snapshot stored on the job row into the
 * pricing inputs (mold-studio ticket 14).
 */
export function priceMoldResult(
  result: EngineResult,
  params: Record<string, unknown>,
): MoldPricing | null {
  const volumes = result.volumes;
  if (!volumes) return null;

  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const bool = (v: unknown) => v === true;

  const parts = (result.parts ?? []).filter((p) => p?.role === "part");
  const totalPartFaces = parts.reduce((sum, p) => sum + num(p.faces, 0), 0);

  const inputs: MoldPricingInputs = {
    plasticVolumeMm3: num(volumes.plastic_volume, 0),
    siliconeVolumeMm3: num(volumes.silicone_volume, 0),
    cavityVolumeMm3: num(volumes.cavity_volume, 0),
    plasticDensity: num(params.plastic_density, 1.24),
    siliconeDensity: num(params.silicone_density, 1.15),
    castDensity: num(params.cast_density, 1.1),
    moldPieceCount: Math.max(parts.length, 2),
    totalPartFaces,
    ventCount: num(params.vent_count, 0),
    contoured: bool(params.contoured),
    splitHorizontal: bool(params.split_horizontal),
  };
  return computeMoldPrice(inputs);
}
