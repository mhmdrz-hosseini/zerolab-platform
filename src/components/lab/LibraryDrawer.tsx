"use client";

import { useEffect, useRef, useState } from "react";
import { emitLabEvent, refreshQuotaUI } from "@/lib/lab-bus";

/**
 * Library drawer (ticket 15) — decisions from issue 08:
 * - Panel from the RIGHT edge in RTL (~440px, 2-col grid) + a fullscreen
 *   dialog mode showing the same grid wider.
 * - Tabs «همه» (public seeds) / «مال من» (uploads + saved + generations).
 * - 7 category chips + text search (synonyms handled server-side).
 * - Cards: image, Persian title, category tag, hover «افزودن به چت»
 *   (lab:library-add per the ticket-06/12 contract); the detail view keeps
 *   the button always visible.
 * - Upload zone with the issue-08 rules copy, only in «مال من».
 * - 402 → Persian lock banner + `lab:open-credit-wall` (ticket 16 contract).
 */

interface LibraryItem {
  id: string;
  title: string;
  category: string | null;
  categoryLabel: string | null;
  description: string;
  seedPrompt: string | null;
  url: string;
  kind: string;
  isSeed: boolean;
  createdAt: string;
}

/** 7-category taxonomy (issues 03 + 08) — hand-synced twin in the /api/library routes. */
const CATEGORIES: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: "confectionery", label: "قنادی و خوراکی" },
  { slug: "resin", label: "رزین و زیورآلات" },
  { slug: "candle", label: "شمع" },
  { slug: "soap", label: "صابون و بهداشتی" },
  { slug: "plaster", label: "گچ، بتن و پودر سنگ" },
  { slug: "figures", label: "فیگور و مینیاتور" },
  { slug: "keepsake", label: "یادگاری و سفارشی" },
];

const KIND_LABELS: Record<string, string> = {
  uploaded: "آپلودی",
  saved: "ذخیره‌شده",
  generated: "ساخته‌شده",
  standardized: "استاندارد",
};

const COPY = {
  title: "لایبریری طرح‌ها",
  subtitle: "طرح‌های آمادهٔ استودیو و طرح‌های خودت — با یک کلیک به چت اضافه کن",
  tabAll: "همه",
  tabMine: "مال من",
  search: "جست‌وجو در طرح‌ها…",
  allCategories: "همهٔ دسته‌ها",
  fullscreen: "نمای کامل",
  exitFullscreen: "خروج از نمای کامل",
  close: "بستن لایبریری",
  addToChat: "افزودن به چت",
  upload: "آپلود تصویر",
  uploadRules: "فرمت JPG / PNG / WebP · حداکثر ۸ مگابایت · حداکثر ۴۰۹۶ پیکسل",
  uploadHint:
    "عکس‌های آپلودی فقط در «مال من» خودت دیده می‌شوند و هرگز به لایبریری عمومی اضافه نمی‌شوند.",
  uploading: "در حال آپلود…",
  uploadFailed: "آپلود ناموفق بود.",
  loadFailed: "دریافت لایبریری ناموفق بود.",
  retry: "تلاش دوباره",
  countSuffix: "طرح",
  emptyAll: "هنوز طرحی در لایبریری عمومی نیست — به‌زودی پر می‌شود.",
  emptyMine:
    "هنوز طرحی در «مال من» نداری؛ از چت تصویر بساز یا عکس آپلود کن.",
  emptySearchPrefix: "نتیجه‌ای برای",
  emptySearchSuffix: "پیدا نشد.",
  lock: "اعتبار کافی نیست — برای این کار اعتبار اضافه کن.",
  addCredit: "افزودن اعتبار",
  detailHint: "با افزودن به چت، تصویر و مشخصات طرح برای زیرو فرستاده می‌شود تا ببیندش و سفارشی‌سازی را روی خودِ طرح انجام دهد.",
} as const;

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

type Tab = "all" | "mine";
type Mode = "drawer" | "full";

const CHIP_ACTIVE =
  "rounded-full border border-plum bg-plum px-3 py-1.5 text-xs font-bold text-paper transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";
const CHIP_IDLE =
  "rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-bold text-ink/70 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum";

export function LibraryDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>("drawer");
  const [tab, setTab] = useState<Tab>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [nonce, setNonce] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  // Debounced search input.
  useEffect(() => {
    const timer = setTimeout(() => setQ(qInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [qInput]);

  // Main listing fetch — seq-guarded, aborted on filter change.
  useEffect(() => {
    if (!open) return;
    const seq = ++seqRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ tab });
    if (category) params.set("category", category);
    if (q) params.set("q", q);
    (async () => {
      try {
        const res = await fetch(`/api/library?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (seq !== seqRef.current) return;
        if (res.status === 402) {
          setLock(true);
          refreshQuotaUI();
          return;
        }
        if (!res.ok) throw new Error("list_failed");
        const data = (await res.json()) as { items?: LibraryItem[] };
        if (seq !== seqRef.current) return;
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setError(COPY.loadFailed);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [open, tab, category, q, nonce]);

  // ESC: close the detail view first, then the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selected) {
        setSelected(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selected, onClose]);

  useEffect(() => {
    if (open) containerRef.current?.focus();
    else setSelected(null);
  }, [open]);

  async function uploadFile(file: File) {
    if (uploading) return;
    setUploading(true);
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/library/upload", {
        method: "POST",
        body: form,
      });
      if (res.status === 402) {
        setLock(true);
        refreshQuotaUI();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        item?: LibraryItem;
        message?: string;
      };
      if (res.ok && data.item) {
        const uploaded = data.item;
        setItems((prev) => [uploaded, ...prev]);
      } else {
        setUploadMsg(data.message ?? COPY.uploadFailed);
      }
    } catch {
      setUploadMsg(COPY.uploadFailed);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** Ticket-15 → 12 contract: emit + close the drawer; ChatPanel does the rest. */
  function addToChat(item: LibraryItem) {
    emitLabEvent("lab:library-add", {
      item: {
        id: item.id,
        title: item.title,
        category: item.categoryLabel ?? "",
        description: item.description,
        ...(item.seedPrompt ? { seedPrompt: item.seedPrompt } : {}),
        url: item.url,
      },
    });
    setSelected(null);
    onClose();
  }

  if (!open) return null;

  const wide = mode === "full";
  const gridCls = wide
    ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
    : "grid grid-cols-2 gap-2.5";

  const emptyText = q
    ? `${COPY.emptySearchPrefix} «${q}» ${COPY.emptySearchSuffix}`
    : tab === "all"
      ? COPY.emptyAll
      : COPY.emptyMine;

  const panel = (
    <>
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-plum">{COPY.title}</h2>
          <p className="truncate text-[11px] leading-5 text-ink/55">
            {COPY.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMode(wide ? "drawer" : "full")}
            aria-pressed={wide}
            title={wide ? COPY.exitFullscreen : COPY.fullscreen}
            className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-paper px-2.5 text-[11px] font-bold text-ink/70 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
          >
            <svg
              aria-hidden
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {wide ? (
                <path d="M9 3H3v6M15 21h6v-6M3 15v6h6M21 9V3h-6" />
              ) : (
                <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
              )}
            </svg>
            {wide ? COPY.exitFullscreen : COPY.fullscreen}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={COPY.close}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper text-ink/60 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
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
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>

      {lock && (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-plum px-4 py-2.5 text-xs text-paper"
        >
          <span className="font-bold">{COPY.lock}</span>
          <button
            type="button"
            onClick={() =>
              window.dispatchEvent(new CustomEvent("lab:open-credit-wall"))
            }
            className="rounded-full bg-paper px-3 py-1 text-xs font-extrabold text-plum transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
          >
            {COPY.addCredit}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2.5">
        <div role="group" aria-label="تب لایبریری" className="flex gap-1.5">
          {(["all", "mine"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
              className={tab === value ? CHIP_ACTIVE : CHIP_IDLE}
            >
              {value === "all" ? COPY.tabAll : COPY.tabMine}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="relative shrink-0 px-4 pb-2.5">
        <svg
          aria-hidden
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="pointer-events-none absolute start-7 top-1/2 -translate-y-1/2 text-ink/40"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          value={qInput}
          onChange={(event) => setQInput(event.target.value)}
          placeholder={COPY.search}
          aria-label="جست‌وجو در طرح‌ها"
          className="h-9 w-full rounded-full border border-line bg-paper ps-10 pe-3 text-xs text-ink outline-none transition placeholder:text-ink/40 focus:border-plum/50"
        />
      </div>

      {/* Category chips */}
      <div
        role="group"
        aria-label="فیلتر دسته‌ها"
        className="flex shrink-0 flex-wrap gap-1.5 px-4 pb-3"
      >
        <button
          type="button"
          onClick={() => setCategory(null)}
          aria-pressed={category === null}
          className={category === null ? CHIP_ACTIVE : CHIP_IDLE}
        >
          {COPY.allCategories}
        </button>
        {CATEGORIES.map((item) => (
          <button
            key={item.slug}
            type="button"
            onClick={() => setCategory(category === item.slug ? null : item.slug)}
            aria-pressed={category === item.slug}
            className={category === item.slug ? CHIP_ACTIVE : CHIP_IDLE}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Upload zone — «مال من» only (issue 08 rules copy) */}
      {tab === "mine" && (
        <div className="mx-4 mb-3 shrink-0 rounded-xl border border-dashed border-line bg-cream p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-full border border-plum/50 bg-paper px-3.5 py-1.5 text-xs font-bold text-plum transition hover:bg-plum hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-plum"
                />
              ) : (
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
                  <path d="M12 16V4m0 0 4 4m-4-4-4 4" />
                  <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
                </svg>
              )}
              {uploading ? COPY.uploading : COPY.upload}
            </button>
            <p className="text-[11px] font-bold text-ink/55">
              {COPY.uploadRules}
            </p>
          </div>
          {uploadMsg && (
            <p role="alert" className="mt-1.5 text-[11px] font-bold text-plum">
              {uploadMsg}
            </p>
          )}
          <p className="mt-1.5 text-[11px] leading-5 text-ink/45">
            {COPY.uploadHint}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
            className="hidden"
            aria-hidden
            tabIndex={-1}
          />
        </div>
      )}

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        {loading ? (
          <div className={gridCls} aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div
                key={index}
                className="aspect-square animate-pulse rounded-xl bg-cream"
              />
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
            <p className="text-xs font-bold text-plum">{error}</p>
            <button type="button" onClick={() => setNonce((n) => n + 1)} className={CHIP_IDLE}>
              {COPY.retry}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
            <svg
              aria-hidden
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink/25"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <path d="M17.5 14v7M14 17.5h7" />
            </svg>
            <p className="max-w-[32ch] text-xs leading-6 text-ink/55">
              {emptyText}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2.5 text-[11px] font-bold text-ink/45">
              {fa(items.length)} {COPY.countSuffix}
            </p>
            <div className={gridCls}>
              {items.map((item) => (
                <article
                  key={item.id}
                  className="group relative overflow-hidden rounded-xl border border-line bg-cream"
                >
                  <button
                    type="button"
                    onClick={() => setSelected(item)}
                    aria-label={`نمای کامل ${item.title}`}
                    className="block w-full focus-visible:outline-2 focus-visible:outline-plum"
                  >
                    <img
                      src={item.url}
                      alt={item.title}
                      loading="lazy"
                      className="aspect-square w-full object-cover"
                    />
                  </button>
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/75 via-ink/30 to-transparent px-2.5 pb-2 pt-8">
                    <p className="truncate text-xs font-extrabold text-paper">
                      {item.title}
                    </p>
                    <span className="text-[10px] text-paper/80">
                      {item.categoryLabel ?? KIND_LABELS[item.kind] ?? ""}
                    </span>
                  </div>
                  <div className="pointer-events-none absolute inset-0 flex items-end justify-center bg-ink/35 p-3 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => addToChat(item)}
                      className="pointer-events-auto rounded-full bg-paper px-3.5 py-2 text-xs font-extrabold text-plum shadow transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper"
                    >
                      {COPY.addToChat}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );

  return (
    <>
      {mode === "drawer" ? (
        <div className="fixed inset-0 z-50" role="presentation">
          <div
            aria-hidden
            className="absolute inset-0 bg-ink/40"
            onClick={onClose}
          />
          <aside
            ref={containerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="لایبریری طرح‌ها"
            className="absolute inset-y-0 start-0 flex w-[440px] max-w-[92vw] flex-col border-e border-line bg-paper shadow-2xl outline-none focus-visible:outline-2 focus-visible:outline-plum"
          >
            {panel}
          </aside>
        </div>
      ) : (
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label="لایبریری طرح‌ها — نمای کامل"
          className="fixed inset-0 z-50 flex flex-col bg-paper outline-none focus-visible:outline-2 focus-visible:outline-plum"
        >
          {panel}
        </div>
      )}

      {/* Detail view — «افزودن به چت» always visible (issue 08). */}
      {selected && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={selected.title}
          onClick={() => setSelected(null)}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 p-4"
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-2xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <h3 className="truncate text-sm font-extrabold text-plum">
                  {selected.title}
                </h3>
                <span className="shrink-0 rounded-full border border-line bg-cream px-2.5 py-0.5 text-[11px] font-bold text-ink/60">
                  {selected.categoryLabel ??
                    KIND_LABELS[selected.kind] ??
                    "طرح"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="بستن نمای طرح"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-cream text-ink/60 transition hover:border-plum/40 hover:text-plum focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
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
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <img
                src={selected.url}
                alt={selected.title}
                className="max-h-[52dvh] w-full bg-cream object-contain"
              />
              {selected.description && (
                <p className="px-4 py-3 text-sm leading-7 text-ink/80">
                  {selected.description}
                </p>
              )}
            </div>
            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
              <p className="text-[11px] text-ink/50">{COPY.detailHint}</p>
              <button
                type="button"
                onClick={() => addToChat(selected)}
                className="rounded-full bg-plum px-4 py-2 text-xs font-extrabold text-paper transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
              >
                {COPY.addToChat}
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
