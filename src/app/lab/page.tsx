import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ChatPanel } from "@/components/lab/ChatPanel";
import { CreditIndicator } from "@/components/lab/CreditIndicator";
import { CreditWall } from "@/components/lab/CreditWall";
import { ImageFlow } from "@/components/lab/ImageFlow";
import { LibraryButton } from "@/components/lab/LibraryButton";
import { ThreeDFlow } from "@/components/lab/ThreeDFlow";
import { ViewerParams } from "@/components/lab/ViewerParams";
import { ViewerPlaceholder } from "@/components/lab/ViewerPlaceholder";
import { SERVICE_COOKIE, serviceTitle } from "@/config/services";

export const metadata: Metadata = {
  title: "لابراتوار — ZeroLab",
};

/**
 * Lab shell (issue 11): slim top bar, 3D viewer as the main area
 * (left on desktop), chat docked bottom-right in RTL. Under 768px the
 * viewer sits on top and the chat goes full-width below it.
 */
export default async function LabPage() {
  const jar = await cookies();
  const world = serviceTitle(jar.get(SERVICE_COOKIE)?.value);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-paper px-3 md:h-14 md:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link
            href="/"
            title="بازگشت به صفحهٔ انتخاب خدمت"
            className="text-lg font-black text-plum"
          >
            ZeroLab
          </Link>
          <span className="hidden text-xs text-ink/50 sm:inline">
            لابراتوار ایده تا قالب
          </span>
          {world && (
            <span className="rounded-full border border-line bg-cream px-2.5 py-1 text-[11px] font-bold text-ink/70">
              دنیا: {world}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CreditIndicator />
          <LibraryButton />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ViewerPlaceholder className="order-1 h-[38dvh] shrink-0 md:order-2 md:h-auto md:min-h-0 md:flex-1" />
        <aside className="order-2 flex min-h-0 flex-1 flex-col border-t border-line md:order-1 md:w-[400px] md:flex-none md:border-e md:border-t-0 lg:w-[440px]">
          <ChatPanel />
        </aside>
      </div>

      {/* Image generation & selection flow (issue 13) — renders null until opened. */}
      <ImageFlow />
      {/* 3D flow controller + overlay (ticket 14) — portals into the viewer. */}
      <ThreeDFlow />
      {/* Size/color panel (ticket 14) — visible once a 3D model is on stage. */}
      <ViewerParams />
      {/* Credit wall + upgrade dialog controller (ticket 16) — banners, toast. */}
      <CreditWall />
    </div>
  );
}
