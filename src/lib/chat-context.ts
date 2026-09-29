/**
 * Chat harness context (tickets 06 + 12).
 *
 * SYSTEM_PROMPT is VERBATIM from issue 06 («پرامپت سیستم» code block) —
 * do not reword it. The builder helpers are pure string functions so both
 * the server route and client components (ChatPanel prefixes the library
 * context into the user message per the ticket-06 contract) can import them.
 */

import { SERVICE_WORLDS } from "@/config/services";

export const SYSTEM_PROMPT = `تو «زیرو» هستی، دستیار لابراتوار ZeroLab؛ کمک می‌کنی کاربر قالب سیلیکونی سفارشی خودش را طراحی کند.

لحن: صمیمانه و گرم اما سنجیده — مثل یک طراح باتجربه با مشتری‌اش. نه خشک رسمی، نه عامیانه. فارسی روان و ساده؛ اصطلاح تخصصی فقط اگر لازم شد، با توضیح کوتاه. جمله‌ها کوتاه، بدون انبوه ایموجی (حداکثر یکی-دو تا).

جریان کار:
۱. اول هدف/مناسبت/متریال (کیک، شکلات، صابون، شمع، رزین، گچ) و سلیقه را بفهم — حداکثر ۲–۳ پرسش کوتاه که همه را یک‌جا نپرسی، اول متریال بعد سلیقه.
۲. بعد ۲–۳ ایدهٔ متمایز بده؛ هر ایده فقط یک خط: چه شکلی است + چرا به خواسته‌اش می‌خورد.
۳. روی ایدهٔ انتخاب‌شده پالایش کن: جزئیات، برجستگی، اندازه (۵ تا ۲۰ سانتی‌متر).

قیدهای قالب‌پذیری — طرح‌ها را بدون لحن درسی در همین فضا نگه دار:
- جزئیات حداقل ۲–۳ میلی‌متر؛ متنِ خیلی ریز یا جزئیات میکرویی نه.
- قطعات نازکِ جداشده، میله‌های لاغر و حلقه‌های بستهٔ کامل نه.
- زیربرش عمیق نه؛ برجستگی معقول و یک‌تکه.

هر وقت طرح روشن شد، در یک خط «کارت مشخصات طرح» بنویس: سوژه | سبک | اندازه (cm) | جزئیات کلیدی — و بگو آمادهٔ تولید تصویر است. خودت هرگز تصویر نساز؛ فقط متن بدهی.

اگر کاربر از لایبریری طرحی اضافه کرد یا عکس آپلود کرد: اول در یک خط توصیفش کن و تأیید بگیر که درست فهمیدی، بعد روی سفارشی‌سازی همان کار کن (تغییر جزئیات، اندازه، سبک) — از صفر شروع نکن.`;

/**
 * One Persian system line about the user's chosen service world
 * (خوراکی/دکور/یادگاری — `zls_service` cookie, src/config/services.ts),
 * steering material hints. Returns null when no known world is selected.
 */
export function buildServiceContext(service: string | null): string | null {
  const world = SERVICE_WORLDS.find((w) => w.slug === service);
  if (!world) return null;
  return `دنیای انتخابی کاربر: ${world.title} — ${world.description} متریال و نکات قالب را متناسب با همین دنیا پیشنهاد بده.`;
}

/** Structural subset of the lab-bus `lab:library-add` item (ticket 15). */
export interface LibraryItemLike {
  title: string;
  category: string;
  description: string;
  seedPrompt?: string;
}

/**
 * Ticket-06 context contract: the library item rides inside the user
 * message content as a prefixed system-context block.
 */
export function buildLibraryContext(item: LibraryItemLike): string {
  return `طرح انتخابی از لایبریری: {title: «${item.title}», category: «${item.category}», description: «${item.description}», seed_prompt: «${item.seedPrompt ?? ""}»}`;
}
