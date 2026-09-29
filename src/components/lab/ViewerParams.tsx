"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onLabEvent } from "@/lib/lab-bus";
import { onThreedState, type ThreedPhase } from "@/components/viewer/flow-events";
import {
  DEFAULT_PARAMS,
  SILICONE_PALETTE,
  SIZE_MAX,
  SIZE_MIN,
  resetViewerParams,
  setViewerParams,
  useViewerParams,
} from "@/components/viewer/params-store";

/**
 * Viewer parameter panel (ticket 14): size slider (۵–۲۰ سانتی‌متر, Persian
 * numerals) + 8-swatch silicone palette, applied to the GLB material through
 * the params store and persisted per task via PATCH /api/threed/[id].
 * Portaled into the viewer host's overlay layer; visible only when a model
 * is on stage (phase done). Resets on `lab:image-selected`.
 */

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

export function ViewerParams() {
  const [phase, setPhase] = useState<ThreedPhase>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const params = useViewerParams();
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Overlay layer inside the viewer host.
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

  // Flow state: visible only when the final model is on stage.
  useEffect(
    () =>
      onThreedState((detail) => {
        setPhase(detail.phase);
        setTaskId(detail.taskId ?? null);
      }),
    [],
  );

  // Fresh image selection → back to defaults (per ticket 14).
  useEffect(
    () =>
      onLabEvent("lab:image-selected", () => {
        dirtyRef.current = false;
        resetViewerParams();
      }),
    [],
  );

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  /** Debounced persistence into the task meta (session-scoped). */
  const persist = () => {
    if (!taskId || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void fetch(`/api/threed/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sizeCm: params.sizeCm, color: params.color }),
      }).catch(() => {});
    }, 400);
  };

  const onSize = (value: number) => {
    dirtyRef.current = true;
    setViewerParams({ sizeCm: value });
  };

  const onColor = (color: string) => {
    dirtyRef.current = true;
    setViewerParams({ color });
  };

  const onReset = () => {
    dirtyRef.current = true;
    resetViewerParams();
  };

  // Persist after every committed user change.
  useEffect(persist);

  if (phase !== "done" || !overlay) return null;

  return createPortal(
    <section
      aria-label="اندازه و رنگ مدل"
      className="pointer-events-auto absolute bottom-3 end-3 w-52 rounded-xl border border-line bg-paper/95 p-3 shadow-md backdrop-blur-sm"
      style={{ animation: "zl-rise 0.3s ease-out both" }}
    >
      <style>{`
        @keyframes zl-rise {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-extrabold text-plum">اندازه و رنگ</span>
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-line bg-cream px-2 py-0.5 text-[10px] font-bold text-ink/60 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
        >
          بازنشانی
        </button>
      </div>

      <label className="mt-2.5 flex items-center justify-between gap-2 text-[11px] font-bold text-ink/70">
        <span>اندازه</span>
        <span className="font-extrabold text-teal">
          {fa(params.sizeCm)} سانتی‌متر
        </span>
      </label>
      <input
        type="range"
        min={SIZE_MIN}
        max={SIZE_MAX}
        step={1}
        value={params.sizeCm}
        onChange={(e) => onSize(Number(e.target.value))}
        onMouseUp={persist}
        onTouchEnd={persist}
        onKeyUp={persist}
        aria-label={`اندازه مدل: ${fa(params.sizeCm)} سانتی‌متر`}
        className="mt-1 w-full"
        style={{ accentColor: "var(--plum)" }}
      />

      <div className="mt-1 text-[11px] font-bold text-ink/70">رنگ سیلیکون</div>
      <div role="group" aria-label="پالت رنگ سیلیکون" className="mt-1.5 flex flex-wrap gap-1.5">
        {SILICONE_PALETTE.map((swatch) => {
          const selected = params.color === swatch.color;
          return (
            <button
              key={swatch.color}
              type="button"
              title={swatch.label}
              aria-label={`رنگ ${swatch.label}`}
              aria-pressed={selected}
              onClick={() => onColor(swatch.color)}
              className={`h-6 w-6 rounded-full border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum ${
                selected
                  ? "border-plum ring-2 ring-plum ring-offset-1 ring-offset-paper"
                  : "border-line hover:border-plum/40"
              }`}
              style={{ backgroundColor: swatch.color }}
            />
          );
        })}
      </div>

      <p className="mt-2 text-[10px] leading-4 text-ink/45">
        مقیاس نمایشی مدل — {fa(SIZE_MIN)} تا {fa(SIZE_MAX)} سانتی‌متر.
      </p>
    </section>,
    overlay,
  );
}
