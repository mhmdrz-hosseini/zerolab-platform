/**
 * Dinara Kasko shop crawler.
 *
 * Crawls the OpenCart category pages (molds + tools) with pagination and
 * extracts product cards into .scratch/dinarakasko/products.json.
 * Politeness: sequential requests, ~400ms gap, robots.txt-clean URLs (no
 * sort/order/limit params; plain ?page= only).
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), ".scratch/dinarakasko/products.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const CATEGORIES = [
  { slug: "handmade", url: "/silicone-molds/handmade-silicone-moulds" },
  { slug: "factory", url: "/silicone-molds/siliconemoulds" },
  { slug: "kits", url: "/silicone-molds/kits" },
  { slug: "tools", url: "/silicone-molds/tools" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "en" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      console.error(`  fetch retry ${attempt} for ${url}: ${err.message}`);
      if (attempt === 3) throw err;
      await sleep(1500 * attempt);
    }
  }
}

/** Parse all `item single-product` cards from a listing page. */
function parseCards(html) {
  const cards = [];
  const cardRe = /class="item single-product"/g;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const start = m.index;
    const next = html.indexOf('class="item single-product"', start + 10);
    const block = html.slice(start, next > 0 ? next : start + 6000);

    const nameM = block.match(/<a class="product-name" href="([^"]+)">([^<]+)<\/a>/);
    if (!nameM) continue;
    const imgM = block.match(/<img src="(https:\/\/dinarakasko\.com\/image\/cache\/catalog\/[^"]+)"/);
    const priceM = block.match(/<div class="price">\s*<span>([^<]+)<\/span>/);
    const oldPriceM = block.match(/<span class="price-old">([^<]+)<\/span>/);
    const idM = block.match(/cart\.add\('(\d+)'/);
    const descM = block.match(/<p class="description">([\s\S]*?)<\/p>/);
    const stickerM = block.match(/sticker_item_text"[^>]*>\s*([A-Z!]+)\s*</);

    cards.push({
      id: idM ? idM[1] : null,
      url: nameM[1],
      title: nameM[2].trim(),
      image: imgM ? imgM[1] : null,
      price: priceM ? priceM[1].trim() : null,
      oldPrice: oldPriceM ? oldPriceM[1].trim() : null,
      sticker: stickerM ? stickerM[1].trim() : null,
      snippet: descM
        ? descM[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 300)
        : null,
    });
  }
  return cards;
}

async function main() {
  const byUrl = new Map();
  for (const cat of CATEGORIES) {
    console.log(`Category: ${cat.slug}`);
    for (let page = 1; page <= 30; page++) {
      const url =
        page === 1
          ? `https://dinarakasko.com${cat.url}`
          : `https://dinarakasko.com${cat.url}${cat.url.includes("?") ? "&" : "?"}page=${page}`;
      const html = await fetchPage(url);
      const cards = parseCards(html);
      if (cards.length === 0) {
        console.log(`  page ${page}: no cards — stopping`);
        break;
      }
      let fresh = 0;
      for (const card of cards) {
        const key = card.url;
        if (!byUrl.has(key)) {
          byUrl.set(key, { ...card, categories: [cat.slug] });
          fresh++;
        } else {
          const existing = byUrl.get(key);
          if (!existing.categories.includes(cat.slug)) existing.categories.push(cat.slug);
        }
      }
      console.log(`  page ${page}: ${cards.length} cards (${fresh} new)`);
      // stop when a page repeats everything AND it is the last page marker
      if (fresh === 0 && page > 1) break;
      await sleep(400);
    }
  }

  const products = [...byUrl.values()];
  writeFileSync(OUT, JSON.stringify({ shop: "Dinara Kasko", site: "https://dinarakasko.com", scrapedAt: "2026-09-29", products }, null, 1));
  console.log(`\nTotal unique products: ${products.length}`);
  const byCat = {};
  for (const p of products) for (const c of p.categories) byCat[c] = (byCat[c] ?? 0) + 1;
  console.log("By category:", JSON.stringify(byCat));
  const noImg = products.filter((p) => !p.image).length;
  const noPrice = products.filter((p) => !p.price).length;
  console.log(`Missing image: ${noImg}, missing price: ${noPrice}`);
}

await main();
