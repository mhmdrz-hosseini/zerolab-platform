"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level store for the viewer parameter panel (ticket 14): size in cm
 * + silicone color. ViewerParams writes; GlbStage reads/subscribes. A module
 * store (instead of events) means a freshly-mounted stage always sees the
 * current values — no missed-event problem.
 */

export interface ViewerParamsState {
  sizeCm: number;
  color: string;
}

/** 8 fixed silicone palette swatches (ticket 14) — hex only. */
export const SILICONE_PALETTE = [
  { color: "#f5f0eb", label: "کرمی" },
  { color: "#d9b9b1", label: "صورتیِ کندویی" },
  { color: "#b78978", label: "گلی" },
  { color: "#6b3d48", label: "آلویی" },
  { color: "#507567", label: "سبز چای" },
  { color: "#997780", label: "پودری" },
  { color: "#ddcbc7", label: "بژ روشن" },
  { color: "#3d1f27", label: "شابه‌ای" },
] as const;

export const DEFAULT_PARAMS: ViewerParamsState = {
  sizeCm: 10,
  color: SILICONE_PALETTE[0].color,
};

export const SIZE_MIN = 5;
export const SIZE_MAX = 20;

let state: ViewerParamsState = DEFAULT_PARAMS;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function getViewerParams(): ViewerParamsState {
  return state;
}

export function setViewerParams(next: Partial<ViewerParamsState>): void {
  state = {
    sizeCm:
      next.sizeCm !== undefined
        ? Math.max(SIZE_MIN, Math.min(SIZE_MAX, next.sizeCm))
        : state.sizeCm,
    color: next.color ?? state.color,
  };
  notify();
}

export function resetViewerParams(): void {
  state = DEFAULT_PARAMS;
  notify();
}

export function subscribeViewerParams(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Reactive read for client components. */
export function useViewerParams(): ViewerParamsState {
  return useSyncExternalStore(subscribeViewerParams, getViewerParams, getViewerParams);
}
