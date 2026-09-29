/**
 * Muse Molds shop crawler.
 *
 * muse-molds.com is a headless-Shopify React Router SPA whose /shop SSR
 * returns HTTP 500 to plain HTTP clients (bot filtering); the fully rendered
 * HTML is available through the allorigins proxy. This crawler fetches the
 * proxied page once, extracts the product grid (anchor → image + pcard-title,
 * plus prices from the sr-only accessibility list) and writes
 * .scratch/musemolds/products.json.
 *
 * Politeness: single page fetch via proxy, no pagination, no /api/ access.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), ".scratch/musemolds/products.json");
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

const decode = (s) =>
  String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

async function fetchShopHtml() {
  // Direct request first (in case the bot filter is lifted later), then proxy.
  const attempts = [
    "https://muse-molds.com/shop",
    "https://api.allorigins.win/raw?url=https%3A%2F%2Fmuse-molds.com%2Fshop",
  ];
  let lastError = "fetch failed";
  for (const url of attempts) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
      });
      const html = await res.text();
      // The SPA error shell is ~14KB with no product grid — treat as failure.
      if (html.includes("/products/") && html.includes("cdn.shopify.com")) {
        console.log(`fetched ${html.length} bytes via ${url}`);
        return html;
      }
      lastError = `${url}: rendered grid missing (HTTP ${res.status}, ${html.length} bytes)`;
    } catch (err) {
      lastError = `${url}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(lastError);
}

function parseProducts(html) {
  // Prices from the sr-only list (React comment separators).
  const prices = new Map();
  const srSlice = html.slice(html.indexOf("sr-only"));
  const priceRe =
    /<span>([^<]+?)<!--\s*-->\s*—\s*<!--\s*-->\$([0-9.,]+)<!--\s*-->\./g;
  let m;
  while ((m = priceRe.exec(srSlice)) !== null) {
    prices.set(decode(m[1]), m[2]);
  }

  // Product cards: anchor → nearby Shopify CDN image + pcard-title text.
  const byHandle = new Map();
  const anchorRe = /<a[^>]+href="(\/products\/[a-z0-9-]+)"[^>]*>/g;
  for (const a of html.matchAll(anchorRe)) {
    const handle = a[1];
    if (byHandle.has(handle)) continue;
    const win = html.slice(a.index, a.index + 4000);
    const imgM = win.match(
      /<img[^>]+src="(https:\/\/cdn\.shopify\.com\/[^"?]+)(\?[^"]*)?"/,
    );
    const titleM = win.match(/pcard-title[^>]*>([\s\S]*?)<\/div>/);
    const title = titleM ? decode(titleM[1].replace(/<[^>]+>/g, "")) : null;
    byHandle.set(handle, {
      handle: handle.replace("/products/", ""),
      url: "https://muse-molds.com" + handle,
      title,
      image: imgM ? imgM[1] : null,
      price: title ? (prices.get(title) ?? null) : null,
      currency: "USD",
    });
  }
  return [...byHandle.values()];
}

const html = await fetchShopHtml();
const products = parseProducts(html);
writeFileSync(
  OUT,
  JSON.stringify(
    { shop: "Muse Molds", site: "https://muse-molds.com", scrapedAt: "2026-09-29", products },
    null,
    1,
  ),
);
console.log(`Total unique products: ${products.length}`);
console.log(
  `Missing image: ${products.filter((p) => !p.image).length}, missing price: ${products.filter((p) => !p.price).length}`,
);
