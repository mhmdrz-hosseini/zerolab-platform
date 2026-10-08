"use client";

import { useGLTF } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";
import { moldErrorFa } from "@/config/mold-params";
import type { MoldPricing } from "@/config/mold-pricing";
import { CreditIndicator } from "@/components/lab/CreditIndicator";
import { CreditWall } from "@/components/lab/CreditWall";
import { GlbStage } from "@/components/viewer/GlbStage";
import { MoldResultStage } from "@/components/viewer/MoldResultStage";
import { ViewerCanvas } from "@/components/viewer/ViewerCanvas";
import { setViewerParams } from "@/components/viewer/params-store";
import { ParamsPanel, STUDIO_UI_DEFAULTS } from "@/components/studio/ParamsPanel";
import { ResultCard } from "@/components/studio/ResultCard";
import { refreshQuotaUI } from "@/lib/lab-bus";
import type { MoldParamValue, MoldParamValues } from "@/config/mold-params";

/**
 * /studio screen (mold-studio ticket 13) — the full mold studio: the user's
 * generated GLB on stage, the four essential params + advanced accordion,
 * generate → poll → mold assembly view with explode slider, price card.
 * Entered from the lab's «ورود به استودیو قالب» CTA after 3D completes.
 */

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);
const POLL_MS = 2000;

type GenStatus = "idle" | "generating" | "success" | "failed";

interface PollResponse {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  progress: number | null;
  phase: string | null;
  faPhase: string | null;
  errorCode: string | null;
  refunded: boolean;
  result: {
    summary?: Record<string, unknown> | null;
    volumes?: Record<string, number> | null;
    warnings?: unknown[];
    parts?: Array<{ name: string; file: string; role: string }>;
    print?: { parts?: Array<Record<string, unknown>> } | null;
  } | null;
  artifacts: {
    files: Array<{ name: string; role: string; bytes: number; url: string }>;
    zipUrl: string;
  } | null;
  pricing: MoldPricing | null;
}

/** Reports the model's height/footprint aspect (aspect-preserving normalization). */
function ModelMetrics({
  glbUrl,
  onRatio,
}: {
  glbUrl: string;
  onRatio: (ratio: number | null) => void;
}) {
  const gltf = useGLTF(glbUrl);
  useEffect(() => {
    const scene = (gltf.scene ?? gltf.scenes?.[0]) as THREE.Object3D | undefined;
    if (!scene) {
      onRatio(null);
      return;
    }
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    const footprint = Math.max(size.x, size.z);
    onRatio(footprint > 0 ? size.y / footprint : null);
  }, [gltf, onRatio]);
  return null;
}

interface Advice {
  text: string;
  apply: Partial<MoldParamValues>;
}

function adviceFor(ratio: number | null): Advice | null {
  if (ratio === null) return null;
  if (ratio < 0.35) {
    return {
      text: "طرح شما تخت است؛ سینی ریختگی با سیلیکون کمتر و جداسازی آسان‌تر نتیجه می‌دهد.",
      apply: { box_style: "TRAY" },
    };
  }
  if (ratio > 1.5) {
    return {
      text: "طرح شما بلند است؛ ۲ راه‌گاه هوا و ۲ نقطهٔ ریختن جلوی حباب و ناقص‌ماندن جزئیات بالا را می‌گیرد.",
      apply: { vent_count: 2, sprue_count: 2 },
    };
  }
  return null;
}

export function StudioScreen({ taskId }: { taskId: string }) {
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [values, setValues] = useState<MoldParamValues>(STUDIO_UI_DEFAULTS);
  const [status, setStatus] = useState<GenStatus>("idle");
  const [jobId, setJobId] = useState<string | null>(null);
  const [poll, setPoll] = useState<PollResponse | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const [ratio, setRatio] = useState<number | null>(null);
  const [adviceDismissed, setAdviceDismissed] = useState(false);
  const [adviceApplied, setAdviceApplied] = useState(false);
  const [explode, setExplode] = useState(30);
  const [showSkin, setShowSkin] = useState(true);
  const [ordered, setOrdered] = useState(false);
  const [orderToast, setOrderToast] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advice = useMemo(() => adviceFor(ratio), [ratio]);

  /* load the 3D task */
  useEffect(() => {
    let alive = true;
    fetch(`/api/threed/${taskId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as {
          status: string;
          glbUrl: string | null;
          viewerParams: { sizeCm: number; color: string } | null;
        };
      })
      .then((data) => {
        if (!alive) return;
        if (data.status !== "success" || !data.glbUrl) {
          setLoadError(true);
          return;
        }
        setGlbUrl(data.glbUrl);
        if (data.viewerParams) setViewerParams(data.viewerParams);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [taskId]);

  useEffect(
    () => () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    },
    [],
  );

  const onChange = useCallback((key: string, value: MoldParamValue) => {
    setValues((v) => ({ ...v, [key]: value }));
  }, []);

  /* generate + poll */
  const generate = async () => {
    if (status === "generating" || !taskId) return;
    setStatus("generating");
    setOrdered(false);
    setPoll(null);
    setPostError(null);
    const payload: Record<string, unknown> = { ...values };
    const rot = payload.model_rotation as [number, number, number];
    if (!rot || rot.every((r) => r === 0)) delete payload.model_rotation;
    try {
      const res = await fetch("/api/mold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, params: payload }),
      });
      if (res.status === 402) {
        window.dispatchEvent(new Event("lab:open-credit-wall"));
        setStatus("idle");
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === "model_too_old") {
          setPostError(
            "این مدل پیش از ارتقای موتور ساخته شده و نسخهٔ تمیزِ مناسب قالب‌سازی ندارد — لطفاً اول مدل سه‌بعدی را دوباره بسازید، بعد قالب بگیرید.",
          );
          setStatus("failed");
          return;
        }
      }
      if (!res.ok) throw new Error(`POST /api/mold ${res.status}`);
      const data = (await res.json()) as { jobId: string };
      setJobId(data.jobId);
      refreshQuotaUI();
      schedulePoll(data.jobId);
    } catch (err) {
      console.error(err);
      setStatus("failed");
      setPoll(null);
    }
  };

  const placeOrder = async () => {
    if (!jobId || ordered) return;
    try {
      const res = await fetch(`/api/mold/${jobId}/order`, { method: "POST" });
      if (!res.ok) throw new Error(`order ${res.status}`);
      setOrdered(true);
      setOrderToast(true);
      setTimeout(() => setOrderToast(false), 3200);
    } catch (err) {
      console.error(err);
      setOrderToast(true);
      setTimeout(() => setOrderToast(false), 3200);
    }
  };

  const schedulePoll = (id: string) => {
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/mold/${id}`);
        if (!res.ok) throw new Error(`poll ${res.status}`);
        const data = (await res.json()) as PollResponse;
        setPoll(data);
        if (data.status === "success") {
          setStatus("success");
          refreshQuotaUI();
          return;
        }
        if (data.status === "failed") {
          setStatus("failed");
          refreshQuotaUI(); // refund may have restored quota
          return;
        }
      } catch (err) {
        console.error(err);
      }
      schedulePoll(id);
    }, POLL_MS);
  };

  const printParts = (poll?.result?.print?.parts ?? []) as Array<{
    name: string;
    q?: number[];
    dims?: number[];
    assembly_center?: number[];
  }>;

  return (
    <div className="flex h-dvh flex-col bg-paper">
      <style>{`
        @keyframes zl-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes zl-spin { to { transform: rotate(360deg); } }
      `}</style>

      {/* top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-paper px-4">
        <Link href="/lab" className="text-sm font-extrabold text-plum hover:opacity-80">
          ZeroLab
        </Link>
        <span className="text-[11px] text-ink/50">/ استودیو قالب</span>
        <span className="flex-1" />
        <Link
          href="/lab"
          className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-bold transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
        >
          ← بازگشت به لاب
        </Link>
        <CreditIndicator />
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* viewer */}
        <main className="relative h-[38dvh] min-h-[280px] md:order-2 md:h-auto md:min-h-0 md:flex-1">
          {glbUrl ? (
            <ViewerCanvas controlsEnabled={status !== "generating"}>
              {status === "success" && poll?.artifacts ? (
                <MoldResultStage
                  files={poll.artifacts.files}
                  printParts={printParts}
                  explode={explode}
                  showSkin={showSkin}
                  skinColor="#d9b9b1"
                />
              ) : (
                <>
                  <GlbStage glbUrl={glbUrl} />
                  <ModelMetrics glbUrl={glbUrl} onRatio={setRatio} />
                </>
              )}
            </ViewerCanvas>
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center text-xs text-ink/50">
              {loadError
                ? "مدل سه‌بعدی پیدا نشد — از لاب دوباره وارد شوید."
                : "در حال بارگذاری مدل…"}
            </div>
          )}

          {/* progress overlay */}
          {status === "generating" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-paper/80 backdrop-blur-sm">
              <div className="w-[min(320px,80%)] rounded-2xl border border-line bg-paper p-5 text-center shadow-xl">
                <div
                  className="mx-auto mb-3.5 h-[86px] w-[86px] rounded-full border-[3px] border-accent-soft border-t-plum"
                  style={{ animation: "zl-spin 1s linear infinite" }}
                />
                <div className="min-h-5 text-[13px] font-extrabold text-plum">
                  {poll?.faPhase ?? "راه‌اندازی موتور ساخت"}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-cream">
                  <div
                    className="h-full rounded-full bg-plum transition-[width] duration-500"
                    style={{ width: `${poll?.progress ?? 4}%` }}
                  />
                </div>
                <div className="mt-1.5 text-[11px] text-ink/55 tabular-nums">
                  {fa(poll?.progress ?? 0)}٪ · معمولاً ۳۰ تا ۹۰ ثانیه
                </div>
              </div>
            </div>
          )}

          {/* result viewer tools */}
          {status === "success" && (
            <div className="absolute bottom-3 start-3 z-10 flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-line bg-paper/95 px-3 py-2 shadow-md backdrop-blur-sm">
                <label
                  htmlFor="zl-explode"
                  className="text-[11px] font-bold text-ink/75"
                >
                  جداسازی
                </label>
                <input
                  id="zl-explode"
                  type="range"
                  min={0}
                  max={100}
                  value={explode}
                  onChange={(e) => setExplode(Number(e.target.value))}
                  className="w-24"
                  style={{ accentColor: "var(--plum)" }}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowSkin((v) => !v)}
                className="rounded-xl border border-line bg-paper/95 px-3 py-2 text-[11px] font-bold shadow-md backdrop-blur-sm transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
              >
                پوست سیلیکونی: {showSkin ? "روشن" : "خاموش"}
              </button>
            </div>
          )}

          {status === "success" && (
            <div className="pointer-events-none absolute bottom-3 end-3 z-10 text-[10px] text-ink/45">
              قطعات قالب — نمای مونتاژ
            </div>
          )}
        </main>

        {/* params panel */}
        <aside className="flex min-h-0 flex-1 flex-col border-t border-line bg-paper md:order-1 md:w-[392px] md:flex-none md:border-t-0 md:border-e">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {/* size carried from the lab */}
            <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-cream px-3 py-2.5 text-xs">
              اندازهٔ مدل از ویوئر لاب حمل شد (بلندترین ضلع) —{" "}
              <Link
                href="/lab"
                className="font-bold text-teal hover:opacity-80"
              >
                ویرایش ↗
              </Link>
            </div>

            {/* adviser */}
            {advice && !adviceDismissed && status === "idle" && (
              <div className="mb-4 flex items-start gap-2 rounded-xl border border-teal/30 bg-teal/10 px-3 py-2.5 text-[11px] leading-6">
                <span className="text-sm leading-6">✦</span>
                <span>
                  <b className="text-teal">پیشنهاد خودکار:</b> {advice.text}
                </span>
                <span className="ms-auto flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setValues((v) => ({ ...v, ...advice.apply }) as MoldParamValues);
                      setAdviceApplied(true);
                    }}
                    className="font-extrabold text-teal hover:opacity-75"
                  >
                    {adviceApplied ? "اعمال شد ✓" : "اعمال"}
                  </button>
                  <button
                    type="button"
                    aria-label="بستن پیشنهاد"
                    onClick={() => setAdviceDismissed(true)}
                    className="text-ink/35 hover:text-ink"
                  >
                    ×
                  </button>
                </span>
              </div>
            )}

            {status === "failed" && (
              <div className="mb-4 rounded-xl border border-accent-soft bg-paper px-3 py-3 text-[11px] leading-6">
                <div className="font-extrabold text-plum">
                  ساخت قالب ناموفق بود
                </div>
                <div className="mt-1 text-ink/70">
                  {postError ?? moldErrorFa(poll?.errorCode ?? null)}
                </div>
                {poll?.refunded && (
                  <div className="mt-1 text-teal">
                    اعتبار مصرفی برگشت داده شد.
                  </div>
                )}
              </div>
            )}

            <ParamsPanel values={values} onChange={onChange} />

            {status === "success" && poll && (
              <ResultCard
                result={poll.result ?? {}}
                pricing={poll.pricing}
                ordered={ordered}
                onOrder={() => {
                  void placeOrder();
                }}
              />
            )}
          </div>

          {/* generate footer */}
          <div className="shrink-0 border-t border-line bg-paper px-4 py-3">
            <button
              type="button"
              onClick={generate}
              disabled={status === "generating" || !glbUrl}
              className="w-full rounded-full bg-plum py-3 text-xs font-extrabold text-paper transition hover:opacity-90 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
            >
              {status === "generating"
                ? "…در حال ساخت قالب"
                : status === "success"
                  ? "🔨 ساخت مجدد با تنظیمات جدید"
                  : "🔨 ساخت قالب"}
            </button>
            <div className="mt-1.5 text-center text-[10px] text-ink/55">
              مصرف ۶۰ اعتبار · میانگین زمان ۳۰ تا ۹۰ ثانیه
            </div>
          </div>
        </aside>
      </div>

      {/* chat pill — minimized chat, continues in the lab; sits over the
          viewer (inline-end), clear of the params panel's sticky footer */}
      <Link
        href="/lab"
        className="fixed bottom-4 end-4 z-30 flex items-center gap-2 rounded-full bg-plum px-4 py-2.5 text-xs font-extrabold text-paper shadow-[0_10px_26px_rgba(61,31,39,0.35)] transition hover:opacity-90"
      >
        💬 گفتگو با زیرو
      </Link>

      {orderToast && (
        <div
          className="fixed bottom-16 end-4 z-50 rounded-xl bg-ink px-4 py-3 text-xs font-bold text-paper"
          style={{ animation: "zl-rise 0.25s ease-out both" }}
        >
          ثبت سفارش در گام بعدی فعال می‌شود — قالب شما آماده است ✓
        </div>
      )}

      <CreditWall />
    </div>
  );
}

/** Client wrapper reading ?task= — must live in a client module (Next 16). */
export function StudioScreenWithParams() {
  const params = useSearchParams();
  const taskId = params.get("task");
  if (!taskId) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-paper text-center">
        <p className="text-sm font-extrabold text-plum">استودیو قالب</p>
        <p className="text-xs text-ink/60">
          مدلی برای ساخت قالب انتخاب نشده — ابتدا در لاب مدل سه‌بعدی بسازید.
        </p>
        <a
          href="/lab"
          className="rounded-full bg-plum px-4 py-2 text-xs font-bold text-paper"
        >
          رفتن به لاب
        </a>
      </div>
    );
  }
  return <StudioScreen taskId={taskId} />;
}
