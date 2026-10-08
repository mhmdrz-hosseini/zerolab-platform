"use client";

import { useCallback, useEffect, useState } from "react";
import { emitLabEvent, onLabEvent } from "@/lib/lab-bus";

/**
 * Session history drawer (2026-10-05): lists this session's past chats and
 * generated images from Postgres (cursor-paginated via /api/history). A chat
 * click restores its transcript into the ChatPanel (`lab:restore-chat`); an
 * image click offers «ساخت سه‌بعدی» (`lab:make-3d`) and full-size open.
 */

const COPY = {
  title: "تاریخچه جلسه",
  chats: "گفتگوها",
  images: "تصاویر",
  emptyChats: "هنوز گفتگویی ثبت نشده.",
  emptyImages: "هنوز تصویری ساخته نشده.",
  restore: "ادامه گفتگو",
  make3d: "ساخت سه‌بعدی",
  loadMore: "بیشتر",
  close: "بستن",
  messages: "پیام",
} as const;

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

interface ChatRow {
  id: string;
  service: string;
  createdAt: string;
  messageCount: number;
  excerpt: string;
}

interface ImageRow {
  id: string;
  kind: string;
  url: string;
  createdAt: string;
}

const faDate = (iso: string) =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"chats" | "images">("chats");
  const [chats_, setChats] = useState<ChatRow[]>([]);
  const [images_, setImages] = useState<ImageRow[]>([]);
  const [chatsCursor, setChatsCursor] = useState<string | null>(null);
  const [imagesCursor, setImagesCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (which: "chats" | "images", cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ type: which, limit: "20" });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/history?${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = (await res.json()) as { items: ChatRow[] & ImageRow[]; nextCursor: string | null };
      if (which === "chats") {
        setChats((prev) => (cursor ? [...prev, ...(data.items as ChatRow[])] : (data.items as ChatRow[])));
        setChatsCursor(data.nextCursor);
      } else {
        setImages((prev) => (cursor ? [...prev, ...(data.items as ImageRow[])] : (data.items as ImageRow[])));
        setImagesCursor(data.nextCursor);
      }
    } catch {
      setError("دریافت تاریخچه ناموفق بود.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the drawer opens (fresh data per open).
  useEffect(() => {
    if (!open) return;
    setChats([]);
    setImages([]);
    setChatsCursor(null);
    setImagesCursor(null);
    void load("chats", null);
    void load("images", null);
  }, [open, load]);

  if (!open) return null;

  const restoreChat = (chatId: string) => {
    emitLabEvent("lab:restore-chat", { chatId });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={COPY.title}>
      <button type="button" aria-label={COPY.close} onClick={onClose} className="flex-1 bg-ink/40 backdrop-blur-[2px]" />
      <aside className="flex h-full w-full max-w-md flex-col border-l border-line bg-paper shadow-2xl">
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-black text-ink">{COPY.title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-2.5 py-1 text-xs text-muted transition hover:border-plum/40 hover:text-plum"
          >
            ✕
          </button>
        </header>

        <div className="flex gap-2 border-b border-line px-4 py-2">
          {(["chats", "images"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                tab === t ? "bg-plum text-paper" : "border border-line bg-cream text-ink hover:border-plum/40"
              }`}
            >
              {t === "chats" ? COPY.chats : COPY.images}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && <p className="mb-3 text-xs font-bold text-red-600">{error}</p>}

          {tab === "chats" && (
            <ul className="space-y-2">
              {chats_.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => restoreChat(c.id)}
                    className="w-full rounded-2xl border border-line bg-cream px-3 py-2.5 text-right transition hover:border-plum/50"
                  >
                    <p className="line-clamp-2 text-xs font-bold leading-5 text-ink">
                      {c.excerpt || "گفتگوی بدون پیام"}
                    </p>
                    <p className="mt-1 text-[10px] text-muted">
                      {faDate(c.createdAt)} · {fa(c.messageCount)} {COPY.messages}
                    </p>
                  </button>
                </li>
              ))}
              {chats_.length === 0 && !loading && (
                <li className="py-8 text-center text-xs text-muted">{COPY.emptyChats}</li>
              )}
            </ul>
          )}

          {tab === "images" && (
            <div className="grid grid-cols-3 gap-2">
              {images_.map((im) => (
                <div key={im.id} className="group relative overflow-hidden rounded-xl border border-line bg-cream">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                  <div className="absolute inset-x-0 bottom-0 flex translate-y-full gap-1 bg-ink/70 p-1 transition group-hover:translate-y-0">
                    <a
                      href={im.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 rounded-md bg-paper/90 px-1 py-0.5 text-center text-[10px] font-bold text-ink"
                    >
                      تمام‌صفحه
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        emitLabEvent("lab:make-3d", { imageId: im.id, url: im.url });
                        onClose();
                      }}
                      className="flex-1 rounded-md bg-plum px-1 py-0.5 text-[10px] font-bold text-paper"
                    >
                      سه‌بعدی
                    </button>
                  </div>
                </div>
              ))}
              {images_.length === 0 && !loading && (
                <p className="col-span-3 py-8 text-center text-xs text-muted">{COPY.emptyImages}</p>
              )}
            </div>
          )}

          {loading && <p className="py-4 text-center text-xs text-muted">…</p>}

          {tab === "chats" && chatsCursor && !loading && (
            <button
              type="button"
              onClick={() => void load("chats", chatsCursor)}
              className="mx-auto mt-3 block rounded-full border border-line bg-cream px-4 py-1.5 text-xs font-bold text-ink hover:border-plum/40"
            >
              {COPY.loadMore}
            </button>
          )}
          {tab === "images" && imagesCursor && !loading && (
            <button
              type="button"
              onClick={() => void load("images", imagesCursor)}
              className="mx-auto mt-3 block rounded-full border border-line bg-cream px-4 py-1.5 text-xs font-bold text-ink hover:border-plum/40"
            >
              {COPY.loadMore}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Top-bar entry: button + drawer state (mirrors LibraryButton). */
export function HistoryButton() {
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
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <path d="M12 7v5l4 2" />
        </svg>
        تاریخچه
      </button>
      <HistoryDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
