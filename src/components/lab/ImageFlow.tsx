"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitLabEvent,
  onLabEvent,
  refreshQuotaUI,
} from "@/lib/lab-bus";
import { buildImagePrompt, buildStandardizePrompt } from "@/lib/image-prompt";

/**
 * Image generation & selection flow (issue 13), mounted once in the lab shell.
 * Opens when ChatPanel (ticket 12) emits `lab:generate-image`; after the
 * two-stage confirmation emits `lab:image-selected` + `lab:make-3d` for
 * ticket 14. Persian microcopy per issues 05/07.
 */

type AspectRatio = "1:1" | "4:3" | "3:4";

const ASPECT_OPTIONS: ReadonlyArray<{ value: AspectRatio; label: string }> = [
  { value: "1:1", label: "۱:۱" },
  { value: "4:3", label: "۴:۳" },
  { value: "3:4", label: "۳:۴" },
];

type SlotState =
  | { status: "loading" }
  | { status: "done"; imageId: string; url: string }
  | { status: "error"; locked: boolean; message: string };

type Phase = "gallery" | "standardizing" | "confirm";

interface ImageApiResponse {
  imageId?: string;
  url?: string;
  error?: string;
}

const COPY = {
  /** Ticket 05 warning (20% of the free image quota). */
  warning: "اعتبار رایگان تصویر رو به اتمام است.",
  /** Ticket 05 lock copy for image generation. */
  lock: "اعتبار رایگان شما برای تولید تصویر تمام شده. برای ادامه اعتبار اضافه کنید — طرح‌تون همین‌جا منتظر می‌مونه.",
  addCredit: "افزودن اعتبار",
  slotFailed: "ساخت این واریاسیون ناموفق بود.",
  networkFailed: "ارتباط با سرویس تصویر برقرار نشد.",
  standardizeFailed: "ساخت نسخهٔ استاندارد ناموفق ماند — دوباره تلاش کنید.",
} as const;

/** Display-only auto checklist (issue 07, step 3). */
const CHECKLIST = ["تک‌شیء", "پس‌زمینهٔ ساده", "بدون متن"] as const;

const BTN_PRIMARY =
  "rounded-full bg-plum px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum disabled:cursor-not-allowed disabled:opacity-40";
const BTN_GHOST =
  "rounded-full border border-line bg-paper px-4 py-2 text-xs font-bold text-ink/80 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum disabled:cursor-not-allowed disabled:opacity-40";

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

function replaceAt<T>(arr: readonly T[], index: number, value: T): T[] {
  const out = arr.slice();
  out[index] = value;
  return out;
}

const loadingSlots = (): SlotState[] =>
  [0, 1, 2, 3].map((): SlotState => ({ status: "loading" }));

/** Narrow a slot to its done payload (imageId + url) or undefined. */
function donePayload(
  state: SlotState | undefined,
): { imageId: string; url: string } | undefined {
  return state && state.status === "done"
    ? { imageId: state.imageId, url: state.url }
    : undefined;
}

async function fetchImageQuota(): Promise<{ used: number; total: number } | null> {
  try {
    const res = await fetch("/api/quota", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { image?: { used: number; total: number } };
    return data.image ?? null;
  } catch {
    return null;
  }
}

export function ImageFlow() {
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [turn, setTurn] = useState(0);
  const [turnRefUrl, setTurnRefUrl] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotState[]>(loadingSlots);
  const [phase, setPhase] = useState<Phase>("gallery");
  const [quotaLocked, setQuotaLocked] = useState(false);
  const [quotaWarning, setQuotaWarning] = useState(false);
  const [pendingRatio, setPendingRatio] = useState<AspectRatio | null>(null);
  const [variationSource, setVariationSource] = useState<{
    imageId: string;
    url: string;
  } | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [standard, setStandard] = useState<{ imageId: string; url: string } | null>(
    null,
  );
  const [standardError, setStandardError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIdx, setCompareIdx] = useState<number[]>([]);

  const turnSeqRef = useRef(0);
  // One body per gallery slot — each carries its own variation axis prompt
  // (بازنگری 2026-10-08: four identical bodies collapsed into near-clones).
  const turnBodiesRef = useRef<Record<string, unknown>[]>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  const refreshWarning = useCallback(async () => {
    const q = await fetchImageQuota();
    if (!q) return;
    const remaining = Math.max(0, q.total - q.used);
    // Ticket 05: warn when the free image quota reaches ~20%.
    setQuotaWarning(remaining > 0 && remaining <= Math.ceil(q.total * 0.2));
  }, []);

  const fireSlot = useCallback(
    async (seq: number, index: number, body: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as ImageApiResponse;
        if (turnSeqRef.current !== seq) return;
        if (res.ok && data.imageId && data.url) {
          // Extract before the updater closure: property narrowing does not
          // survive into callbacks.
          const imageId = data.imageId;
          const url = data.url;
          setSlots((prev) =>
            replaceAt(prev, index, { status: "done", imageId, url }),
          );
        } else if (res.status === 402 || data.error === "insufficient_credits") {
          setQuotaLocked(true);
          setSlots((prev) =>
            replaceAt(prev, index, {
              status: "error",
              locked: true,
              message: COPY.lock,
            }),
          );
        } else {
          setSlots((prev) =>
            replaceAt(prev, index, {
              status: "error",
              locked: false,
              message: COPY.slotFailed,
            }),
          );
        }
      } catch {
        if (turnSeqRef.current !== seq) return;
        setSlots((prev) =>
          replaceAt(prev, index, {
            status: "error",
            locked: false,
            message: COPY.networkFailed,
          }),
        );
      } finally {
        // Ticket 13 contract: refresh the quota pill after every consumption.
        refreshQuotaUI();
      }
    },
    [],
  );

  /** One generation turn = 4 parallel POST /api/image calls (ticket 07). */
  const runTurn = useCallback(
    async (params: {
      brief: string;
      chatId: string | null;
      ratio: AspectRatio;
      refImageId: string | null;
      refUrl: string | null;
      feedback: string | null;
    }) => {
      const seq = ++turnSeqRef.current;
      setSlots(loadingSlots());
      setQuotaLocked(false);
      setPhase("gallery");
      setStandard(null);
      setStandardError(null);
      setSelectedIdx(null);
      setLightboxIdx(null);
      setCompareIdx([]);
      setTurnRefUrl(params.refUrl);
      setTurn((t) => t + 1);

      const bodies = [0, 1, 2, 3].map((i) => {
        const body: Record<string, unknown> = {
          prompt: buildImagePrompt(params.brief, {
            variationIndex: i,
            ...(params.feedback ? { feedback: params.feedback } : {}),
          }),
          brief: params.brief,
          aspectRatio: params.ratio,
        };
        if (params.chatId) body.chatId = params.chatId;
        if (params.refImageId) body.refImageId = params.refImageId;
        return body;
      });
      turnBodiesRef.current = bodies;

      await Promise.all(bodies.map((b, i) => fireSlot(seq, i, b)));
      void refreshWarning();
    },
    [fireSlot, refreshWarning],
  );

  const closeFlow = useCallback(() => {
    setOpen(false);
    setLightboxIdx(null);
  }, []);

  // ChatPanel (ticket 12) opens the flow.
  useEffect(
    () =>
      onLabEvent("lab:generate-image", (detail) => {
        setBrief(detail.brief);
        setChatId(detail.chatId ?? null);
        setRatio("1:1");
        setPendingRatio(null);
        setVariationSource(null);
        setFeedbackDraft("");
        setCompareMode(false);
        setQuotaWarning(false);
        setTurn(0);
        setTurnRefUrl(null);
        setOpen(true);
        void refreshWarning();
        void runTurn({
          brief: detail.brief,
          chatId: detail.chatId ?? null,
          ratio: "1:1",
          refImageId: null,
          refUrl: null,
          feedback: null,
        });
      }),
    [runTurn, refreshWarning],
  );

  // ESC closes the lightbox first, then the flow.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (lightboxIdx !== null) {
        setLightboxIdx(null);
        return;
      }
      closeFlow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lightboxIdx, closeFlow]);

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const busy = slots.some((s) => s.status === "loading");
  const selectedDone = donePayload(
    selectedIdx !== null ? slots[selectedIdx] : undefined,
  );
  const lightboxSlot = donePayload(
    lightboxIdx !== null ? slots[lightboxIdx] : undefined,
  );

  /** Two-stage confirm: standardize the picked variation (ticket 07 step 3). */
  const startStandardize = async (index: number) => {
    const slot = slots[index];
    if (!slot || slot.status !== "done" || phase === "standardizing") return;
    setSelectedIdx(index);
    setPhase("standardizing");
    setStandard(null);
    setStandardError(null);
    setLightboxIdx(null);
    try {
      const body: Record<string, unknown> = {
        prompt: buildStandardizePrompt(brief),
        aspectRatio: ratio,
        refImageId: slot.imageId,
        kind: "standardized",
      };
      if (chatId) body.chatId = chatId;
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as ImageApiResponse;
      if (res.ok && data.imageId && data.url) {
        setStandard({ imageId: data.imageId, url: data.url });
        setPhase("confirm");
      } else if (res.status === 402 || data.error === "insufficient_credits") {
        setQuotaLocked(true);
        setPhase("gallery");
      } else {
        setPhase("gallery");
        setStandardError(COPY.standardizeFailed);
      }
    } catch {
      setPhase("gallery");
      setStandardError(COPY.networkFailed);
    } finally {
      refreshQuotaUI();
      void refreshWarning();
    }
  };

  /** Retry a single failed slot (the route refunds failed calls). */
  const retrySlot = async (index: number) => {
    const body = turnBodiesRef.current[index];
    if (!body || busy || phase !== "gallery") return;
    const seq = ++turnSeqRef.current;
    setSlots((prev) => replaceAt(prev, index, { status: "loading" }));
    await fireSlot(seq, index, body);
    void refreshWarning();
  };

  const startVariation = (index: number) => {
    const slot = slots[index];
    if (!slot || slot.status !== "done") return;
    setVariationSource({ imageId: slot.imageId, url: slot.url });
    setFeedbackDraft("");
    setLightboxIdx(null);
  };

  const launchVariationTurn = () => {
    if (!variationSource) return;
    const ref = variationSource;
    setVariationSource(null);
    void runTurn({
      brief,
      chatId,
      ratio,
      refImageId: ref.imageId,
      refUrl: ref.url,
      feedback: feedbackDraft.trim() || null,
    });
  };

  const onRatioChip = (value: AspectRatio) => {
    if (busy || phase !== "gallery" || value === ratio) return;
    setPendingRatio(value);
  };

  const confirmPendingRatio = () => {
    if (!pendingRatio) return;
    const next = pendingRatio;
    setRatio(next);
    setPendingRatio(null);
    void runTurn({
      brief,
      chatId,
      ratio: next,
      refImageId: null,
      refUrl: null,
      feedback: null,
    });
  };

  const onTileClick = (index: number) => {
    if (phase !== "gallery") return;
    if (compareMode) {
      setCompareIdx((prev) =>
        prev.includes(index)
          ? prev.filter((i) => i !== index)
          : prev.length < 2
            ? [...prev, index]
            : [prev[1], index],
      );
      return;
    }
    setLightboxIdx(index);
  };

  /** Final confirmation: hand the standardized image to ticket 14. */
  const confirmAndBuild3D = () => {
    if (!standard || !selectedDone) return;
    emitLabEvent("lab:image-selected", {
      imageId: selectedDone.imageId,
      url: selectedDone.url,
      standardizedUrl: standard.url,
    });
    emitLabEvent("lab:make-3d", { imageId: standard.imageId, url: standard.url });
    closeFlow();
  };

  const header = (() => {
    if (phase === "standardizing") {
      return {
        title: "در حال ساخت نسخهٔ فنی…",
        subtitle: "رندر خنثی از همان طرح — ورودی مدل‌سازی سه‌بعدی",
      };
    }
    if (phase === "confirm") {
      return {
        title: "تأیید دومرحله‌ای",
        subtitle: "طرح انتخابی در برابر نسخهٔ فنی",
      };
    }
    if (variationSource) {
      return {
        title: "واریاسیون جدید",
        subtitle: "نوبت بعد روی طرح انتخابی + بازخورد شما",
      };
    }
    if (compareMode) {
      return {
        title: "مقایسهٔ دوتایی",
        subtitle: "دو طرح را انتخاب کن تا کنار هم ببینی",
      };
    }
    return {
      title: "گالری انتخاب تصویر",
      subtitle: "۴ واریاسیون موازی از بریف چت — روی هر طرح کلیک کن تا بزرگ شود",
    };
  })();

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-3 md:p-6"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="تولید و انتخاب تصویر"
        className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl outline-none focus-visible:outline-2 focus-visible:outline-plum"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-5">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-extrabold text-plum">
              {header.title}
            </span>
            <span className="truncate text-[11px] text-ink/55">
              {header.subtitle}
            </span>
          </div>
          {turn > 0 && (
            <span className="shrink-0 rounded-full border border-line bg-cream px-2.5 py-1 text-[11px] font-bold text-ink/60">
              نوبت {fa(turn)}
            </span>
          )}
          <button
            type="button"
            onClick={closeFlow}
            aria-label="بستن و بازگشت به چت"
            className="shrink-0 rounded-full border border-line bg-cream px-2.5 py-1 text-sm font-black text-ink/60 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            ✕
          </button>
        </header>

        {quotaWarning && !quotaLocked && (
          <div
            role="status"
            className="shrink-0 border-b border-accent/40 bg-accent-soft/40 px-4 py-2 text-xs font-bold text-ink md:px-5"
          >
            {COPY.warning}
          </div>
        )}
        {quotaLocked && (
          <div
            role="alert"
            className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-plum px-4 py-2.5 text-xs text-paper md:px-5"
          >
            <span className="font-bold">{COPY.lock}</span>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("lab:open-credit-wall"))
              }
              className="rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-plum transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              {COPY.addCredit}
            </button>
          </div>
        )}

        {variationSource && phase === "gallery" && (
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-cream px-4 py-2.5 md:px-5">
            <img
              src={variationSource.url}
              alt=""
              className="h-10 w-10 rounded-lg border border-line object-cover"
            />
            <span className="text-xs font-bold text-ink/80">
              واریاسیون جدید روی این طرح
            </span>
            <input
              value={feedbackDraft}
              onChange={(event) => setFeedbackDraft(event.target.value)}
              placeholder="بازخورد شما برای واریاسیون بعد (اختیاری)…"
              aria-label="بازخورد برای واریاسیون جدید"
              className="h-9 min-w-[180px] flex-1 rounded-full border border-line bg-paper px-3 text-xs text-ink outline-none transition placeholder:text-ink/40 focus:border-plum/50"
            />
            <button
              type="button"
              onClick={launchVariationTurn}
              className={BTN_PRIMARY}
            >
              ساخت ۴ واریاسیون
            </button>
            <button
              type="button"
              onClick={() => setVariationSource(null)}
              className="rounded-full px-2 py-1 text-xs text-ink/60 transition hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
            >
              انصراف
            </button>
          </div>
        )}

        {pendingRatio && !variationSource && (
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-cream px-4 py-2.5 text-xs text-ink/80 md:px-5">
            <span>
              ۴ واریاسیون جدید با نسبت{" "}
              <b className="font-extrabold text-plum">
                {ASPECT_OPTIONS.find((o) => o.value === pendingRatio)?.label}
              </b>{" "}
              ساخته می‌شود — هر تصویر ۱ اعتبار.
            </span>
            <button type="button" onClick={confirmPendingRatio} className={BTN_PRIMARY}>
              بساز
            </button>
            <button
              type="button"
              onClick={() => setPendingRatio(null)}
              className="rounded-full px-2 py-1 text-xs text-ink/60 transition hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
            >
              انصراف
            </button>
          </div>
        )}

        {standardError && phase === "gallery" && !quotaLocked && (
          <div
            role="alert"
            className="shrink-0 border-b border-line bg-cream px-4 py-2 text-xs font-bold text-plum md:px-5"
          >
            {standardError}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
          {phase === "standardizing" && (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
              <span
                aria-hidden
                className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-plum"
              />
              <p className="text-sm font-extrabold text-plum">
                در حال ساخت نسخهٔ فنی…
              </p>
              <p className="max-w-xs text-xs leading-6 text-ink/55">
                تک‌رنگ مات، معلق و بدون پس‌زمینه — یک اعتبار تصویر مصرف می‌شود.
              </p>
            </div>
          )}

          {phase === "confirm" && standard && selectedDone && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <figure className="overflow-hidden rounded-xl border border-line bg-cream">
                  <img
                    src={selectedDone.url}
                    alt="طرح انتخابی"
                    className="aspect-[4/3] w-full object-contain"
                  />
                  <figcaption className="border-t border-line px-3 py-2 text-center text-[11px] font-bold text-ink/70">
                    طرح انتخابی
                  </figcaption>
                </figure>
                <figure className="overflow-hidden rounded-xl border border-teal/40 bg-cream ring-1 ring-teal/20">
                  <img
                    src={standard.url}
                    alt="نسخهٔ استاندارد"
                    className="aspect-[4/3] w-full object-contain"
                  />
                  <figcaption className="border-t border-teal/30 bg-paper px-3 py-2 text-center text-[11px] font-extrabold text-teal">
                    نسخهٔ فنی (ورودی 3D)
                  </figcaption>
                </figure>
              </div>

              <section
                aria-label="چک‌لیست خودکار استانداردسازی"
                className="rounded-xl border border-line bg-cream p-3"
              >
                <p className="mb-2 text-[11px] font-bold text-ink/55">
                  چک‌لیست خودکار (نمایشی)
                </p>
                <ul className="flex flex-wrap gap-2">
                  {CHECKLIST.map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-1.5 rounded-full border border-teal/30 bg-paper px-3 py-1 text-xs text-ink/80"
                    >
                      <span
                        aria-hidden
                        className="flex h-4 w-4 items-center justify-center rounded-full bg-teal text-[9px] font-black text-paper"
                      >
                        ✓
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </section>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={confirmAndBuild3D}
                  className="rounded-full bg-plum px-5 py-2.5 text-sm font-extrabold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                >
                  تأیید و ساخت 3D
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedIdx !== null) void startStandardize(selectedIdx);
                  }}
                  className={BTN_GHOST}
                >
                  تصحیح دوباره
                </button>
                <p className="text-[11px] text-ink/50">
                  با تأیید، نسخهٔ فنی برای ساخت مدل سه‌بعدی ارسال می‌شود.
                </p>
              </div>
            </div>
          )}

          {phase === "gallery" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-ink/55">
                  نسبت تصویر:
                </span>
                <div
                  role="group"
                  aria-label="نسبت تصویر"
                  className="flex gap-1.5"
                >
                  {ASPECT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onRatioChip(option.value)}
                      disabled={busy || phase !== "gallery"}
                      aria-pressed={ratio === option.value}
                      className={`rounded-full border px-3 py-1.5 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum disabled:cursor-not-allowed disabled:opacity-50 ${
                        ratio === option.value
                          ? "border-plum bg-plum text-paper"
                          : "border-line bg-paper text-ink/70 hover:border-plum/40 hover:text-plum"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <span className="mx-1 h-4 w-px bg-line" aria-hidden />
                <button
                  type="button"
                  onClick={() => {
                    setCompareMode((prev) => !prev);
                    setCompareIdx([]);
                  }}
                  disabled={busy}
                  aria-pressed={compareMode}
                  className={compareMode ? BTN_PRIMARY : BTN_GHOST}
                >
                  {compareMode ? "پایان مقایسه" : "مقایسهٔ دوتایی"}
                </button>
                {turnRefUrl && (
                  <span className="text-[11px] text-ink/50">
                    واریاسیون روی طرح انتخابی
                  </span>
                )}
              </div>

              {compareMode && (
                <div className="rounded-xl border border-line bg-cream p-3">
                  {compareIdx.length < 2 ? (
                    <p className="text-[11px] font-bold text-ink/55">
                      {compareIdx.length === 0
                        ? "دو طرح را برای مقایسه انتخاب کن…"
                        : "یک طرح دیگر انتخاب کن…"}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {compareIdx.map((index) => {
                        const slot = slots[index];
                        return slot && slot.status === "done" ? (
                          <figure
                            key={index}
                            className="overflow-hidden rounded-lg border border-line bg-paper"
                          >
                            <img
                              src={slot.url}
                              alt={`مقایسهٔ واریاسیون ${fa(index + 1)}`}
                              className="aspect-[4/3] w-full object-contain"
                            />
                            <figcaption className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
                              <button
                                type="button"
                                onClick={() => void startStandardize(index)}
                                className="rounded-full bg-plum px-3 py-1 text-[11px] font-bold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                              >
                                این همونه ✓
                              </button>
                              <span className="text-[10px] text-ink/45">
                                واریاسیون {fa(index + 1)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setCompareIdx((prev) =>
                                    prev.filter((i) => i !== index),
                                  )
                                }
                                aria-label={`حذف واریاسیون ${fa(index + 1)} از مقایسه`}
                                className="rounded-full px-1.5 text-xs text-ink/50 transition hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                              >
                                ✕
                              </button>
                            </figcaption>
                          </figure>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {slots.map((slot, index) => (
                  <div
                    key={index}
                    className={`relative flex aspect-[4/3] flex-col overflow-hidden rounded-xl border bg-cream transition ${
                      compareMode && compareIdx.includes(index)
                        ? "border-teal ring-2 ring-teal/40"
                        : "border-line"
                    }`}
                  >
                    {slot.status === "loading" && (
                      <div className="flex h-full w-full items-center justify-center">
                        <div
                          aria-hidden
                          className="absolute inset-0 animate-pulse bg-paper/60"
                        />
                        <span className="relative text-[11px] font-bold text-ink/45">
                          در حال ساخت…
                        </span>
                      </div>
                    )}

                    {slot.status === "error" && (
                      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
                        <span
                          aria-hidden
                          className="text-lg"
                          role="img"
                          aria-label="ناموفق"
                        >
                          {slot.locked ? "🔒" : "⚠️"}
                        </span>
                        <p className="text-[11px] leading-5 text-ink/60">
                          {slot.locked ? "اعتبار نرسید" : slot.message}
                        </p>
                        {!slot.locked && (
                          <button
                            type="button"
                            onClick={() => void retrySlot(index)}
                            className={BTN_GHOST}
                          >
                            تلاش دوباره
                          </button>
                        )}
                      </div>
                    )}

                    {slot.status === "done" && (
                      <>
                        <img
                          src={slot.url}
                          alt={`واریاسیون ${fa(index + 1)} از ۴`}
                          onClick={() => onTileClick(index)}
                          className={`h-full w-full cursor-zoom-in object-contain p-1 ${
                            compareMode ? "cursor-pointer" : ""
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setLightboxIdx(index)}
                          aria-label={`بزرگ‌نمایی واریاسیون ${fa(index + 1)}`}
                          className="absolute end-2 top-2 rounded-full border border-line bg-paper/90 px-2 py-0.5 text-[11px] text-ink/70 transition hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                        >
                          ⤢
                        </button>
                        {!compareMode && (
                          <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-full border border-line bg-paper/95 px-2 py-1.5 shadow-sm backdrop-blur-sm">
                            <button
                              type="button"
                              onClick={() => void startStandardize(index)}
                              className="rounded-full bg-plum px-3 py-1 text-[11px] font-bold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                            >
                              این همونه ✓
                            </button>
                            <button
                              type="button"
                              onClick={() => startVariation(index)}
                              className="rounded-full px-2 py-1 text-[11px] font-bold text-ink/70 transition hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
                            >
                              واریاسیون جدید
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 md:px-5">
          <p className="text-[11px] text-ink/50">
            هر تصویر ۱ اعتبار رایگان تصویر مصرف می‌کند — یک نوبت کامل ۴ اعتبار.
          </p>
          <button
            type="button"
            onClick={closeFlow}
            className={BTN_GHOST}
          >
            بازگشت به چت
          </button>
        </footer>
      </div>

      {lightboxSlot && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="بزرگ‌نمایی تصویر"
          onClick={() => setLightboxIdx(null)}
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-ink/80 p-4 md:p-8"
        >
          <img
            src={lightboxSlot.url}
            alt={`واریاسیون ${fa((lightboxIdx as number) + 1)}`}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[72dvh] max-w-full rounded-lg object-contain shadow-2xl"
          />
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex flex-wrap items-center justify-center gap-2"
          >
            <button
              type="button"
              onClick={() => void startStandardize(lightboxIdx as number)}
              className={BTN_PRIMARY}
            >
              این همونه ✓
            </button>
            <button
              type="button"
              onClick={() => startVariation(lightboxIdx as number)}
              className={BTN_GHOST}
            >
              واریاسیون جدید
            </button>
            <button
              type="button"
              onClick={() => setLightboxIdx(null)}
              className={BTN_GHOST}
            >
              بستن
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
