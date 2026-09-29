"use client";

import { useState } from "react";
import { LibraryDrawer } from "@/components/lab/LibraryDrawer";

/**
 * Library entry in the lab top bar (ticket 15): button + drawer state.
 * All drawer internals (tabs, grid, upload, fullscreen, detail) live in
 * LibraryDrawer.tsx — self-contained per the ticket-15 file ownership.
 */
export function LibraryButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-cream px-3 text-xs font-bold text-ink transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
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
          strokeLinejoin="round"
        >
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        لایبریری
      </button>

      <LibraryDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
