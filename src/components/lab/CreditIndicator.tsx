"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COSTS, type CreditService } from "@/config/credits";

/**
 * Credit widget in the lab top bar — ticket 16 (rich version of the
 * issue-11 placeholder). Shows the three free quotas (چت/تصویر/سه‌بعدی)
 * plus the purchased pool with Persian numerals; clicking opens a popover
 * with per-kind progress bars, the ticket-05 economics copy and an
 * «افزودن اعتبار» shortcut that dispatches `lab:open-credit-wall`
 * (handled globally by CreditWall). Refreshes on the `zl:quota-changed`
 * window event — the spend flows dispatch it after each consumption.
 */

interface UsedTotal {
  used: number;
  total: number;
}

interface QuotaResponse {
  chat: UsedTotal;
  image: UsedTotal;
  threed: UsedTotal;
  paid: number;
  /** Derived flags from /api/quota (ticket 16) — decorative here. */
  warnings?: Record<CreditService, boolean>;
  locked?: Record<CreditService, boolean>;
}

const KIND_META: ReadonlyArray<{ kind: CreditService; label: string }> = [
  { kind: "chat", label: "چت" },
  { kind: "image", label: "تصویر" },
  { kind: "threed", label: "سه‌بعدی" },
];

const COPY = {
  title: "اعتبار شما",
  freeOf: "از",
  exhausted: "تمام شد",
  paidLabel: "اعتبار خریداری‌شده",
  /** Ticket-05 warning copy, verbatim. */
  warning: "اعتبار رایگان شما رو به اتمام است",
  addCredit: "افزودن اعتبار",
  close: "بستن جزئیات اعتبار",
  remainingTitle: "اعتبار رایگان باقی‌مانده",
} as const;

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

export function CreditIndicator() {
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quota", { cache: "no-store" });
      if (res.ok) setQuota((await res.json()) as QuotaResponse);
    } catch {
      // The pill stays blank on failure; the lab does not depend on it.
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("zl:quota-changed", refresh);
    return () => window.removeEventListener("zl:quota-changed", refresh);
  }, [load]);

  // Popover: close on outside pointer + Escape (focus returns to the pill).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!quota) {
    return (
      <span className="inline-flex h-8 items-center rounded-full border border-line bg-cream px-3 text-xs text-ink/45">
        اعتبار…
      </span>
    );
  }

  const warnings = quota.warnings;
  const locked = quota.locked;
  const anyWarning = KIND_META.some(({ kind }) => warnings?.[kind]);
  const anyLocked = KIND_META.some(({ kind }) => locked?.[kind]);
  const needsAttention = anyWarning || anyLocked;

  const rows = KIND_META.map(({ kind, label }) => {
    const total = quota[kind].total;
    const remaining = Math.max(0, total - quota[kind].used);
    return {
      kind,
      label,
      total,
      remaining,
      pct: total > 0 ? Math.round((remaining / total) * 100) : 0,
      isWarning: warnings?.[kind] ?? false,
      isLocked: locked?.[kind] ?? false,
    };
  });

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="اعتبار باقی‌مانده — برای جزئیات کلیک کنید"
        className={`inline-flex h-8 items-center gap-1.5 rounded-full border bg-cream px-3 text-xs text-ink/80 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${
          needsAttention ? "border-accent" : "border-line hover:border-plum/40"
        }`}
      >
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            needsAttention ? "bg-accent" : "bg-teal"
          }`}
        />
        <span className="font-bold text-plum">اعتبار</span>
        {/* Mobile: chat is the primary number. */}
        <span className="tabular-nums">{fa(rows[0].remaining)}</span>
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <span aria-hidden className="text-line">
            ·
          </span>
          <span className="tabular-nums">{fa(rows[1].remaining)}</span>
          <span aria-hidden className="text-line md:hidden">
            ·
          </span>
          <span className="hidden tabular-nums md:inline">
            {fa(rows[2].remaining)}
          </span>
        </span>
        {quota.paid > 0 && (
          <span className="text-teal">+{fa(quota.paid)}</span>
        )}
        {anyLocked && (
          <svg
            aria-hidden
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={COPY.title}
          className="absolute end-0 top-10 z-40 w-72 rounded-2xl border border-line bg-paper p-4 shadow-xl"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-extrabold text-plum">
              {COPY.title}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={COPY.close}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-cream text-xs text-ink/60 transition hover:border-plum/40 hover:text-plum"
            >
              ✕
            </button>
          </div>

          <p className="mb-2 text-[10px] font-bold text-ink/45">
            {COPY.remainingTitle}
          </p>
          <ul className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <li key={row.kind}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-ink/80">{row.label}</span>
                  <span className="text-ink/60">
                    {row.remaining > 0 ? (
                      <>
                        <b className="font-extrabold text-ink">
                          {fa(row.remaining)}
                        </b>{" "}
                        {COPY.freeOf} {fa(row.total)}
                      </>
                    ) : (
                      <span className="font-bold text-accent">
                        {COPY.exhausted}
                      </span>
                    )}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${row.label}: ${fa(row.remaining)} ${COPY.freeOf} ${fa(row.total)}`}
                  aria-valuemin={0}
                  aria-valuemax={row.total}
                  aria-valuenow={row.remaining}
                  className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-cream"
                >
                  <div
                    className={`h-full rounded-full transition-[width] ${
                      row.isLocked || row.isWarning ? "bg-accent" : "bg-teal"
                    }`}
                    style={{ width: `${row.pct}%` }}
                  />
                </div>
              </li>
            ))}
            <li className="flex items-center justify-between border-t border-line pt-2.5 text-xs">
              <span className="font-bold text-ink/80">{COPY.paidLabel}</span>
              <b className="font-extrabold text-teal">{fa(quota.paid)}</b>
            </li>
          </ul>

          {needsAttention && (
            <p role="status" className="mt-3 text-[11px] font-bold text-accent">
              {COPY.warning}
            </p>
          )}

          <p className="mt-3 leading-5 text-[10px] text-ink/50">
            هر پیام چت {fa(COSTS.chat)} اعتبار · هر تصویر {fa(COSTS.image)}{" "}
            اعتبار · هر مدل سه‌بعدی {fa(COSTS.threed)} اعتبار — بعد از اتمام
            سهمیهٔ رایگان از اعتبار خریداری‌شده کم می‌شود.
          </p>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent("lab:open-credit-wall"));
            }}
            className="mt-3 w-full rounded-full bg-plum px-4 py-2 text-xs font-extrabold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            {COPY.addCredit}
          </button>
        </div>
      )}
    </div>
  );
}
