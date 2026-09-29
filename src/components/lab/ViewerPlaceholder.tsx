"use client";

import { Suspense, useEffect, useState } from "react";
import { onLabEvent } from "@/lib/lab-bus";
import {
  emitMorphDone,
  onThreedState,
  type ThreedStateDetail,
} from "@/components/viewer/flow-events";
import { GlbStage } from "@/components/viewer/GlbStage";
import { MorphStage } from "@/components/viewer/MorphStage";
import { ViewerCanvas } from "@/components/viewer/ViewerCanvas";

/**
 * 3D viewer area of the lab shell (issue 11, host for ticket 14). One host,
 * clean swaps — no double Canvas:
 * - empty state (before any image flow)
 * - image plane (ticket 13 `lab:image-selected`)
 * - 3D states from ThreeDFlow: one-shot point-cloud morph, then the final
 *   GLB with OrbitControls. Wait/locked/failed overlays arrive from
 *   ThreeDFlow through the `#zl-viewer-overlay` layer below.
 */

export function ViewerPlaceholder({ className = "" }: { className?: string }) {
  const [planeUrl, setPlaneUrl] = useState<string | null>(null);
  const [threed, setThreed] = useState<ThreedStateDetail | null>(null);

  useEffect(
    () =>
      onLabEvent("lab:image-selected", (detail) => {
        setPlaneUrl(detail.standardizedUrl);
      }),
    [],
  );

  useEffect(
    () =>
      onThreedState((detail) => {
        setThreed(detail.phase === "idle" ? null : detail);
      }),
    [],
  );

  const phase = threed?.phase;
  const activeGlb = threed?.glbUrl ?? null;
  const activeImage = threed?.imageUrl ?? planeUrl ?? "";
  const showMorph = phase === "morph" && !!activeGlb;
  const showDone = phase === "done" && !!activeGlb;
  const morphTaskId = showMorph ? (threed?.taskId ?? "") : "";

  return (
    <section
      aria-label="ویوئر سه‌بعدی"
      className={`relative flex items-center justify-center overflow-hidden bg-paper ${className}`}
    >
      {/* Subtle blueprint grid, fading toward the edges. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(to left, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          opacity: 0.4,
          maskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, black 30%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 75% at 50% 50%, black 30%, transparent 100%)",
        }}
      />

      {/* Overlay layer — ThreeDFlow and ViewerParams portal in here. */}
      <div
        id="zl-viewer-overlay"
        className="pointer-events-none absolute inset-0 z-20"
      />

      {showMorph || showDone ? (
        <div className="absolute inset-0 z-10">
          <ViewerCanvas controlsEnabled={showDone}>
            <Suspense fallback={null}>
              {showMorph ? (
                <MorphStage
                  glbUrl={activeGlb as string}
                  imageUrl={activeImage}
                  onComplete={() => emitMorphDone(morphTaskId)}
                />
              ) : (
                <GlbStage glbUrl={activeGlb as string} />
              )}
            </Suspense>
          </ViewerCanvas>
        </div>
      ) : planeUrl ? (
        <figure className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-3 p-4 md:p-8">
          <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden rounded-xl border border-line bg-cream p-3 shadow-sm md:p-6">
            <img
              src={planeUrl}
              alt="تصویر نهایی طرح"
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <figcaption className="text-[11px] font-bold text-teal">
            تصویر نهایی شما — آمادهٔ تبدیل به 3D
          </figcaption>
        </figure>
      ) : (
        <div className="relative z-10 flex flex-col items-center gap-3 px-6 text-center">
          <svg
            aria-hidden
            width="60"
            height="60"
            viewBox="0 0 64 64"
            fill="none"
            stroke="var(--plum)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          >
            <path d="M32 6 55 19v26L32 58 9 45V19L32 6Z" />
            <path d="M32 32 9 19M32 32l23-13M32 32v26" opacity="0.55" />
          </svg>
          <p className="text-[11px] font-bold text-teal">ویوئر سه‌بعدی</p>
          <p className="text-lg font-extrabold text-plum">
            ایده‌ات را با زیرو شروع کن
          </p>
          <p className="max-w-xs text-sm leading-7 text-ink/60">
            وقتی ایده در چت شکل گرفت، مدل سه‌بعدی قالب همین‌جا رندر می‌شود.
          </p>
        </div>
      )}
    </section>
  );
}
