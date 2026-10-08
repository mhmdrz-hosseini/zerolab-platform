"use client";

import type { MoldPricing } from "@/config/mold-pricing";

/**
 * Mold result card (mold-studio ticket 13): material estimates + the
 * transparent price breakdown from the server (ticket 14). The order button
 * is wired up in ticket 15 — for now it confirms the intent locally.
 */

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
const fa1 = (value: number) =>
  new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(value);

export interface MoldResultSummary {
  summary?: Record<string, unknown> | null;
  warnings?: unknown[];
}

export function ResultCard({
  result,
  pricing,
  onOrder,
  ordered,
}: {
  result: MoldResultSummary;
  pricing: MoldPricing | null;
  onOrder: () => void;
  ordered: boolean;
}) {
  const style = typeof result.summary?.style === "string" ? result.summary.style : "";
  const styleFa =
    style === "POUR_BOX"
      ? "جعبه‌ریزهٔ سیلیکونی"
      : style === "SOLID"
        ? "قالب پرینت مستقیم"
        : style === "TRAY"
          ? "سینی ریختگی"
          : "قالب";
  const warnings = (result.warnings ?? []).filter(
    (w): w is string => typeof w === "string",
  );

  return (
    <section
      aria-label="نتیجهٔ ساخت قالب"
      className="mb-4 rounded-2xl border border-line bg-cream p-4"
      style={{ animation: "zl-rise 0.3s ease-out both" }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-extrabold text-plum">نتیجهٔ ساخت قالب</span>
        <span className="text-[10.5px] text-ink/55">· {styleFa} · بدون خطا</span>
      </div>

      {pricing && (
        <>
          <div className="mt-2.5 flex flex-col gap-2">
            <Row k="سیلیکون لازم" v={`${fa1(pricing.siliconeGrams)} گرم`} />
            <Row
              k="هر بار محصول (متریال ریختگی)"
              v={`${fa1(pricing.castGramsPerPiece)} گرم`}
            />
            <Row k="فیلامن قطعات پرینتی" v={`${fa1(pricing.filamentGrams)} گرم`} />
          </div>

          <div className="mt-3 border-t border-dashed border-line pt-2.5">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-extrabold">قیمت تخمینی قالب</span>
              <span className="text-lg font-extrabold text-plum tabular-nums">
                {fa(pricing.totalTomans)} تومان
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-5 text-ink/60">
              {pricing.lines
                .map((l) =>
                  l.bonus > 0
                    ? `${l.label} ×${fa1(l.bonus)}`
                    : l.label,
                )
                .join(" + ")}
              {pricing.complexityMultiplier > 1 &&
                ` — ضریب پیچیدگی کل ×${fa1(pricing.complexityMultiplier)}`}{" "}
              قیمت نهایی پس از ثبت سفارش تأیید می‌شود.
            </p>
          </div>
        </>
      )}

      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {warnings.map((w, i) => (
            <li
              key={i}
              className="rounded-lg border border-accent-soft bg-paper px-2.5 py-1.5 text-[10px] leading-5 text-ink/70"
            >
              هشدار موتور ساخت: {w}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        disabled={ordered}
        onClick={onOrder}
        className="mt-3 w-full rounded-full bg-plum py-2.5 text-xs font-extrabold text-paper transition hover:opacity-90 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
      >
        {ordered ? "سفارش ثبت شد ✓" : "ثبت سفارش قالب"}
      </button>
      <p className="mt-1.5 text-center text-[9.5px] text-ink/45">
        قالب پرینت‌شده به آدرس شما ارسال می‌شود — پیگیری بعداً اعلام می‌گردد.
      </p>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink/65">{k}</span>
      <span className="font-extrabold tabular-nums">{v}</span>
    </div>
  );
}
