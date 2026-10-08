import { Suspense } from "react";
import { StudioScreenWithParams } from "@/components/studio/StudioScreen";

/**
 * Mold studio route (mold-studio ticket 13): entered from the lab's
 * «ورود به استودیو قالب» CTA after 3D generation completes.
 * `?task=` is the threed task id whose GLB becomes the mold input.
 */
export default function StudioPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center bg-paper text-xs text-ink/50">
          در حال ورود به استودیو قالب…
        </div>
      }
    >
      <StudioScreenWithParams />
    </Suspense>
  );
}
