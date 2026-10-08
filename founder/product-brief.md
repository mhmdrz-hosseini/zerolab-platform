<!-- /founder:product-brief · 2026-10-05 · input: online customizable mold platform for wax cakes and home mold use; flow = chat, library, preview, image-to-3D, customize, live price, order, we deliver a 3D printed mold -->

# ZeroLab product brief

Assumption: primary market is Iran (the product ships a Persian RTL UI), prices in toman, and molds are printed and shipped domestically.
Assumption: revenue is per-order payment for the physical mold; AI generation is gated by credits so generation cost stays bounded.
Assumption: the delivered item is the 3D printed mold itself (or a printed master), not a cast silicone mold, at MVP.

## Problem statement

Home makers who pour wax, chocolate, soap, resin, or plaster buy molds that already exist. When they want their own shape (a logo candle, a dated wax gift cake, a character figure) there is no self-serve path. Today they:

- Browse Instagram shops and Telegram catalogs for a near-enough stock mold, mostly generic imports, at roughly 200k to 1.5M toman per silicone mold (Estimate: mirrors typical Iranian reseller markups over ~3 to 15 USD import prices).
- Commission a custom mold from a craft seller: days of DM back-and-forth, no preview of the design, private quote, 2 to 6 week wait (Estimate from how these sellers operate).
- Buy internationally: custom 3D printed mold masters start around 40 USD on Etsy ([source](https://www.etsy.com)), and full-service shops such as [Hollywood 3D Printing](https://hollywood3dprinting.com) work quote-only, and only from a 3D file the customer must already have.

In all three paths the buyer pays before seeing the design, cannot tweak it, and waits weeks. The seller burns unpaid hours doing design consulting in DMs.

## Target audience

Primary: Iranian home candle and wax-cake makers who sell 10 to 100 pieces a month on Instagram and need one specific mold shape their supplier does not carry. (For full personas, run `/founder:persona-gen`.)

Secondary: any home user of a pourable material (chocolate and fondant, soap, resin, plaster and concrete) who wants a single personalized mold.

## Value proposition

ZeroLab helps home wax and craft makers get exactly the mold they imagined by chatting the idea, previewing it as generated images and a rotatable 3D model, and ordering the physical 3D printed mold at a live price, unlike Instagram mold sellers and Etsy custom shops which sell only existing designs or quote blind with weeks of waiting.

## Core features (MVP)

1. **Persian idea chat (Zero).** Chat that turns a vague idea into a concrete "spec card" brief for the design step. Without it there is no entry point: the promise starts at "tell me your idea", not "upload a CAD file".
2. **Design generation and variations.** 3 to 6 image previews generated from the brief (measured cost about 0.034 USD per image on Aval), pick one, iterate with feedback. Without it the buyer still pays blind, which is the exact pain we remove.
3. **Image-to-3D.** The chosen image becomes geometry (Tripo image-to-model, 20 to 40 credits per job per project research of the Tripo API docs) shown in an in-page 3D viewer. Without it we have nothing to price, print, or ship.
4. **Mold library.** 1,283 seeded designs in 7 categories (candle 551, confectionery 459, plaster 194, plus figures, resin, keepsake, soap) as the browse path and a "start from this" base for customization. Without it, users with no idea of their own have nothing to do on the site. Known gap: the library API returns at most 200 rows per query, so big categories truncate; pagination is a launch blocker for this feature.
5. **Live price configurator.** User sets size and options, price updates live before checkout. Without it we have recreated the DM-quote problem we set out to kill, and "real live price" is the core trust claim.
6. **Order and credit wall.** Checkout in toman plus credit-gated generation so AI spend never runs unbounded per visitor. Without it there is no revenue and an open cost leak.
7. **Print and ship.** The accepted model becomes a sliced print job, then QA, packing, and domestic tracking. Without it the product does not exist: we sell a physical mold.

## Success metrics (first 90 days)

- 1,500 lab sessions with 35% or more starting a chat (leading indicator of funnel entry).
- 40% of chat sessions generate at least one image.
- 15% of image generators reach the 3D step, and 60% of those open the configurator (leading indicator of purchase intent).
- 25 paid orders at 1.5% or better session-to-order conversion, with average order value to be set by `/founder:pricing-strategy`.
- 90% of ordered models print without a redesign loop, under 2% refund rate (fulfillment quality, tracked from day one).

## Risks and assumptions

1. **Generated 3D is printable as a mold.** Tripo meshes can be non-manifold, too thin, or have undercuts that block demolding. Test under 500 USD in under 2 weeks: run 30 varied library images through image-to-3D, slice all 30, print 5, count how many pass. Fix path: automated mesh repair plus a "mold-safe" thickness pass before pricing.
2. **Buyers pay custom-mold prices in a stock-mold market.** Iranian buyers are used to cheap imported molds. Test: an Instagram catalog of 10 generated designs with real prices and a manual payment link, 100 USD in promotion, measure clicks to payments. If nobody pays, the price anchor, not the product, is the problem.
3. **One-off fulfillment economics work.** Print time, failed prints, and courier cost per single mold must fit under the live price. Test: run 10 real end-to-end orders for the personal network at offer price and record true cost per delivered mold, under 2 weeks. Also blocks: Aval account still needs Tier 1 phone verification and the Tripo key must be live, both currently manual steps.

## Go-to-market snapshot

1. **Instagram Reels** (first channel): before-and-after videos, chat idea to photo to 3D to finished wax cake, aimed at Iranian candle-maker hashtags. CAC estimate: 100k to 400k toman per paying customer (Estimate, unsourced; validate in channel test #2).
2. **Telegram supplier communities**: wax and mold-material seller channels that already aggregate our exact audience; catalog posts and a rev-share for channel owners. CAC estimate: 0 to 50k toman (Estimate).
3. **Library SEO**: 1,283 design pages targeting long-tail Persian queries such as "قالب شمع", only after pagination ships so pages are indexable. CAC estimate: near 0 marginal, 6 to 12 month payoff (Estimate).

Product-specific growth tactic: every generated design gets a public share page (image, rotating 3D, live price). The delivered mold arrives with a card carrying that link and the buyer's handle, so each order advertises directly inside the niche community that produced it.
