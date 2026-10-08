"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COSTS, type CreditService } from "@/config/credits";

/**
 * Global credit-wall controller — ticket 16, mounted once in the lab shell.
 *
 * - Watches /api/quota (initial fetch, every 30s, and on `zl:quota-changed`).
 * - 20% warning: when a free kind crosses the ticket-05 threshold the
 *   dismissible top banner «اعتبار رایگان شما رو به اتمام است» appears —
 *   once per kind per session (sessionStorage guard).
 * - Lock: when image/3D are exhausted and the paid pool cannot cover them,
 *   a sticky (non-dismissible) lock banner per kind shows the ticket-05
 *   zero-state copy. Chat at zero shows NO blocking banner (chat stays
 *   open per ticket 05) — only CreditIndicator carries the subtle state.
 * - `lab:open-credit-wall` (dispatched by ChatPanel/ImageFlow/LibraryDrawer/
 *   ThreeDFlow and the indicator popover) opens the «افزودن اعتبار» dialog:
 *   sample packs at ۱ اعتبار ≈ ۱٬۶۰۰ تومان, buy → «به‌زودی» toast, no real
 *   payment. ESC-closable + focus-trapped.
 */

interface UsedTotal {
  used: number;
  total: number;
}

interface QuotaResponse {
  chat: UsedTotal;
  image: UsedTotal;
  threed: UsedTotal;
  mold: UsedTotal;
  paid: number;
  warnings: Record<CreditService, boolean>;
  locked: Record<CreditService, boolean>;
}

const KINDS: readonly CreditService[] = ["chat", "image", "threed", "mold"];

const KIND_LABELS: Record<CreditService, string> = {
  chat: "چت",
  image: "تصویر",
  threed: "سه‌بعدی",
  mold: "قالب",
};

const COPY = {
  /** Ticket-05 warning copy, verbatim. */
  warning: "اعتبار رایگان شما رو به اتمام است",
  /** Ticket-05 zero-state copy, verbatim (image / 3D variants). */
  lockImage:
    "اعتبار رایگان شما برای تولید تصویر تمام شده. برای ادامه اعتبار اضافه کنید — طرح‌تون همین‌جا منتظر می‌مونه.",
  lockThreed:
    "اعتبار رایگان شما برای ساخت سه‌بعدی تمام شده. برای ادامه اعتبار اضافه کنید — طرح‌تون همین‌جا منتظر می‌مونه.",
  lockMold:
    "اعتبار رایگان شما برای ساخت قالب تمام شده. برای ادامه اعتبار اضافه کنید — مدلتون همین‌جا منتظر می‌مونه.",
  addCredit: "افزودن اعتبار",
  dismiss: "بستن هشدار اعتبار",
  dialogTitle: "افزودن اعتبار",
  dialogSubtitle:
    "اعتبار خریداری‌شده بعد از اتمام سهمیهٔ رایگان هر بخش مصرف می‌شود.",
  creditUnit: "اعتبار",
  toman: "تومان",
  currentPaidPrefix: "اعتبار خریداری‌شدهٔ فعلی شما:",
  buy: "خرید",
  buying: "…",
  suggested: "پیشنهاد ما",
  equivalentPrefix: "معادل",
  close: "بستن",
  /** No real payment in v1 — the gateway is a stub. */
  paymentSoon: "درگاه پرداخت به‌زودی فعال می‌شود",
} as const;

/** Sample packs (ticket 16) priced at ۱ اعتبار ≈ ۱٬۶۰۰ تومان. */
const TOMAN_PER_CREDIT = 1600;
const PACKS: readonly number[] = [50, 150, 400];
const SUGGESTED_PACK = 150;

const POLL_MS = 30_000;
const TOAST_MS = 4000;
const warnKey = (kind: CreditService) => `zl-credit-warn-${kind}`;

const lockCopy: Partial<Record<CreditService, string>> = {
  image: COPY.lockImage,
  threed: COPY.lockThreed,
  mold: COPY.lockMold,
};

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

const emptyFlags = (): Record<CreditService, boolean> => ({
  chat: false,
  image: false,
  threed: false,
  mold: false,
});

export function CreditWall() {
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  /** Visible warning banners — each kind at most once per session. */
  const [warnBanners, setWarnBanners] = useState<Record<CreditService, boolean>>(
    emptyFlags,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pendingPack, setPendingPack] = useState<number | null>(null);

  /** sessionStorage mirror — read lazily inside load(), kept in a ref. */
  const shownRef = useRef<Record<CreditService, boolean> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quota", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as QuotaResponse;
      setQuota(next);

      if (!shownRef.current) {
        const shown = emptyFlags();
        try {
          for (const kind of KINDS) {
            if (window.sessionStorage.getItem(warnKey(kind))) shown[kind] = true;
          }
        } catch {
          // Private mode etc. — fall back to in-memory only.
        }
        shownRef.current = shown;
      }
      for (const kind of KINDS) {
        if (next.warnings[kind] && !shownRef.current[kind]) {
          shownRef.current[kind] = true;
          try {
            window.sessionStorage.setItem(warnKey(kind), "1");
          } catch {
            // Same as above — the ref still guards this mount.
          }
          setWarnBanners((prev) => (prev[kind] ? prev : { ...prev, [kind]: true }));
        }
      }
    } catch {
      // Network hiccup — the next poll (or quota-changed event) retries.
    }
  }, []);

  // Global watch: initial fetch, 30s interval, and quota-change events.
  useEffect(() => {
    void load();
    const refresh = () => {
      void load();
    };
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener("zl:quota-changed", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("zl:quota-changed", refresh);
    };
  }, [load]);

  // ChatPanel/ImageFlow/LibraryDrawer/ThreeDFlow/indicator open the dialog.
  useEffect(() => {
    const open = () => {
      setDialogOpen(true);
      void load();
    };
    window.addEventListener("lab:open-credit-wall", open);
    return () => window.removeEventListener("lab:open-credit-wall", open);
  }, [load]);

  function buy(credits: number) {
    if (pendingPack !== null) return;
    setPendingPack(credits);
    setToast(COPY.paymentSoon);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      setPendingPack(null);
      toastTimerRef.current = null;
    }, TOAST_MS);
  }

  function dismissWarning(kind: CreditService) {
    setWarnBanners((prev) => ({ ...prev, [kind]: false }));
  }

  const openUpgrade = () =>
    window.dispatchEvent(new CustomEvent("lab:open-credit-wall"));

  const lockKinds = quota
    ? KINDS.filter((kind) => quota.locked[kind] && lockCopy[kind])
    : [];
  const warningKinds = KINDS.filter((kind) => warnBanners[kind]);
  const showBanners = lockKinds.length > 0 || warningKinds.length > 0;

  return (
    <>
      {/* Global banners — fixed under the top bar; z-40 keeps them below the
          z-50 flow overlays, which carry their own in-flow banners. */}
      {showBanners && (
        <div className="pointer-events-none fixed inset-x-0 top-12 z-40 flex flex-col gap-1.5 px-3 md:top-14 md:px-5">
          {lockKinds.map((kind) => (
            <div
              key={`lock-${kind}`}
              role="alert"
              className="pointer-events-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-plum/40 bg-plum px-3.5 py-2 text-paper shadow-lg"
            >
              <span className="text-xs font-bold">{lockCopy[kind]}</span>
              <button
                type="button"
                onClick={openUpgrade}
                className="rounded-full bg-paper px-3 py-1.5 text-xs font-extrabold text-plum transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
              >
                {COPY.addCredit}
              </button>
            </div>
          ))}
          {warningKinds.map((kind) => (
            <div
              key={`warn-${kind}`}
              role="status"
              className="pointer-events-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-accent/60 bg-cream px-3.5 py-2 shadow-lg"
            >
              <span className="text-xs font-bold text-ink">
                {COPY.warning}
                <span className="ms-1.5 rounded-full border border-accent/60 bg-paper px-2 py-0.5 text-[10px] font-bold text-accent">
                  {KIND_LABELS[kind]}
                </span>
              </span>
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={openUpgrade}
                  className="rounded-full bg-plum px-3 py-1.5 text-xs font-bold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                >
                  {COPY.addCredit}
                </button>
                <button
                  type="button"
                  onClick={() => dismissWarning(kind)}
                  aria-label={COPY.dismiss}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-paper text-ink/60 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                >
                  ✕
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {dialogOpen && (
        <UpgradeDialog
          paid={quota?.paid ?? 0}
          pendingPack={pendingPack}
          onBuy={buy}
          onClose={() => setDialogOpen(false)}
        />
      )}

      {toast && (
        <div
          role="status"
          className="pointer-events-none fixed inset-x-0 bottom-5 z-[70] flex justify-center px-4"
        >
          <p className="rounded-full bg-plum px-4 py-2 text-xs font-bold text-paper shadow-xl">
            {toast}
          </p>
        </div>
      )}
    </>
  );
}

/** «افزودن اعتبار» dialog — sample packs, stubbed checkout, focus-trapped. */
function UpgradeDialog({
  paid,
  pendingPack,
  onBuy,
  onClose,
}: {
  paid: number;
  pendingPack: number | null;
  onBuy: (credits: number) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // ESC closes; Tab cycles inside the dialog (focus trap).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/50 p-3 md:p-6"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-wall-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-line bg-paper p-5 shadow-2xl outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum md:p-6"
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2
              id="credit-wall-title"
              className="text-base font-extrabold text-plum"
            >
              {COPY.dialogTitle}
            </h2>
            <p className="text-xs leading-6 text-ink/60">
              {COPY.dialogSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={COPY.close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-cream text-ink/60 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            <svg
              aria-hidden
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <p className="mb-3 text-xs text-ink/70">
          {COPY.currentPaidPrefix}{" "}
          <b className="font-extrabold text-teal">{fa(paid)}</b>
        </p>

        <div className="grid gap-2.5 sm:grid-cols-3">
          {PACKS.map((credits) => {
            const suggested = credits === SUGGESTED_PACK;
            const pending = pendingPack === credits;
            return (
              <article
                key={credits}
                className={`relative flex flex-col items-center gap-1 rounded-xl border bg-cream px-3 pb-3 pt-4 text-center ${
                  suggested ? "border-plum" : "border-line"
                }`}
              >
                {suggested && (
                  <span className="absolute -top-2.5 rounded-full bg-plum px-2 py-0.5 text-[10px] font-black text-paper">
                    {COPY.suggested}
                  </span>
                )}
                <span className="text-lg font-black text-plum">
                  {fa(credits)} {COPY.creditUnit}
                </span>
                <span className="text-sm font-extrabold text-ink">
                  {fa(credits * TOMAN_PER_CREDIT)} {COPY.toman}
                </span>
                <span className="text-[10px] leading-5 text-ink/55">
                  {COPY.equivalentPrefix}{" "}
                  {fa(Math.floor(credits / COSTS.image))} تصویر یا{" "}
                  {fa(credits)} پیام چت
                </span>
                <button
                  type="button"
                  onClick={() => onBuy(credits)}
                  disabled={pendingPack !== null}
                  className="mt-1.5 w-full rounded-full bg-plum px-4 py-2 text-xs font-extrabold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? COPY.buying : COPY.buy}
                </button>
              </article>
            );
          })}
        </div>

        <p className="mt-4 text-[10px] leading-5 text-ink/50">
          هر پیام چت {fa(COSTS.chat)} اعتبار · هر تصویر {fa(COSTS.image)}{" "}
          اعتبار · هر مدل سه‌بعدی {fa(COSTS.threed)} اعتبار
        </p>
      </div>
    </div>
  );
}
