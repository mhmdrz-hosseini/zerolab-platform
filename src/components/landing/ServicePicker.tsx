"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  SERVICE_WORLDS,
  UPCOMING_SERVICE,
  type ServiceSlug,
} from "@/config/services";

/**
 * Selection cards for the three service worlds (issue 11).
 * Clicking a card persists the choice via POST /api/session/service and
 * moves on to the lab. The upcoming service stays a non-clickable hint.
 */
export function ServicePicker() {
  const router = useRouter();
  const [pending, setPending] = useState<ServiceSlug | null>(null);

  async function select(slug: ServiceSlug) {
    if (pending) return;
    setPending(slug);
    try {
      await fetch("/api/session/service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: slug }),
      });
    } catch {
      // The lab still works without the cookie — never block the flow.
    }
    router.push("/lab");
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {SERVICE_WORLDS.map((world) => (
        <button
          key={world.slug}
          type="button"
          onClick={() => select(world.slug)}
          disabled={pending !== null}
          className="group flex flex-col gap-3 rounded-2xl border border-line bg-cream p-6 text-start transition duration-200 hover:-translate-y-0.5 hover:border-plum/40 hover:shadow-lg hover:shadow-plum/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum disabled:cursor-wait disabled:opacity-70"
        >
          <span className="text-[11px] font-bold text-teal">
            {world.badge}
          </span>
          <span className="text-xl font-extrabold text-plum">
            {world.title}
          </span>
          <span className="text-sm leading-7 text-ink/75">
            {world.description}
          </span>
          <ul className="mt-2 flex flex-col gap-1.5 border-t border-line pt-4 text-[13px] text-ink/70">
            {world.examples.map((example) => (
              <li key={example} className="flex items-baseline gap-2">
                <span aria-hidden className="text-accent">
                  ◦
                </span>
                {example}
              </li>
            ))}
          </ul>
          <span className="mt-auto pt-3 text-[13px] font-bold text-plum transition group-hover:underline underline-offset-4">
            {pending === world.slug ? "در حال آماده‌سازی…" : "انتخاب و شروع"}
          </span>
        </button>
      ))}

      {/* Future service — deliberately not a button. */}
      <div
        aria-disabled="true"
        className="flex flex-col gap-3 rounded-2xl border border-dashed border-line bg-paper p-6 opacity-60"
      >
        <span className="w-fit rounded-full border border-line bg-cream px-2.5 py-0.5 text-[11px] font-bold text-ink/60">
          {UPCOMING_SERVICE.badge}
        </span>
        <span className="text-xl font-extrabold text-ink/60">
          {UPCOMING_SERVICE.title}
        </span>
        <span className="text-sm leading-7 text-ink/55">
          {UPCOMING_SERVICE.description}
        </span>
      </div>
    </div>
  );
}
