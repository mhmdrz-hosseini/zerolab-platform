#!/usr/bin/env node
/**
 * Luchina (VK market, public210914331) catalog importer.
 *
 * Reads .scratch/vk/products.json (crawled from m.vk.ru market collections
 * via browser) and POSTs each product to POST /api/library/import as a public
 * library seed. Re-runs are idempotent (dedupe by meta.source.handle = VK
 * product id).
 *
 * Luchina | Лучина is a Russian silicone-mold brand for CANDLE making
 * (столовые свечи, мелтс/wax melts, арома саше). Category rules:
 * - box/tray/stand/candlestick/panel/planter molds (шкатулка, поднос, лоток,
 *   подставка, подсвечник, панно, кашпо) → plaster (casting decor)
 * - everything else (candles, wax melts, sachets, figurines, flowers…) →
 *   candle.
 *
 * Titles are Russian → translated to Persian via a word-level dictionary;
 * untranslated motifs fall back to «کالکشن <album>» naming (never Latin).
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/vk/products.json";
const MATERIAL_CANDLE = "موم صیقلی با جزئیات واضح";
const MATERIAL_PLASTER = "پودر سنگ با سطح مات و لبه‌های تمیز";

/** Collection (album) names → Persian, for fallback titles + descriptions. */
const ALBUM_FA = {
  "Рождество": "کریسمس", "CHRONOS RELIC": "کرونوس رلیک", "Гранаты": "انار",
  "Лесные реликвии": "یادگارهای جنگل", "Наследие природы": "میراث طبیعت",
  "Винтаж": "وینتیج", "Гортензия": "هورتنیا", "Щелкунчик": "شکلات‌شکن",
  "Эстель": "استل", "Амариллис": "آماریلیس", "Сирень": "یاس زنگی",
  "Пионы": "پیونی‌ها", "Цветение": "شکوفایی", "Эхо эпохи": "پژواک دوران",
  "Свет венца": "نور تاج", "Русская весна": "بهار روسی", "Моя весна": "بهار من",
  "Моя Античность": "عهد باستان من", "Вербы": "بیدها", "Рококо": "روکوکو",
  "Хюгге": "هیگه", "Масленица": "ماسلنیتسا", "Ласточки": "پرستوها",
  "Лошади": "اسب‌ها", "Шишки": "دانه‌های کاج", "Ёлочки": "درخت‌های کریسمس",
  "Насекомые": "حشرات", "Посейдон": "پوزئیدون", "Колоски": "خوشه‌های گندم",
  "Драконы": "اژدهاها", "Мелтсы": "ملت‌های موم", "Рептилия": "خزندگان",
  "Конусы": "مخروط‌ها", "Птичья любовь": "عشق پرندگان",
  "Пасха в Скандинавии": "عید پاک اسکاندیناوی", "Еда / Овощи": "غذا و سبزیجات",
  "Каменный цветок": "گل سنگی", "Морская черепашка": "لاک‌پشت دریایی",
  "Жемчуг Абалон": "مروارید آبالون", "Лист Гинкго": "برگ گینکگو",
  "Мишкины сказки": "قصه‌های خرس", "Кружево": "گیپور",
  "Елочка Кружево": "درخت کریسمس گیپور", "Лоток для яиц": "سینی تخم‌مرغ",
  "Ласточки и ленты": "پرستو و روبان", "Парфюм-попурри": "ادوکلن و پاپوری",
  "Подносы / Панно": "سینی و تابلو", "Подставки/Подсвечники": "پایه و جاشمعی",
  "Шкатулки / Кашпо": "جعبه و گلدان", "Козочки / барашки": "بزها و بره‌ها",
  "Распродажа": "تخفیف‌ها",
};

const ALBUM_BY_ID = {"90":"Рождество","89":"CHRONOS RELIC","88":"Гранаты","87":"Лесные реликвии","86":"Наследие природы","85":"Винтаж","84":"Гортензия","83":"Щелкунчик","82":"Эстель","81":"Амариллис","80":"Распродажа","79":"Козочки / барашки","78":"Ласточки","77":"Пионы","76":"Лоток для яиц","75":"Ласточки и ленты","74":"Цветение","73":"Эхо эпохи","72":"Свет венца","71":"Масленица","70":"Сирень","69":"Русская весна","68":"Елочка Кружево","67":"Мишкины сказки","66":"Шишки","65":"Лошади","64":"Лист Гинкго","63":"Жемчуг Абалон","61":"Морская черепашка","60":"Каменный цветок","59":"Еда / Овощи","57":"Вербы","56":"Моя Античность","55":"Моя весна","52":"Подставки/Подсвечники","51":"Рептилия","50":"Шкатулки / Кашпо","49":"Насекомые","48":"Посейдон","46":"Колоски","44":"Рококо","43":"Парфюм-попурри","42":"Пасха в Скандинавии","41":"Подносы / Панно","40":"Птичья любовь","39":"Конусы","37":"Драконы","36":"Мелтсы","35":"Хюгге","34":"Ёлочки"};

/** Word-level RU→FA dictionary (keys lowercase, matched with morphology). */
const WORD_FA = {
  "рождество": "کریسمس", "рождественский": "کریسمسی", "вечный": "جاودان",
  "вечное": "جاودان", "хранитель": "نگهبان", "время": "زمان",
  "гранат": "انار", "гранаты": "انار", "лесные": "جنگلی",
  "реликвии": "یادگارها", "наследие": "میراث", "природы": "طبیعت",
  "винтажная": "وینتیج", "винтажный": "وینتیج", "винтажные": "وینتیج",
  "винтаж": "وینتیژ", "елочка": "درخت کریسمس", "елка": "درخت کریسمس",
  "елочки": "درخت کریسمس", "желудь": "بلوط", "шишка": "دانهٔ کاج",
  "коньки": "اسکیت", "принц": "شاهزاده", "эдвард": "ادوارد",
  "мышонок": "موش کوچولو", "мышь": "موش", "теодор": "تئودور",
  "щелкунчик": "شکلات‌شکن", "мария": "ماریا", "марш": "مارش",
  "оловянный": "حصیری", "солдатик": "سرباز", "серая": "خاکستری",
  "империя": "امپراتوری", "пуант": "پوآنت", "античная": "آنتیک",
  "античность": "عهد باستان", "подставка": "پایه", "подставке": "روی پایه",
  "девочка": "دختر", "принцесса": "پرنسس", "барабан": "طبل",
  "балерина": "بالرینا", "мышиный": "موشی", "король": "پادشاه",
  "эстель": "استل", "амариллис": "آماریلیس", "овечка": "گوسفند کوچولو",
  "леди": "لِدی", "гламур": "گلامور", "баран": "قوچ", "оливер": "الیور",
  "оливия": "اُلیویا", "аристократка": "بانوی اشرافی", "барашка": "بره",
  "бараш": "بره", "тофи": "تافی", "цветение": "شکوفایی", "сосо": "سوسو",
  "бант": "پاپیون", "б Banтом": "با پاپیون", "светлая": "روشن",
  "пасха": "عید پاک", "масленица": "ماسلنیتسا", "укроп": "شبت",
  "большой": "بزرگ", "свет": "نور", "любви": "عشق", "кокос": "نارگیل",
  "половинка": "نصف", "осень": "پاییز", "козочка": "بز کوچولو",
  "заря": "سپیدهدم", "белочка": "سنجاب", "желудем": "با بلوط",
  "ежик": "جوجه‌تیغی", "миша": "خرس", "снежинкой": "با دانهٔ برف",
  "снежинка": "دانهٔ برف", "дубовый": "بلوطی", "лист": "برگ",
  "лошадь": "اسب", "олимп": "المپ", "верба": "بید", "вербы": "بید",
  "резной": "منبت‌کاری", "петушок": "خروس کوچولو",
  "подарками": "با هدیه‌ها", "пион": "پیونی", "ласточка": "پرستو",
  "лента": "روبان", "яйцо": "تخم‌مرغ", "яиц": "تخم‌مرغ",
  "эхо": "پژواک", "эпохи": "دوران", "венца": "تاج", "сирень": "یاس",
  "русская": "روسی", "весна": "بهار", "кружево": "گیپور",
  "мишкины": "خرسِ", "сказки": "قصه‌ها", "гинкго": "گینکگو",
  "жемчуг": "مروارید", "абалон": "آبالون", "морская": "دریایی",
  "черепашка": "لاک‌پشت", "каменный": "سنگی", "цветок": "گل",
  "еда": "غذا", "овощи": "سبزیجات", "моя": "من", "рептилия": "خزنده",
  "змея": "مار", "луне": "ماه", "шкатулка": "جعبه", "шкатулки": "جعبه",
  "насекомые": "حشرات", "пчела": "زنبور", "цилиндр": "استوانه",
  "посейдон": "پوزئیدون", "ракушка": "صدف", "ракушки": "صدف",
  "колоски": "خوشه‌های گندم", "колосок": "خوشهٔ گندم", "рококо": "روکوکو",
  "парфюм": "ادوکلن", "попурри": "پاپوری", "скандинавии": "اسکاندیناوی",
  "подносы": "سینی", "птичья": "پرندگان", "любовь": "عشق",
  "конус": "مخروط", "конусы": "مخروط", "эбру": "ابرو", "дракон": "اژدها",
  "драконы": "اژدهاها", "глаз": "چشم", "дракона": "اژدها",
  "мелтсы": "ملت", "хюгге": "هیگه", "старый": "قدیمی",
  "амстердам": "آمستردام", "орех": "گردو", "грецкий": "معمولی",
  "столовых": "میزی", "свечей": "شمع", "свечи": "شمع", "свеча": "شمع",
  "мелтс": "ملت موم", "саше": "ساشه", "арома": "معطر",
  "подсвечник": "جاشمعی", "подсвечники": "جاشمعی", "кашпо": "گلدان",
  "поднос": "سینی", "лоток": "سینی", "панно": "تابلو",
  "ов": "",
  "на": "",
  "столовая": "میزی",
  "столовые": "میزی",
  "Столовые": "میزی",
  "Ласточки": "پرستوها",
  "нашей": "",
  "для": "",
  "Скарлет": "اسکارلت",
  "Курочка": "مرغ کوچولو",
  "Коник": "ملخ",
  "Зайка": "خرگوش کوچولو",
  "Гортензия": "هورتنیا",
  "шт": "",
  "ленты": "روبان",
  "низкая": "کوتاه",
  "высокая": "بلند",
  "высокий": "بلند",
  "мыла": "صابون",
  "круг": "دایره",
  "Лошадка": "اسب کوچولو",
  "в": "",
  "см": "",
  "Вязаный": "بافتنی",
  "#2": "۲",
  "Сердце": "قلب",
  "яйц": "تخم‌مرغ",
  "мини": "مینی",
  "коньками": "با اسکیت",
  "подставочка": "پایه کوچک",
  "Мишка": "خرس",
  "Кедровая": "سرو",
  "S": "",
  "прямоугольник": "مستطیل",
  "Коллекция": "",
  "широкий": "پهن",
  "Текстурный": "بافت‌دار",
  "мандарин": "مندرین",
  "Яичница": "نیمرو",
  "мыло": "صابون",
  "размер": "",
  "Томат": "گوجه",
  "2д": "",
  "конек": "اسب کوچک",
  "брусок": "مستطیل",
  "гладкий": "صاف",
  "Колос": "خوشهٔ گندم",
  "шар": "گوی", "хл": "", "xl": "XL", "xlб": "XL", "и": "و", "с": "", "ы": "", "желудем": "بلوط", "подарками": "هدیه", "№2": "۲", "№3": "۳", "№1": "۱",
};

for (const k of Object.keys(WORD_FA)) { const lk = k.toLowerCase(); if (lk !== k && WORD_FA[lk] === undefined) WORD_FA[lk] = WORD_FA[k]; }

const faDigits = (s) => String(s).replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[d]);

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw);
    if (match) args[match[1]] = match[2] ?? "true";
  }
  return args;
}

function loadSeedSecret() {
  try {
    const lines = readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = /^SEED_SECRET=(.*)$/.exec(line.trim());
      if (match && match[1]) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
  return process.env.SEED_SECRET ?? null;
}

/** Map a raw album heading (from crawl) to a clean collection name. */
function albumClean(head) {
  if (!head) return null;
  let h = head.replace(/Filters.*$/, "").replace(/Коллекция\s+/g, "").replace(/[«»]/g, "").trim();
  h = h.replace(/^«|»$/g, "").trim();
  return h || null;
}

/** Translate a Russian phrase word-by-word; returns {fa, unknown}. */
function translatePhrase(phrase) {
  const words = phrase.replace(/[«»()+,]/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  const unknown = [];
  for (const w of words) {
    const lower = w.toLowerCase().replace(/№/g, "№");
    const hit = WORD_FA[lower] ?? WORD_FA[lower.replace(/(а|я|ы|и|у|ю|е|о)$/,'')];
    if (hit !== undefined && hit !== "") out.push(hit);
    else if (hit === "") continue;
    else if (/^[№\dxl]+$/i.test(w)) out.push(w);
    else unknown.push(w);
  }
  return { fa: out.join(" "), unknown };
}

function buildMeta(item) {
  const raw = item.title.replace(/\s+/g, " ").trim();
  let form = "قالب سیلیکونی";
  let kind = null; // motif-kind prefix like شمع میزی
  let rest = raw
    .replace(/^(Силиконовая форма|Силиконовые формы|Молл|Молд)\s*/i, "")
    .replace(/^(для изготовления|для)\s+/i, "");

  if (/столов[а-я]*\s+свеч/i.test(rest)) {
    kind = "شمع میزی";
    rest = rest.replace(/столов[а-я]*\s+свеч[а-я]*/i, "").trim();
  } else if (/мелтс/i.test(rest)) {
    kind = "ملت موم";
    rest = rest.replace(/мелтс/i, "").trim();
  } else if (/саше/i.test(rest)) {
    kind = "ساشه معطر";
    rest = rest.replace(/(арома\s+)?саше/i, "").trim();
  }
  // objects that change category
  let m = rest.match(/(шкатулк[а-я]*|поднос[а-я]*|лоток[а-я]*|панно|кашпо|подставк[а-я]*|подсвечник[а-я]*)/i);
  let plasterWord = null;
  if (m) {
    plasterWord = m[1].toLowerCase();
    const faObj = { шкатулк: "جعبه", поднос: "سینی", лоток: "سینی", панно: "табلو", кашпо: "گلدان", подставк: "پایه", подсвечник: "جاشمعی" };
    for (const [ru, fa] of Object.entries(faObj)) if (plasterWord.startsWith(ru)) kind = (kind ? kind + " " : "") + fa;
    rest = rest.replace(m[1], "").trim();
  }
  // цилиндр = candle pillar form
  if (/цилиндр/i.test(rest)) {
    kind = (kind ? kind + " " : "") + "استوانه‌ای";
    rest = rest.replace(/цилиндр/i, "").trim();
  }
  if (/конус/i.test(rest)) {
    kind = (kind ? kind + " " : "") + "مخروطی";
    rest = rest.replace(/конус[а-я]*/i, "").trim();
  }
  if (/на подставке/i.test(rest)) {
    kind = (kind ? kind + " " : "") + "روی پایه";
    rest = rest.replace(/на подставке/i, "").trim();
  }

  rest = rest.replace(/^[а-яё]+\s+(формы|форма)\s*/i, "").replace(/^(для)\s+/i, "").replace(/\s+/g, " ").trim();
  const album = albumClean(ALBUM_BY_ID[(item.albums ?? [])[0]] ?? "");
  const { fa, unknown } = translatePhrase(rest);
  const motif = fa || (album ? ALBUM_FA[album] ?? album : null) || "طرح تزئینی";

  const title = `${form}${kind ? " " + kind : ""} ${motif} — لوچینا`.replace(/\s+/g, " ").slice(0, 120);
  const description =
    `${form}${kind ? " " + kind : ""} ${motif} از مجموعهٔ لوچینا (Luchina)؛ برند روسی قالب‌های سیلیکونی شمع` +
    `${album && ALBUM_FA[album] ? ` — کالکشن «${ALBUM_FA[album]}»` : ""}. منبع الهام: Luchina (VK).`;
  const seedPrompt =
    `${form}${kind ? " " + kind : ""} به فرم ${motif} با جزئیات برجستهٔ نرم و سطح داخلی صاف، طراحی کالکشن لوچینا`;

  const isSoap = /мыл[ао]/i.test(raw);
  const category = isSoap ? "soap" : plasterWord ? "plaster" : "candle";
  return {
    title,
    description: description.slice(0, 400),
    seedPrompt: seedPrompt.slice(0, 800),
    category,
    unknown,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.url ?? process.env.ZEROLAB_BASE_URL ?? BASE_URL_DEFAULT).replace(/\/$/, "");
  const catalogPath = args.file ?? CATALOG_PATH_DEFAULT;
  const dryRun = Boolean(args["dry-run"]);
  const secret = loadSeedSecret();
  if (!secret && !dryRun) {
    console.error("SEED_SECRET not found — set it in .env.local first.");
    process.exit(1);
  }

  const db = JSON.parse(readFileSync(path.join(process.cwd(), catalogPath), "utf8"));
  const items = Object.entries(db);
  console.log(`Importing ${items.length} Luchina product(s) -> ${base}/api/library/import`);

  const unknownWords = new Map();
  let ok = 0, dup = 0, failed = 0, skipped = 0;
  for (const [index, [href, item]] of items.entries()) {
    const meta = buildMeta(item);
    if (!item.img) { skipped++; continue; }
    for (const w of meta.unknown) unknownWords.set(w, (unknownWords.get(w) ?? 0) + 1);
    const handle = (href.match(/product-210914331_(\d+)/) || [])[1];
    if (!handle) { skipped++; continue; }
    const tag = `[${index + 1}/${items.length}] [${meta.category}] ${meta.title}`;
    if (dryRun) {
      if (index < 12) console.log(tag + "\n    " + meta.description.slice(0, 100));
      continue;
    }
    process.stdout.write(`${tag} … `);
    try {
      const res = await fetch(`${base}/api/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-seed-key": secret },
        body: JSON.stringify({
          category: meta.category,
          title: meta.title,
          description: meta.description,
          seedPrompt: meta.seedPrompt,
          material: meta.category === "plaster" ? MATERIAL_PLASTER : MATERIAL_CANDLE,
          imageUrl: item.img,
          source: {
            site: "Luchina (VK)",
            url: href,
            handle,
            productId: handle,
            price: item.price ? item.price.replace(/[^\d.]/g, "") : undefined,
            currency: "RUB",
            shopCategory: item.albums?.join(",") || undefined,
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) ?? {};
      if (res.ok && data.imageId && data.skipped) { dup++; console.log("SKIPPED"); }
      else if (res.ok && data.imageId) { ok++; console.log("OK"); }
      else { failed++; console.log(`FAIL ${res.status} ${data.error ?? ""} ${data.message ?? ""}`.trim()); }
    } catch (err) {
      failed++;
      console.log(`FAIL ${err?.message ?? err}`);
    }
  }

  if (unknownWords.size) {
    console.log("\nUntranslated Russian words (fallback used):");
    for (const [w, c] of [...unknownWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      console.log(`  - ${w} ×${c}`);
    }
  }
  console.log(`Done: ${ok} imported, ${dup} skipped, ${failed} failed, ${skipped} no-handle.`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
