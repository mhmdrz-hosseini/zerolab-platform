/**
 * Mold pricing (mold-studio ticket 14) — the ONLY place these numbers live.
 * Founder decision: قیمت بر اساس «گرم فیلامن + پیچیدگی طرح، هرکدام با ضریب/جایزه».
 *
 * formula: total = roundTo((filamentGrams × tomansPerGram) × complexity + baseFee)
 *   - filamentGrams = plastic_volume(mm³) × plasticDensity(g/ml) / 1000 ×
 *     solidToPrintFactor (real prints are walls+infill, not solid).
 *   - complexity = explainable multiplier assembled from the bonus lines below.
 *
 * Values are placeholders until pricing is tuned (same convention as credits).
 */
export const MOLD_PRICING = {
  /** Toman per printed gram of filament (material + machine time). */
  tomansPerGramFilament: 9_800,
  /** Solid plastic volume → actual printed grams (walls + ~15% infill). */
  solidToPrintFactor: 0.35,
  baseFeeTomans: 0,
  roundToTomans: 1_000,
  complexity: {
    /** Each mold piece beyond the standard two (+0.1). */
    perExtraPart: 0.1,
    /** Each air vent (+0.05), capped. */
    perVent: 0.05,
    maxVentBonus: 0.2,
    /** Detail tiers by total mold-piece faces (Blender polys from result). */
    detailTiers: [
      { maxFaces: 20_000, bonus: 0 },
      { maxFaces: 60_000, bonus: 0.15 },
      { maxFaces: 150_000, bonus: 0.3 },
      { maxFaces: Infinity, bonus: 0.45 },
    ],
    /** Contoured parting seam (self-registering, harder to print clean). */
    contoured: 0.1,
    /** Horizontal split for XL molds (bolted seam ring). */
    horizontalSplit: 0.15,
    clamp: [1.0, 2.5] as const,
  },
} as const;

export interface MoldPricingInputs {
  /** result.volumes.plastic_volume (mm³) — printed shell+parts solid volume. */
  plasticVolumeMm3: number;
  /** result.volumes.silicone_volume (mm³) — for the silicone estimate line. */
  siliconeVolumeMm3: number;
  /** result.volumes.cavity_volume (mm³) — one casting's volume. */
  cavityVolumeMm3: number;
  /** Density of the print filament (params.plastic_density, g/ml). */
  plasticDensity: number;
  /** Density of the pour silicone (params.silicone_density, g/ml). */
  siliconeDensity: number;
  /** Density of the cast material (params.cast_density, g/ml). */
  castDensity: number;
  /** Mold pieces actually built (summary.parts_count counts master too in
   *  some workflows — pass role==='part' count when available). */
  moldPieceCount: number;
  /** Sum of mold-piece faces (result.parts role==='part'). */
  totalPartFaces: number;
  /** params.vent_count */
  ventCount: number;
  /** params.contoured */
  contoured: boolean;
  /** params.split_horizontal */
  splitHorizontal: boolean;
}

export interface MoldPriceLine {
  /** Persian label for the transparency rows in the result card. */
  label: string;
  /** The bonus amount added to the multiplier (0 for the base line). */
  bonus: number;
}

export interface MoldPricing {
  /** Estimated printed grams of all mold pieces. */
  filamentGrams: number;
  /** Silicone grams needed to make the mold (report line, not priced). */
  siliconeGrams: number;
  /** Cast-material grams per casting (report line, not priced). */
  castGramsPerPiece: number;
  /** Explainable complexity multiplier (clamped). */
  complexityMultiplier: number;
  /** Persian explanation rows for the card. */
  lines: MoldPriceLine[];
  totalTomans: number;
}

export function computeMoldPrice(
  inputs: MoldPricingInputs,
): MoldPricing {
  const filamentGrams =
    (inputs.plasticVolumeMm3 / 1000) *
    inputs.plasticDensity *
    MOLD_PRICING.solidToPrintFactor;
  const siliconeGrams = (inputs.siliconeVolumeMm3 / 1000) * inputs.siliconeDensity;
  const castGramsPerPiece = (inputs.cavityVolumeMm3 / 1000) * inputs.castDensity;

  const lines: MoldPriceLine[] = [
    { label: `گرم فیلامن × ${faNum(MOLD_PRICING.tomansPerGramFilament)} تومان`, bonus: 0 },
  ];

  let multiplier = 1;
  const extraParts = Math.max(0, inputs.moldPieceCount - 2);
  if (extraParts > 0) {
    const b = extraParts * MOLD_PRICING.complexity.perExtraPart;
    multiplier += b;
    lines.push({ label: `قطعات اضافه (${faNum(extraParts)}×)`, bonus: b });
  }
  const ventBonus = Math.min(
    Math.max(0, inputs.ventCount) * MOLD_PRICING.complexity.perVent,
    MOLD_PRICING.complexity.maxVentBonus,
  );
  if (ventBonus > 0) {
    multiplier += ventBonus;
    lines.push({ label: `راه‌گاه‌های هوا (${faNum(inputs.ventCount)}×)`, bonus: ventBonus });
  }
  const tier = MOLD_PRICING.complexity.detailTiers.find(
    (t) => inputs.totalPartFaces <= t.maxFaces,
  )!;
  if (tier.bonus > 0) {
    multiplier += tier.bonus;
    lines.push({ label: "جزئیات سطح مدل", bonus: tier.bonus });
  }
  if (inputs.contoured) {
    multiplier += MOLD_PRICING.complexity.contoured;
    lines.push({ label: "درز پیرونده", bonus: MOLD_PRICING.complexity.contoured });
  }
  if (inputs.splitHorizontal) {
    multiplier += MOLD_PRICING.complexity.horizontalSplit;
    lines.push({ label: "برش افقی اضافه", bonus: MOLD_PRICING.complexity.horizontalSplit });
  }

  const [min, max] = MOLD_PRICING.complexity.clamp;
  multiplier = Math.min(max, Math.max(min, multiplier));

  const raw =
    filamentGrams * MOLD_PRICING.tomansPerGramFilament * multiplier +
    MOLD_PRICING.baseFeeTomans;
  const totalTomans = Math.round(raw / MOLD_PRICING.roundToTomans) * MOLD_PRICING.roundToTomans;

  return {
    filamentGrams,
    siliconeGrams,
    castGramsPerPiece,
    complexityMultiplier: multiplier,
    lines,
    totalTomans,
  };
}

function faNum(value: number): string {
  return new Intl.NumberFormat("fa-IR").format(value);
}
