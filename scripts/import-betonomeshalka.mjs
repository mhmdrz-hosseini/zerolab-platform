#!/usr/bin/env node
/**
 * Betonomeshalka Art (betonomeshalka-art.ru) catalog importer.
 *
 * Reads .scratch/beton/catalog-all.json (fetched from the public Tilda store
 * API store.tildaapi.com/api/getproductslist/ — params extracted from the
 * page's t_store_init block) and POSTs each product to
 * POST /api/library/import as a public library seed. Re-runs are idempotent
 * (dedupe by meta.source.handle = Tilda product uid).
 *
 * The shop sells silicone molds for CONCRETE/gypsum decor art (betonomeshalka
 * = concrete mixer) → category rules:
 * - title contains «Свеча» (candle) → candle
 * - every other «Молд» → plaster (گچ، بتن و پودر سنگ)
 * - non-mold items (gift certificate, PDF manual, course) → SKIPPED.
 *
 * Russian titles → Persian via the verified Luchina WORD_FA dictionary
 * (extracted from scripts/import-luchina.mjs) plus shop-specific additions.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/beton/catalog-all.json";
const MATERIAL_PLASTER = "پودر سنگ و بتن با سطح مات و لبه‌های تمیز";
const MATERIAL_CANDLE = "موم صیقلی با جزئیات واضح";

// ---- Reuse the verified RU→FA dictionary from the Luchina importer -------
const luchinaSrc = readFileSync(
  path.join(process.cwd(), "scripts/import-luchina.mjs"),
  "utf8",
);
const dictMatch = /const WORD_FA = \{[\s\S]*?\n\};/.exec(luchinaSrc);
if (!dictMatch) throw new Error("Cannot extract WORD_FA from import-luchina.mjs");
const WORD_FA = eval("(" + dictMatch[0].replace("const WORD_FA =", "").replace(/;\s*$/, "") + ")");

// Shop-specific additions (word level, escaped where risky).
const EXTRA_FA = {
  "\u043a\u043e\u0437\u0430": "\u0628\u0632", // коза → بز
  "\u0432\u043e\u0440\u043e\u0442\u043d\u0438\u043a\u0435": "\u0628\u0627 \u06cc\u0642\u0647", // в воротнике
  "\u0440\u0435\u0442\u0440\u043e": "\u0631\u062a\u0631\u0648", // ретро
  "\u043a\u043e\u0442\u043e\u0451\u043b\u043e\u0447\u043a\u0430": "\u062f\u0631\u062e\u062a \u06a9\u0631\u06cc\u0633\u0645\u0633 \u06af\u0631\u0628\u0647\u200c\u0627\u06cc", // котоёлочка
  "\u043c\u0430\u043d\u0434\u0430\u0440\u0438\u043d\u044b": "\u0645\u0646\u062f\u0631\u06cc\u0646\u200c\u0647\u0627", // мандарины
  "\u0430\u0432\u043e\u0441\u044c\u043a\u0435": "\u062f\u0631 \u062a\u0648\u0631\u06cc", // в авоське
  "\u0431\u0438\u0441\u0435\u0440": "\u0645\u0647\u0631\u0647", // бисер
  "\u043a\u0443\u0431\u043e\u043a": "\u062c\u0627\u0645", // кубок
  "\u0437\u0438\u043c\u0430": "\u0632\u0645\u0633\u062a\u0627\u0646", // зима
  "\u043a\u0438\u043d\u0436\u0430\u043b": "\u062e\u0646\u062c\u0631", // кинжал
  "\u0433\u043e\u0440\u043d\u044b\u0439": "\u06a9\u0648\u0647\u0633\u062a\u0627\u0646\u06cc", // горный
  "\u043a\u0430\u0441\u0442\u0440\u044e\u043b\u044c\u043a\u0430": "\u0642\u0627\u0628\u0644\u0645\u0647\u200c\u0627\u06cc \u06a9\u0648\u0686\u0648\u0644\u0648", // кастрюлька
  "\u043c\u0430\u043b\u0435\u043d\u044c\u043a\u0438\u0439": "\u06a9\u0648\u0686\u0648\u0644\u0648", // маленький
  "\u043f\u0440\u0438\u043d\u0446": "\u0634\u0627\u0647\u0632\u0627\u062f\u0647", // принц (already)
  "\u0440\u0443\u0441\u0430\u043b\u043e\u0447\u043a\u0430": "\u067e\u0631\u06cc \u062f\u0631\u06cc\u0627\u06cc\u06cc \u06a9\u0648\u0686\u0648\u0644\u0648", // русалочка
  "\u043b\u0435\u0434\u0435\u043d\u0435\u0446": "\u0622\u0628\u0646\u0628\u0627\u062a", // леденец
  "\u0432\u0430\u043d\u043d\u043e\u0439": "\u062f\u0631 \u0648\u0627\u0646", // в ванной
  "\u043b\u0435\u0442\u043e": "\u062a\u0627\u0628\u0633\u062a\u0627\u0646", // лето
  "\u0444\u0435\u043d\u0438\u043a\u0441": "\u0642\u0642\u0646\u0648\u0633", // феникс
  "\u0444\u0438\u0433\u0443\u0440\u043a\u0430": "\u0641\u06cc\u06af\u0648\u0631", // фигурка
  "\u043a\u0440\u0443\u0436\u043a\u0430": "\u0644\u06cc\u0648\u0627\u0646", // кружка
  "\u043a\u0430\u043a\u0430\u043e": "\u06a9\u0627\u06a9\u0627\u0626\u0648", // какао
  "\u044f\u0431\u043b\u043e\u043a\u043e": "\u0633\u06cc\u0628", // яблоко
  "\u043e\u0442\u0440\u0430\u0432\u043b\u0435\u043d\u043d\u043e\u0435": "\u0633\u0645\u200c\u062f\u0627\u0631", // отравленное
  "\u0441\u043e\u0432\u0430": "\u062c\u063a\u062f", // сова
  "\u0434\u043e\u043c\u0438\u043a": "\u062e\u0627\u0646\u0647\u200c\u0627\u06cc", // домик
  "\u0434\u0443\u043f\u043b\u0435": "\u062f\u0631 \u0644\u0627\u0646\u0647", // в дупле
  "\u0430\u0440\u0431\u0443\u0437": "\u0647\u0646\u062f\u0648\u0627\u0646\u0647", // арбуз
  "\u0433\u0440\u0443\u0648\u0430": "\u0628\u0631\u0634", // груша (диал.)
  "\u0433\u0440\u0443\u0448\u0430": "\u06af\u0644\u0627\u0628\u06cc", // груша
  "\u0446\u0438\u0442\u0440\u0443\u0441": "\u0645\u0631\u06a9\u0628\u0627\u062a", // цитрус
  "\u0433\u043e\u0440\u043e\u0445": "\u0646\u062e\u0648\u062f", // горох
  "\u043c\u0430\u043b\u0438\u043d\u0430": "\u062a\u0645\u0634\u06a9 \u0642\u0631\u0645\u0632", // малина
  "\u043a\u043b\u0443\u0431\u043d\u0438\u043a\u0430": "\u062a\u0648\u062a\u200c\u0641\u0631\u0646\u06af\u06cc", // клубника
  "\u043f\u0430\u0441\u0445\u0430\u043b\u044c\u043d\u043e\u0435": "\u0639\u06cc\u062f \u067e\u0627\u06a9\u06cc", // пасхальное
  "\u043c\u0430\u0440\u0442\u043e\u0432\u0441\u043a\u0438\u0439": "\u0645\u0627\u0631\u062a\u06cc", // мартовский
  "\u0437\u0430\u044f\u0446": "\u062e\u0631\u06af\u0648\u0634", // заяц
  "\u0433\u043d\u0435\u0437\u0434\u043e": "\u0644\u0627\u0646\u0647\u200c\u0627\u06cc", // гнездо
  "\u043f\u0442\u0438\u0447\u043a\u043e\u0439": "\u0628\u0627 \u067e\u0631\u0646\u062f\u0647 \u06a9\u0648\u0686\u0648\u0644\u0648", // с птичкой
  "\u0441\u0442\u0430\u043a\u0430\u043d": "\u0644\u06cc\u0648\u0627\u0646", // стакан
  "\u0438\u0433\u0440\u0443\u0448\u043a\u0438": "\u0627\u0633\u0628\u0627\u0628\u200c\u0628\u0627\u0632\u06cc", // игрушки
  "\u0434\u0435\u0434 \u043c\u043e\u0440\u043e\u0437": "\u0628\u0627\u0628\u0627\u0646\u0648\u0626\u0644", // дед мороз
  "\u043d\u043e\u0432\u043e\u0433\u043e\u0434\u043d\u0438\u0439": "\u0633\u0627\u0644 \u0646\u0648", // новогодний
  "\u0441\u0432\u0435\u0442\u0438\u043b\u044c\u043d\u0438\u043a": "\u0686\u0631\u0627\u063a", // светильник
  "\u043f\u043e\u0441\u043b\u0430\u043d\u0438\u0435": "\u067e\u06cc\u0627\u0645", // послание
  "\u0441\u0430\u043b\u0435": "", // sale suffix
  "\u043f\u0440\u0435\u0434\u0437\u0430\u043a\u0430\u0437": "", // предзаказ (handled separately)
  "\u0432\u0438\u0448\u043d\u044f": "\u06af\u06cc\u0644\u0627\u0633", // вишня
  "\u043a\u043e\u0448\u0435\u0447\u043a\u0430": "\u06af\u0631\u0628\u0647 \u06a9\u0648\u0686\u0648\u0644\u0648", // кошечка
  "\u0443\u0442\u043e\u0447\u043a\u0430": "\u0627\u0631\u062f\u06a9 \u06a9\u0648\u0686\u0648\u0644\u0648", // уточка
  "\u0431\u0430\u0440\u0430\u0448\u0435\u043a": "\u0628\u0631\u0647", // барашек
  "\u0432\u043e\u0437\u0434\u0443\u0448\u043d\u044b\u0439": "\u0647\u0648\u0627\u06cc\u06cc", // воздушный
  // шар stays گوی from the Luchina dict — works for both气球 and шар ornament
  "\u0441\u0435\u0440\u0434\u0435\u0447\u043a\u043e\u043c": "\u0628\u0627 \u0642\u0644\u0628", // с сердечком
  "\u0442\u044b\u043a\u0432\u0430": "\u06a9\u062f\u0648 \u062d\u0644\u0648\u0627\u06cc\u06cc", // тыква
  "\u043a\u043e\u0444\u0435\u0439\u043d\u043e\u0435": "\u0642\u0647\u0648\u0647\u200c\u0627\u06cc", "\u0437\u0435\u0440\u043d\u043e": "\u062f\u0627\u0646\u0647", // кофейное зерно
  "\u0446\u0438\u0440\u043a\u043e\u0432\u043e\u0439": "\u0633\u06cc\u0631\u06a9\u06cc", "\u0448\u0430\u0442\u0435\u0440": "\u0686\u0627\u062f\u0631", // цирковой шатер
  "\u0434\u0438\u0432\u043d\u044b\u0439": "\u0634\u06af\u0641\u062a", "\u0432\u043e\u0441\u0442\u043e\u043a": "\u0634\u0631\u0642", // дивный восток
  "\u043a\u043e\u0442": "\u06af\u0631\u0628\u0647", "\u0431\u0430\u0440\u043e\u043d": "\u0628\u0627\u0631\u0648\u0646", // кот, барон
  "\u0442\u044e\u043b\u044c\u043f\u0430\u043d": "\u0644\u0627\u0644\u0647", "\u0432\u0438\u043a\u0438\u043d\u0433": "\u0648\u0627\u06cc\u06a9\u06cc\u0646\u06af", // тюльпан, викинг
  "\u043a\u043e\u0440\u043e\u043b\u0435\u0432\u0441\u043a\u0438\u0435": "\u0633\u0644\u0637\u0646\u062a\u06cc", "\u0444\u0438\u043d\u0438\u043a\u0438": "\u062e\u0631\u0645\u0627", // королевские финики
};
Object.assign(WORD_FA, EXTRA_FA);
for (const k of Object.keys(WORD_FA)) {
  const lk = k.toLowerCase();
  if (lk !== k && WORD_FA[lk] === undefined) WORD_FA[lk] = WORD_FA[k];
}

const decode = (s) =>
  String(s ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function translatePhrase(phrase) {
  const words = phrase.replace(/[«»()+,\u2013-]/g, " ").split(/\s+/).filter(Boolean);
  const out = [];
  const unknown = [];
  for (const w of words) {
    const lower = w.toLowerCase();
    const hit = WORD_FA[lower] ?? WORD_FA[lower.replace(/(а|я|ы|и|у|ю|е|о|й)$/,'')];
    if (hit !== undefined && hit !== "") out.push(hit);
    else if (hit === "") continue;
    else if (/^[№\dxlL]+$/i.test(w)) out.push(w);
    else unknown.push(w);
  }
  return { fa: out.join(" "), unknown };
}

function firstImage(product) {
  try {
    const g = JSON.parse(product.gallery || "[]");
    return g[0]?.img ?? null;
  } catch {
    return null;
  }
}

function buildMeta(product) {
  const raw = product.title.replace(/\s+/g, " ").trim();
  const rest = raw
    .replace(/^Молд\s*/i, "")
    .replace(/\s*(ПРЕДЗАКАЗ|предзаказ|sale|SALE)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const isCandle = /свеч/i.test(raw);
  const { fa, unknown } = translatePhrase(rest);
  const motif = fa || "طرح تزئینی";
  const isSale = /sale/i.test(raw);
  const isPreorder = /предзаказ/i.test(raw);

  const title = `قالب ${motif}${isSale ? " — تخفیف" : ""}${isPreorder ? " — پیش‌خرید" : ""} — بتونومشالکا`.slice(0, 120);
  const notes = [
    isSale ? "نسخهٔ تخفیف" : null,
    isPreorder ? "پیش‌خرید (۱۴–۳۰ روز)" : null,
  ].filter(Boolean).join("؛ ");
  const description =
    `قالب سیلیکونی ${motif} از مجموعهٔ بتونومشالکا (Betonomeshalka Art)؛ برند روسی قالب‌های دکور بتن و گچ` +
    `${notes ? "؛ " + notes : ""}. منبع الهام: Betonomeshalka Art.`;
  const seedPrompt =
    `قالب سیلیکونی دکور به فرم ${motif} با جزئیات برجستهٔ نرم و سطح داخلی صاف، مناسب ریخته‌گری بتن و گچ`;
  return {
    title,
    description: description.slice(0, 400),
    seedPrompt: seedPrompt.slice(0, 800),
    category: isCandle ? "candle" : "plaster",
    unknown,
  };
}

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

  const products = JSON.parse(readFileSync(path.join(process.cwd(), catalogPath), "utf8"));
  // skip non-mold items
  const jobs = [];
  const skipped = [];
  for (const p of products) {
    if (!/^Молд/i.test(p.title) && !/молд/i.test(p.title)) {
      skipped.push(p.title);
      continue;
    }
    const image = firstImage(p);
    if (!image) { skipped.push(p.title + " (no image)"); continue; }
    jobs.push({ product: p, image, meta: buildMeta(p) });
  }

  const byCat = {};
  for (const j of jobs) byCat[j.meta.category] = (byCat[j.meta.category] ?? 0) + 1;
  console.log(`Importing ${jobs.length} Betonomeshalka product(s)`, JSON.stringify(byCat));
  if (skipped.length) console.log("Skipped: " + skipped.join(" | "));

  if (dryRun) {
    for (const j of jobs.slice(0, 10)) {
      console.log(`— [${j.meta.category}] ${j.meta.title}`);
      console.log("    " + j.meta.description.slice(0, 110));
      console.log("    " + j.image.slice(0, 80));
    }
    const unknownWords = new Map();
    for (const j of jobs) for (const w of j.meta.unknown) unknownWords.set(w, (unknownWords.get(w) ?? 0) + 1);
    if (unknownWords.size) {
      console.log("Untranslated:");
      for (const [w, c] of [...unknownWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  - ${w} ×${c}`);
    }
    return;
  }

  let ok = 0, dup = 0, failed = 0;
  for (const [index, j] of jobs.entries()) {
    const tag = `[${index + 1}/${jobs.length}] [${j.meta.category}] ${j.meta.title}`;
    process.stdout.write(`${tag} … `);
    try {
      const res = await fetch(`${base}/api/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-seed-key": secret },
        body: JSON.stringify({
          category: j.meta.category,
          title: j.meta.title,
          description: j.meta.description,
          seedPrompt: j.meta.seedPrompt,
          material: j.meta.category === "candle" ? MATERIAL_CANDLE : MATERIAL_PLASTER,
          imageUrl: j.image,
          source: {
            site: "Betonomeshalka Art",
            url: j.product.url,
            handle: String(j.product.uid),
            productId: String(j.product.uid),
            price: j.product.price ? String(parseFloat(j.product.price)) : undefined,
            currency: "RUB",
            sku: j.product.sku || undefined,
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
  console.log(`Done: ${ok} imported, ${dup} skipped, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
