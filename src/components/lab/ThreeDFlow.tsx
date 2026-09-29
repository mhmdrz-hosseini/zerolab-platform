"use client";

import { damp } from "maath/easing";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onLabEvent, refreshQuotaUI } from "@/lib/lab-bus";
import { emitMorphDone, emitThreedState, onMorphDone, type ThreedPhase } from "@/components/viewer/flow-events";

/**
 * 3D flow controller (ticket 14): listens to `lab:make-3d` (ImageFlow,
 * ticket 13), POSTs /api/threed, polls GET /api/threed/[id] every 2s and
 * stages the transition — image plane + hologram scan loop while waiting,
 * one-shot point-cloud morph on success (played by the viewer host), grey
 * dissolve + retry on failure. Rendered progress is damped with
 * `maath.easing.damp` — the raw poll progress is never tweened directly.
 *
 * DOM overlay is portaled into the viewer host's `#zl-viewer-overlay` layer.
 */

type Flow =
  | { phase: "wait"; imageId: string; imageUrl: string; taskId: string; sample: boolean }
  | { phase: "locked"; imageUrl: string }
  | { phase: "failed"; imageId: string; imageUrl: string; taskId?: string }
  | { phase: "morph"; imageId: string; imageUrl: string; taskId: string; glbUrl: string }
  | { phase: "done"; imageId: string; imageUrl: string; taskId: string; glbUrl: string };

const COPY = {
  queued: "در صف…",
  building: "در حال ساخت سه‌بعدی…",
  lock: "اعتبار رایگان شما برای ساخت سه‌بعدی تمام شده. برای ادامه اعتبار اضافه کنید — طرح‌تون همین‌جا منتظر می‌مونه.",
  addCredit: "افزودن اعتبار",
  failedTitle: "ساخت سه‌بعدی ناموفق بود",
  failedHint: "مدل ساخته نشد — می‌توانید دوباره تلاش کنید یا به تصویر برگردید.",
  retry: "تلاش دوباره",
  back: "بازگشت به تصویر",
} as const;

const POLL_MS = 2000;
const POLL_TIMEOUT_MS = 7 * 60 * 1000;
/** Sample mode (no TRIPO key): success arrives instantly — ramp 0→100 so the
 * hologram loop gets its moment before the morph. */
const SAMPLE_RAMP_S = 1.6;

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ThreedPostResponse {
  taskId?: string;
  status?: string;
  glbUrl?: string;
  sample?: boolean;
  error?: string;
}

interface ThreedGetResponse {
  status?: "queued" | "running" | "success" | "failed";
  progress?: number | null;
  glbUrl?: string | null;
}

export function ThreeDFlow() {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);

  const runSeqRef = useRef(0);
  const activeRef = useRef<{ imageId: string; imageUrl: string }>({
    imageId: "",
    imageUrl: "",
  });
  // maath's damp mutates an object property in place (damp(obj, prop, ...)).
  const displayedRef = useRef({ value: 0 });
  const rawTargetRef = useRef(0);
  const sampleRef = useRef(false);
  const successRef = useRef<{ glbUrl: string } | null>(null);
  const morphStartedRef = useRef(false);
  const chipTextRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Locate the viewer host's overlay layer (host is an earlier sibling).
  useEffect(() => {
    const el = document.getElementById("zl-viewer-overlay");
    if (el) {
      setOverlay(el);
      return;
    }
    let tries = 0;
    const timer = setInterval(() => {
      const found = document.getElementById("zl-viewer-overlay");
      if (found) {
        setOverlay(found);
        clearInterval(timer);
      } else if (++tries > 40) {
        clearInterval(timer);
      }
    }, 50);
    return () => clearInterval(timer);
  }, []);

  const resetAnim = useCallback(() => {
    displayedRef.current.value = 0;
    rawTargetRef.current = 0;
    sampleRef.current = false;
    successRef.current = null;
    morphStartedRef.current = false;
  }, []);

  // Broadcast every flow transition to the viewer host + params panel.
  useEffect(() => {
    if (!flow) {
      emitThreedState({ phase: "idle" });
      return;
    }
    emitThreedState({
      phase: flow.phase as ThreedPhase,
      taskId: "taskId" in flow && flow.taskId ? flow.taskId : undefined,
      glbUrl: "glbUrl" in flow ? flow.glbUrl : undefined,
      imageUrl: "imageUrl" in flow ? flow.imageUrl : undefined,
      sample: flow.phase === "wait" ? flow.sample : undefined,
    });
  }, [flow]);

  /** POST /api/threed and branch into polling / sample / locked / failed. */
  const start = useCallback(
    async (imageId: string, imageUrl: string) => {
      const seq = ++runSeqRef.current;
      activeRef.current = { imageId, imageUrl };
      resetAnim();
      setFlow({ phase: "wait", imageId, imageUrl, taskId: "", sample: false });

      try {
        const res = await fetch("/api/threed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageId }),
        });
        const data = (await res.json().catch(() => ({}))) as ThreedPostResponse;
        if (seq !== runSeqRef.current) return;

        if (res.status === 402 || data.error === "insufficient_credits") {
          refreshQuotaUI();
          setFlow({ phase: "locked", imageUrl });
          return;
        }
        if (!res.ok || !data.taskId) {
          refreshQuotaUI();
          setFlow({ phase: "failed", imageId, imageUrl });
          return;
        }
        refreshQuotaUI(); // credit consumed

        const taskId = data.taskId;
        if (data.status === "success" && data.glbUrl) {
          // Sample mode — play a short hologram wait, then the morph.
          successRef.current = { glbUrl: data.glbUrl };
          sampleRef.current = true;
          setFlow({ phase: "wait", imageId, imageUrl, taskId, sample: true });
          return;
        }

        setFlow({ phase: "wait", imageId, imageUrl, taskId, sample: false });
        void pollLoop(seq, taskId);
      } catch {
        if (seq !== runSeqRef.current) return;
        refreshQuotaUI();
        setFlow({ phase: "failed", imageId, imageUrl });
      }
    },
    [resetAnim],
  );

  /** Terminal failure — reads the active image from the ref, not stale state. */
  const finishFailed = useCallback((taskId?: string) => {
    refreshQuotaUI();
    setFlow({
      phase: "failed",
      imageId: activeRef.current.imageId,
      imageUrl: activeRef.current.imageUrl,
      taskId,
    });
  }, []);

  const pollLoop = useCallback(
    async (seq: number, taskId: string) => {
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        if (seq !== runSeqRef.current) return;
        try {
          const res = await fetch(`/api/threed/${taskId}`, { cache: "no-store" });
          if (seq !== runSeqRef.current) return;
          const data = (await res.json().catch(() => ({}))) as ThreedGetResponse;

          if (res.ok && data.status === "success" && data.glbUrl) {
            successRef.current = { glbUrl: data.glbUrl };
            rawTargetRef.current = 100;
            return;
          }
          if (res.ok && data.status === "failed") {
            finishFailed(taskId);
            return;
          }
          if (typeof data.progress === "number") {
            rawTargetRef.current = Math.max(rawTargetRef.current, data.progress);
          } else if (data.status === "running") {
            // No provider progress yet — keep a slow honest drift so the
            // display never freezes (issue 04: continuous ambient motion).
            rawTargetRef.current = Math.min(96, rawTargetRef.current + 1.5);
          }
        } catch {
          // Transient network error — keep polling until the deadline.
        }
      }
      if (seq !== runSeqRef.current) return;
      finishFailed(taskId);
    },
    [finishFailed],
  );

  // rAF driver while waiting: damp displayed progress toward the raw target
  // and hand off to the morph once success is fully displayed. Runs keyed on
  // the phase only — flow updates land in flowRef without restarting the loop.
  const flowRef = useRef<Flow | null>(null);
  flowRef.current = flow;

  useEffect(() => {
    if (flowRef.current?.phase !== "wait") return;
    let raf = 0;
    let last = performance.now();
    const startT = last;

    const beginMorph = () => {
      const cur = flowRef.current;
      const glbUrl = successRef.current?.glbUrl;
      if (!glbUrl || !cur || cur.phase !== "wait") return;
      setFlow({
        phase: "morph",
        imageId: cur.imageId,
        imageUrl: cur.imageUrl,
        taskId: cur.taskId,
        glbUrl,
      });
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (sampleRef.current) {
        rawTargetRef.current = Math.min(
          100,
          ((now - startT) / 1000 / SAMPLE_RAMP_S) * 100,
        );
      }
      // Never tween raw progress — always damp (issue 04 rule).
      damp(displayedRef.current, "value", rawTargetRef.current, 0.5, dt);
      const pct = Math.round(displayedRef.current.value);
      if (barRef.current) {
        barRef.current.style.width = `${displayedRef.current.value}%`;
      }
      if (chipTextRef.current) {
        chipTextRef.current.textContent =
          pct >= 1
            ? `${COPY.building} ٪${fa(Math.min(100, pct))}`
            : COPY.queued;
      }
      if (
        successRef.current &&
        displayedRef.current.value >= 99 &&
        !morphStartedRef.current
      ) {
        morphStartedRef.current = true;
        beginMorph();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flow?.phase]);

  // Morph completion (reported by the host's MorphStage) → done + quota pill.
  useEffect(
    () =>
      onMorphDone(({ taskId }) => {
        setFlow((prev) =>
          prev && prev.phase === "morph" && prev.taskId === taskId
            ? { ...prev, phase: "done" }
            : prev,
        );
        refreshQuotaUI();
      }),
    [],
  );

  // ImageFlow emits image-selected right before make-3d — reset first.
  useEffect(
    () =>
      onLabEvent("lab:image-selected", () => {
        runSeqRef.current += 1;
        resetAnim();
        setFlow(null);
      }),
    [resetAnim],
  );

  useEffect(
    () =>
      onLabEvent("lab:make-3d", (detail) => {
        void start(detail.imageId, detail.url);
      }),
    [start],
  );

  const back = useCallback(() => setFlow(null), []);
  const retry = useCallback(() => {
    if (flow?.phase !== "failed") return;
    void start(flow.imageId, flow.imageUrl);
  }, [flow, start]);

  if (!flow || !overlay) return null;

  const overlayStyle = (
    <style>{`
      @keyframes zl-scan {
        from { transform: translateY(0); }
        to { transform: translateY(-64px); }
      }
      @keyframes zl-sweep {
        0% { transform: translateY(-18vh); opacity: 0; }
        15% { opacity: 0.85; }
        85% { opacity: 0.85; }
        100% { transform: translateY(70vh); opacity: 0; }
      }
      @keyframes zl-flicker {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
      }
      @keyframes zl-grey {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes zl-rise {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  );

  return createPortal(
    <div className="pointer-events-none absolute inset-0 z-20">
      {overlayStyle}

      {flow.phase === "wait" && (
        <div className="absolute inset-0 overflow-hidden" role="status">
          {/* Faint scanlines — slow, transform-only (cheap). */}
          <div
            aria-hidden
            className="absolute inset-0 overflow-hidden"
            style={{ animation: "zl-flicker 4s ease-in-out infinite" }}
          >
            <div
              className="absolute inset-x-0 top-[-64px] h-[calc(100%+128px)]"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(to bottom, rgba(80,117,103,0.09) 0px, rgba(80,117,103,0.09) 1px, transparent 1px, transparent 4px)",
                animation: "zl-scan 1.8s linear infinite",
              }}
            />
          </div>
          {/* Slow glow sweep. */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-28"
            style={{
              background:
                "linear-gradient(to bottom, transparent, rgba(80,117,103,0.16), transparent)",
              filter: "blur(14px)",
              animation: "zl-sweep 4.2s ease-in-out infinite",
            }}
          />
          {/* Status chip. */}
          <div className="absolute inset-x-0 bottom-4 flex justify-center px-3">
            <span
              ref={chipTextRef}
              className="rounded-full border border-teal/30 bg-paper/95 px-3.5 py-1.5 text-[11px] font-bold text-teal shadow-sm backdrop-blur-sm"
            >
              {COPY.queued}
            </span>
          </div>
          {/* Damped progress rail. */}
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-line/40">
            <div
              ref={barRef}
              className="h-full bg-teal transition-none"
              style={{ width: "0%" }}
            />
          </div>
        </div>
      )}

      {flow.phase === "locked" && (
        <div
          role="alert"
          className="pointer-events-auto absolute inset-x-3 bottom-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-plum px-4 py-3 text-xs text-paper shadow-lg md:inset-x-6 md:bottom-6"
          style={{ animation: "zl-rise 0.35s ease-out both" }}
        >
          <span className="font-bold">{COPY.lock}</span>
          <span className="flex flex-1 flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(new CustomEvent("lab:open-credit-wall"))
              }
              className="rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-plum transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              {COPY.addCredit}
            </button>
            <button
              type="button"
              onClick={back}
              className="rounded-full border border-paper/40 px-3 py-1 text-xs font-bold text-paper transition hover:bg-paper/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
            >
              {COPY.back}
            </button>
          </span>
        </div>
      )}

      {flow.phase === "failed" && (
        <div
          className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper/75 px-6 text-center backdrop-blur-[2px]"
          style={{ animation: "zl-grey 0.9s ease-out both" }}
          role="alert"
        >
          <p className="text-sm font-extrabold text-ink/85">{COPY.failedTitle}</p>
          <p className="max-w-xs text-[11px] leading-5 text-ink/55">
            {COPY.failedHint}
          </p>
          <span className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={retry}
              className="rounded-full bg-plum px-4 py-2 text-xs font-bold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
            >
              {COPY.retry}
            </button>
            <button
              type="button"
              onClick={back}
              className="rounded-full border border-line bg-paper px-4 py-2 text-xs font-bold text-ink/80 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
            >
              {COPY.back}
            </button>
          </span>
        </div>
      )}
    </div>,
    overlay,
  );
}
