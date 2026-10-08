import type { Metadata } from "next";
import { ManagerScreen } from "@/components/manager/ManagerScreen";

/**
 * /manager — internal orders panel (mold-studio ticket 15). Env-password
 * gated; noindex so it never surfaces in search.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ManagerPage() {
  return (
    <div dir="rtl" className="min-h-dvh bg-paper">
      <ManagerScreen />
    </div>
  );
}
