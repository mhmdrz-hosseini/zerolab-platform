/**
 * Service-world taxonomy for the selection page (issue 03, «تاکسونومی» a).
 * The user first answers «با چه چیزی پر می‌کنی؟» — the choice decides
 * food-grade material in later prompts and is persisted on the
 * `zls_service` cookie (see /api/session/service).
 */

export type ServiceSlug = "edible" | "decor" | "keepsake";

export interface ServiceWorld {
  slug: ServiceSlug;
  title: string;
  /** Small Persian micro-label shown at the top of the card. */
  badge: string;
  /** One-line description — verbatim from the issue-03 taxonomy. */
  description: string;
  /** 2–3 example use-cases shown on the card. */
  examples: string[];
}

export const SERVICE_WORLDS: ServiceWorld[] = [
  {
    slug: "edible",
    title: "خوراکی",
    badge: "سیلیکون پلاتینی · فودگرید",
    description: "برای شکلات، فوندانت، ایزومالت و کوکی — قالبی که با غذا تماس دارد.",
    examples: [
      "قالب شکلات لوکس برای هدیه",
      "مولد فوندانت با نقش اسلیمی",
      "مُهر کوکی با حروف فارسی",
    ],
  },
  {
    slug: "decor",
    title: "دکور و هنر دست‌ساز",
    badge: "رزین · شمع · صابون · گچ",
    description: "برای رزین، شمع، صابون، گچ و بتن — آزادی کامل در فرم و اندازه.",
    examples: [
      "قالب شمع مجسمه‌ای برای دکور",
      "گوشوارهٔ رزین مینیمال",
      "جاشمعی گچی هندسی",
    ],
  },
  {
    slug: "keepsake",
    title: "یادگاری و سفارشی",
    badge: "هدیهٔ شخصی‌سازی‌شده",
    description: "دست و پای نوزاد، پنجه و هدیهٔ شخصی‌سازی‌شده.",
    examples: [
      "یادگاری دست و پای نوزاد",
      "قلب با اسم و تاریخ",
      "یادبود پنجهٔ حیوان خانگی",
    ],
  },
];

/** Announced-but-disabled future service (non-clickable on the picker). */
export const UPCOMING_SERVICE = {
  title: "کاتر کوکی",
  badge: "به‌زودی",
  description: "کاتر و مُهر کوکی با طرح دلخواه تو.",
} as const;

export const SERVICE_COOKIE = "zls_service";

export function isServiceSlug(value: unknown): value is ServiceSlug {
  return value === "edible" || value === "decor" || value === "keepsake";
}

export function serviceTitle(slug: string | undefined): string | undefined {
  return SERVICE_WORLDS.find((w) => w.slug === slug)?.title;
}
