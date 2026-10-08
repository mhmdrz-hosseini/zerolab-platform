"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { buildLibraryContext } from "@/lib/chat-context";
import { extractBrief, hasSpecCard, type BriefMessage } from "@/lib/chat-brief";
import {
  emitLabEvent,
  onLabEvent,
  refreshQuotaUI,
  type LabBusEventMap,
} from "@/lib/lab-bus";

/**
 * Chat region of the lab shell — ticket 12 wiring.
 *
 * POSTs the transcript to /api/chat and renders the SSE stream
 * (`data: {"delta":"…"}` lines + `data: [DONE]`) with a smooth typewriter
 * into the last assistant bubble. Owns: RTL bubbles, suggestion chips,
 * the «تولید تصویر» button (`lab:generate-image`), the library-add chip
 * (`lab:library-add`), the remaining-chat counter, the 20% warning and the
 * 402 credit wall (`lab:open-credit-wall` for ticket 16).
 * The lab shell renders <ChatPanel /> as-is.
 */

type LibraryAddItem = LabBusEventMap["lab:library-add"]["item"];

interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  /** UI-only messages (welcome line, library chips) never reach the API. */
  kind?: "welcome" | "chip";
  /** Content sent to the API when it differs from the visible text. */
  wireContent?: string;
  /** Reference image (library pick) shown in the bubble and sent to the API. */
  imageUrl?: string;
  /** Upstream/stream failed — offers a retry. */
  failed?: boolean;
}

/** Multimodal wire format — mirrors what /api/chat accepts. */
type WirePart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type PayloadMessage = {
  role: "assistant" | "user";
  content: string | WirePart[];
};

interface QuotaShape {
  chat: { used: number; total: number };
  image: { used: number; total: number };
  threed: { used: number; total: number };
  paid: number;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  kind: "welcome",
  content:
    "سلام! من زیروام، همکار طراحی‌تون تو لابراتوار ZeroLab. 🎨 بگین ببینم: برای چه کاری قالب می‌خواین؟ کیک و شکلات؟ شمع؟ صابون؟",
};

/** Suggestion chips — verbatim list from issue 06. */
const SUGGESTIONS = [
  "قالب شکلات لوکس برای هدیه",
  "مولد فوندانت با نقش اسلیمی",
  "قالب شمع مجسمه‌ای برای دکور",
  "قالب رزین گوشوارهٔ مینیمال",
  "قالب صابون با طرح گل",
  "یادگاری دست و پای نوزاد",
] as const;

const NO_IDEA_HINT = "اول ایده‌ات را با زیرو جا بنداز";
const LOW_QUOTA_TEXT = "اعتبار رایگان شما رو به اتمام است";
const WALL_TEXT = "اعتبار رایگان چت تمام شده";

const fa = (value: number) => new Intl.NumberFormat("fa-IR").format(value);

const rid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [quota, setQuota] = useState<QuotaShape | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  /** Mirror of `messages` so submit/retry can build payloads synchronously. */
  const messagesRef = useRef(messages);
  const chatIdRef = useRef<string | null>(null);
  const pendingLibRef = useRef<LibraryAddItem | null>(null);
  /** Last request payload — used by the retry button. */
  const payloadRef = useRef<PayloadMessage[] | null>(null);

  // Typewriter state: full received text vs. rendered prefix.
  const targetRef = useRef("");
  const shownRef = useRef(0);
  const doneRef = useRef(false);
  const erroredRef = useRef(false);
  const typerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  // Auto-grow textarea (up to max-h-36).
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
  }, [draft]);

  // Clear timers/streams on unmount.
  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (typerRef.current) clearInterval(typerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    },
    [],
  );

  const loadQuota = useCallback(async () => {
    try {
      const res = await fetch("/api/quota", { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as QuotaShape;
      setQuota(next);
      if (next.chat.total - next.chat.used > 0 || next.paid > 0) {
        setExhausted(false);
      }
    } catch {
      // The counter is cosmetic; never break the chat over it.
    }
  }, []);

  useEffect(() => {
    void loadQuota();
    const refresh = () => void loadQuota();
    window.addEventListener("zl:quota-changed", refresh);
    return () => window.removeEventListener("zl:quota-changed", refresh);
  }, [loadQuota]);

  // Ticket 15 → 12: an item added to the chat shows as a chip (with its
  // thumbnail) and rides — prefixed context line + attached image — into the
  // next user message, so the model sees and adjusts that exact design.
  useEffect(
    () =>
      onLabEvent("lab:library-add", (detail) => {
        pendingLibRef.current = detail.item;
        setMessages((prev) => [
          ...prev,
          {
            id: rid(),
            role: "user",
            kind: "chip",
            imageUrl: detail.item.url,
            content: `طرح از لایبریری اضافه شد: ${detail.item.title}`,
          },
        ]);
      }),
    [],
  );

  // History (2026-10-05): resume a past chat — swap the transcript in and
  // adopt its chat id so the next send continues the same conversation.
  useEffect(
    () =>
      onLabEvent("lab:restore-chat", ({ chatId }) => {
        void (async () => {
          const res = await fetch(`/api/history/chats/${chatId}`, { cache: "no-store" });
          if (!res.ok) return;
          const data = (await res.json()) as {
            id: string;
            messages: Array<{
              role: "user" | "assistant";
              content: string;
              imageUrl?: string | null;
            }>;
          };
          chatIdRef.current = data.id;
          setHint(null);
          setMessages(
            data.messages.length > 0
              ? data.messages.map((m, i) => ({
                  id: `h${i}`,
                  role: m.role,
                  content: m.content,
                  ...(m.imageUrl ? { imageUrl: m.imageUrl } : {}),
                }))
              : [WELCOME],
          );
        })();
      }),
    [],
  );

  function stopTyper() {
    if (typerRef.current) {
      clearInterval(typerRef.current);
      typerRef.current = null;
    }
  }

  /** Renders the streamed text in small adaptive steps for a typed feel. */
  function startTyper(assistantId: string) {
    if (typerRef.current) return;
    typerRef.current = setInterval(() => {
      const target = targetRef.current;
      const shown = shownRef.current;
      if (shown < target.length) {
        const step = Math.max(2, Math.ceil((target.length - shown) / 6));
        shownRef.current = Math.min(target.length, shown + step);
        const visible = target.slice(0, shownRef.current);
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: visible } : m)),
        );
        return;
      }
      if (doneRef.current) finalize(assistantId);
    }, 30);
  }

  function finalize(assistantId: string) {
    stopTyper();
    setStreaming(false);
    if (erroredRef.current || targetRef.current.length === 0) {
      // Keep any partial text, flag the bubble and offer a retry.
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, failed: true } : m)),
      );
      return;
    }
    refreshQuotaUI();
  }

  async function runTurn(payload: PayloadMessage[], assistantId: string) {
    payloadRef.current = payload;
    targetRef.current = "";
    shownRef.current = 0;
    doneRef.current = false;
    erroredRef.current = false;
    setStreaming(true);
    startTyper(assistantId);

    let chatId = chatIdRef.current;
    if (!chatId) {
      chatId = rid();
      chatIdRef.current = chatId;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, messages: payload }),
        signal: controller.signal,
      });

      if (res.status === 402) {
        // Free chat quota spent — keep the chat open, show the wall banner.
        setExhausted(true);
        void loadQuota();
        stopTyper();
        setStreaming(false);
        setMessages((prev) => prev.filter((m) => m.id !== assistantId));
        return;
      }
      if (!res.ok || !res.body) throw new Error(`chat_failed_${res.status}`);

      // SSE: `data: {"delta":"…"}` lines terminated by `data: [DONE]`.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawDone = false;
      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            const data = line.startsWith("data:") ? line.slice(5).trim() : "";
            if (!data) continue;
            if (data === "[DONE]") {
              sawDone = true;
              break;
            }
            try {
              const parsed = JSON.parse(data) as { delta?: unknown };
              if (typeof parsed.delta === "string" && parsed.delta) {
                targetRef.current += parsed.delta;
              }
            } catch {
              // Tolerate a malformed line instead of killing the stream.
            }
          }
        }
      }
      doneRef.current = true; // typer drains, then finalizes
    } catch {
      doneRef.current = true;
      erroredRef.current = true;
    }
  }

  /** Wire form of a message: text, or text + attached reference image. */
  function toWire(m: ChatMessage): PayloadMessage {
    const text = m.wireContent ?? m.content;
    return m.imageUrl
      ? {
          role: m.role,
          content: [
            { type: "text", text },
            { type: "image_url", image_url: { url: m.imageUrl } },
          ],
        }
      : { role: m.role, content: text };
  }

  function submit(override?: string) {
    const text = (override ?? draft).trim();
    if (!text || streaming) return;

    const lib = pendingLibRef.current;
    pendingLibRef.current = null;
    const wireText = lib
      ? `${buildLibraryContext(lib, { withImage: true })}\n\n${text}`
      : text;

    const userMessage: ChatMessage = {
      id: rid(),
      role: "user",
      content: text,
      ...(lib ? { wireContent: wireText, imageUrl: lib.url } : {}),
    };

    const payload: PayloadMessage[] = messagesRef.current
      .filter((m) => !m.kind && !m.failed)
      .map(toWire);
    payload.push(toWire(userMessage));

    const assistantId = rid();
    setMessages((prev) => [
      ...prev.filter((m) => !m.failed), // drop stale error bubbles
      userMessage,
      { id: assistantId, role: "assistant", content: "" },
    ]);
    setDraft("");
    void runTurn(payload, assistantId);
  }

  function retry() {
    const payload = payloadRef.current;
    if (!payload || streaming) return;
    const failed = [...messagesRef.current].reverse().find((m) => m.failed);
    if (!failed) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === failed.id ? { ...m, content: "", failed: false } : m,
      ),
    );
    void runTurn(payload, failed.id);
  }

  function showHint(text: string) {
    setHint(text);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => setHint(null), 4000);
  }

  function realBriefMessages(): BriefMessage[] {
    return messagesRef.current
      .filter((m) => !m.kind && !m.failed)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  function generateImage() {
    if (streaming) return;
    const brief = extractBrief(realBriefMessages());
    if (!brief) {
      showHint(NO_IDEA_HINT);
      return;
    }
    emitLabEvent("lab:generate-image", {
      brief,
      chatId: chatIdRef.current ?? undefined,
    });
  }

  function openCreditWall() {
    window.dispatchEvent(new CustomEvent("lab:open-credit-wall"));
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  const hasUserTurn = messages.some(
    (m) => m.role === "user" && m.kind !== "chip",
  );
  const briefReady = useMemo(
    () =>
      hasSpecCard(
        messages
          .filter((m) => !m.kind && !m.failed)
          .map(({ role, content }) => ({ role, content })),
      ),
    [messages],
  );
  const showSuggestions = messages.every((m) => m.kind === "welcome");

  const chatFreeRemaining = quota
    ? Math.max(0, quota.chat.total - quota.chat.used)
    : null;
  const paid = quota?.paid ?? 0;
  const lowQuota =
    chatFreeRemaining !== null &&
    quota !== null &&
    chatFreeRemaining > 0 &&
    chatFreeRemaining <= Math.ceil(quota.chat.total * 0.2);
  const showWall =
    exhausted || (quota !== null && chatFreeRemaining === 0 && paid === 0);

  return (
    <section
      aria-label="چت با زیرو"
      className="flex min-h-0 flex-1 flex-col bg-cream"
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
        <span
          aria-hidden
          className="flex h-9 w-9 items-center justify-center rounded-full bg-plum text-sm font-black text-paper"
        >
          ز
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-extrabold text-plum">زیرو</span>
          <span className="text-[11px] text-ink/55">
            دستیار ایده‌پردازی لابراتوار
          </span>
        </div>
      </header>

      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="flex flex-col gap-3">
          {messages.map((message, index) => (
            <Bubble
              key={message.id}
              message={message}
              typing={
                streaming &&
                message.role === "assistant" &&
                message.content === "" &&
                !message.failed &&
                index === messages.length - 1
              }
              onRetry={retry}
            />
          ))}
        </div>

        {showSuggestions && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-bold text-ink/50">
              برای شروع، یکی از این‌ها را بزن:
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={streaming}
                  onClick={() => submit(suggestion)}
                  className="rounded-full border border-line bg-paper px-3 py-1.5 text-xs text-ink/80 transition hover:border-plum/40 hover:text-plum disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {hint && (
        <p className="shrink-0 px-4 pb-1 text-[11px] font-bold text-plum">
          {hint}
        </p>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5">
        <button
          type="button"
          onClick={generateImage}
          disabled={streaming || !hasUserTurn}
          title="ارسال مشخصات طرح به گام تولید تصویر"
          className={
            briefReady
              ? "inline-flex items-center gap-1.5 rounded-full border border-teal bg-teal px-3.5 py-1.5 text-xs font-bold text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              : "inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-1.5 text-xs font-bold text-ink/80 transition hover:border-plum/40 hover:text-plum disabled:cursor-not-allowed disabled:opacity-40"
          }
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
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          </svg>
          تولید تصویر
        </button>

        {chatFreeRemaining !== null && (
          <span
            title="پیام‌های رایگان باقی‌مانده"
            className="text-[11px] font-bold text-ink/55"
          >
            {fa(chatFreeRemaining)} پیام
            {paid > 0 && <span className="text-teal"> +{fa(paid)}</span>}
          </span>
        )}
      </div>

      {showWall ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-cream px-3 py-2">
          <span className="text-xs font-bold text-plum">{WALL_TEXT}</span>
          <button
            type="button"
            onClick={openCreditWall}
            className="rounded-full bg-plum px-3 py-1.5 text-xs font-bold text-paper transition hover:opacity-90"
          >
            افزودن اعتبار
          </button>
        </div>
      ) : (
        lowQuota && (
          <p className="shrink-0 px-4 pb-1 text-[11px] font-bold text-accent">
            {LOW_QUOTA_TEXT}
          </p>
        )
      )}

      <form
        onSubmit={onSubmit}
        className="flex shrink-0 items-end gap-2 border-t border-line p-3"
      >
        <textarea
          ref={taRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="ایده‌ات را بنویس…"
          aria-label="پیام به زیرو"
          className="max-h-36 min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-line bg-paper px-4 py-2.5 text-sm leading-6 text-ink outline-none transition placeholder:text-ink/40 focus:border-plum/50"
        />
        <button
          type="submit"
          disabled={!draft.trim() || streaming}
          className="h-11 shrink-0 rounded-full bg-plum px-5 text-sm font-bold text-paper transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {streaming ? "…" : "ارسال"}
        </button>
      </form>
    </section>
  );
}

function Bubble({
  message,
  typing,
  onRetry,
}: {
  message: ChatMessage;
  typing: boolean;
  onRetry: () => void;
}) {
  if (message.kind === "chip") {
    return (
      <span className="mx-auto flex max-w-[95%] items-center gap-2 rounded-full border border-line bg-paper py-1 pe-3 ps-1 text-center text-[11px] font-bold text-ink/70">
        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt=""
            loading="lazy"
            className="h-7 w-7 shrink-0 rounded-full object-cover"
          />
        )}
        <span className="min-w-0 truncate">{message.content}</span>
      </span>
    );
  }

  if (message.role === "user") {
    return (
      <div className="flex max-w-[85%] flex-col items-end gap-1.5 self-end">
        {message.imageUrl && (
          <img
            src={message.imageUrl}
            alt="تصویر مرجع طرح"
            loading="lazy"
            className="max-h-44 w-auto max-w-full rounded-xl border-2 border-plum/60 bg-cream object-cover"
          />
        )}
        <p className="whitespace-pre-wrap rounded-2xl bg-plum px-4 py-2.5 text-sm leading-7 text-paper">
          {message.content}
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-[90%] flex-col items-start gap-1.5 self-start">
      {message.content !== "" && (
        <div className="whitespace-pre-wrap rounded-2xl border border-line bg-paper px-4 py-2.5 text-sm leading-7 text-ink">
          {message.content}
        </div>
      )}
      {typing && <TypingDots />}
      {message.failed && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-plum">
            پیام ارسال نشد.
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full border border-plum/50 px-2.5 py-0.5 text-[11px] font-bold text-plum transition hover:bg-plum hover:text-paper"
          >
            تلاش دوباره
          </button>
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <span
      aria-label="زیرو در حال نوشتن است"
      className="inline-flex items-center gap-1 px-1 py-2"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/40"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}
