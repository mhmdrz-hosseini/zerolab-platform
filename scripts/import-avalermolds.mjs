#!/usr/bin/env node
/**
 * Avaler Molds catalog importer.
 *
 * Reads .scratch/avalermolds/products.json (fetched directly from
 * https://avalermolds.com/products.json — the storefront allows plain curl)
 * and POSTs each MOULD product to POST /api/library/import as a public
 * library seed. Re-runs are idempotent (dedupe by meta.source.handle).
 *
 * Scope decisions:
 * - Category: all Avaler molds are pastry molds (chocolate, fondant, cake
 *   decor, mousse cakes) → ALL map to "confectionery" (قنادی و خوراکی).
 * - The 6 non-mold items (4 plastic ring/cake cutters + 2 plastic tapping
 *   boards) are physical utensils → SKIPPED by product_type.
 * - The store sells the same bundle designs in two markets (regular + "IL"
 *   Israel-market SKUs). Both are imported; IL variants are marked
 *   «نسخهٔ IL» in title/description.
 *
 * Usage:
 *   node scripts/import-avalermolds.mjs --url=http://localhost:3001
 *   node scripts/import-avalermolds.mjs --dry-run
 */

import { readFileSync } from "node:fs";
import path from "node:path";

const BASE_URL_DEFAULT = "http://localhost:3001";
const CATALOG_PATH_DEFAULT = ".scratch/avalermolds/products.json";
const CATEGORY = "confectionery";
const MATERIAL = "سیلیکون غذایی درجهٔ یک، ساخت دستی";

/** product_type values that are NOT mold designs. */
const SKIP_TYPES = new Set(["plastic cutters", "Plastic Tapping Board"]);

/** Hand-written Persian metadata, keyed by Shopify handle. */
const PERSIAN = {
  "dumpling-cake-pop-bite-silicone-mold": {
    title: "قالب کیک‌پاپ دامپلینگ",
    description:
      "قالب سیلیکونی سه‌بعدی دامپلینگ آسیایی برای کیک‌پاپ و کیک‌بایت؛ دست‌ساز و درجهٔ غذایی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی کیک‌پاپ به فرم دامپلینگ آسیایی با چین‌های لبهٔ برجسته و سطح صاف",
  },
  "lambeth-round-vintage-cake-silicone-mold": {
    title: "قالب کیک لمبث وینتیج گرد",
    description:
      "قالب سیلیکونی کیک موس با نقش لمبث سلطنتی و حال‌وهوای وینتیج؛ برای کیک‌های بنتو و مجلسی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک گرد با نقش لمبث وینتیج، خطوط ظریف برجسته و تقارن شعاعی",
  },
  "lambeth-heart-vintage-cake-silicone-mold": {
    title: "قالب کیک لمبث وینتیج قلب",
    description:
      "قالب سیلیکونی کیک موس قلبی با نقش لمبث سلطنتی؛ رمانتیک و مجلسی برای مناسبت‌های خاص. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک قلبی با نقش لمبث وینتیج، خطوط ظریف برجسته و لبه‌های تمیز",
  },
  "3d-teddy-bear-girl-with-dress-silicone-mold": {
    title: "قالب سه‌بعدی تدی‌بیر دختر با لباس",
    description:
      "قالب سیلیکونی سه‌بعدی تدی‌بیر دخترانه با لباس؛ برای تزئین شکلات و کیک تولد و جشن نوزاد. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی تدی‌بیر بامزه با لباس دخترانه، جزئیات نرم و فرم یک‌تکه",
  },
  "3d-teddy-bear-holding-a-teddy-silicone-mold": {
    title: "قالب سه‌بعدی تدی‌بیر با تدی‌بیر کوچولو",
    description:
      "قالب سیلیکونی سه‌بعدی تدی‌بیری که تدی‌بیر کوچکی در آغوش دارد؛ دوست‌داشتنی برای کیک کودک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی تدی‌بیر در حال آغوش گرفتن تدی‌بیر کوچک، جزئیات نرم و فرم یک‌تکه",
  },
  "3d-sitting-bunny-with-flower-crown-silicone-mold": {
    title: "قالب سه‌بعدی خرگوش نشسته با تاج گل",
    description:
      "قالب سیلیکونی سه‌بعدی خرگوش نشسته با تاج گل؛ حس بهاری برای شکلات و تزئین کیک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی خرگوش نشسته با تاج گل کوچک روی سر، گوش‌های بلند گرد و فرم یک‌تکه",
  },
  "bella-alphabet-silicone-mold-bundle-1-5-cm-2-cm-il": {
    title: "ست الفبای «بلا» ۱٫۵ و ۲ سانتی — نسخهٔ IL",
    description:
      "ست دو قالب الفبا با فونت «بلا» در سایزهای ۱٫۵ و ۲ سانتی‌متر؛ حروف برجسته برای نوشتن روی کیک — نسخهٔ بازار IL. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی حروف الفبا برجسته در دو سایز با فونت ظریف گرد، لبه‌های تمیز و کف صاف",
  },
  "bella-alphabet-silicone-mold-bundle-1-5-cm-2-cm": {
    title: "ست الفبای «بلا» ۱٫۵ و ۲ سانتی",
    description:
      "ست دو قالب الفبا با فونت «بلا» در سایزهای ۱٫۵ و ۲ سانتی‌متر؛ حروف برجستهٔ فوندانت و شکلات برای نوشتن روی کیک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی حروف الفبا برجسته در دو سایز با فونت ظریف گرد، لبه‌های تمیز و کف صاف",
  },
  "bella-alphabet-silicone-mold-1-5-cm-0-6-in": {
    title: "قالب الفبای «بلا» — ۱٫۵ سانتی‌متر",
    description:
      "قالب الفبا با فونت «بلا» در سایز ۱٫۵ سانتی‌متر؛ حروف ریز برجسته برای پیام‌های کیک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی حروف الفبای کوچک برجسته با فونت ظریف، لبه‌های تمیز و کف صاف",
  },
  "bella-alphabet-silicone-mold-2-cm-0-8-in": {
    title: "قالب الفبای «بلا» — ۲ سانتی‌متر",
    description:
      "قالب الفبا با فونت «بلا» در سایز ۲ سانتی‌متر؛ حروف برجستهٔ فوندانت و شکلات. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی حروف الفبا برجسته با فونت ظریف گرد، لبه‌های تمیز و کف صاف",
  },
  "esther-alphabet-numbers-silicone-mold-2-cm-0-8-in": {
    title: "قالب الفبا و اعداد «استر» — ۲ سانتی‌متر",
    description:
      "قالب الفبا و اعداد با فونت «استر»؛ برای اسم و سن روی کیک تولد. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی حروف الفبا و اعداد برجسته با فونت کلاسیک، لبه‌های تمیز و کف صاف",
  },
  "once-upon-a-time-bundle-1": {
    title: "ست «یکی بود، یکی نبود» — پرنسس و قلعه",
    description:
      "ست قالب‌های سیلیکونی داستانی شامل پرنسس، قلعه و عناصر افسانه‌ای برای شکلات و فوندانت. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح پرنسس، قلعه و عناصر قصه‌های پریان، جزئیات برجستهٔ نرم",
  },
  "enchanted-forest-bundle-1": {
    title: "ست جنگل افسونشده — پری و عناصر جنگل",
    description:
      "ست قالب‌های سیلیکونی با طرح پری، قارچ، برگ و عناصر جنگل افسونشده. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح پری و عناصر جنگلی، جزئیات برجستهٔ نرم و لبه‌های تمیز",
  },
  "mermaid-sea-life-bundle-1": {
    title: "ست زیر دریا — پری دریایی و موجودات دریایی",
    description:
      "ست قالب‌های سیلیکونی با طرح پری دریایی، صدف و موجودات دریایی؛ حس اقیانوس برای کیک تابستانی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح پری دریایی و موجودات دریایی، جزئیات برجستهٔ نرم",
  },
  "fuzzy-bear-trio-bundle-1": {
    title: "ست سه‌تایی خرس‌های کرکی سه‌بعدی",
    description:
      "ست سه قالب سیلیکونی سه‌بعدی خرس‌های کرکی در حالت‌های مختلف؛ برای شکلات و کیک کودک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی سه‌بعدی خرس‌های کرکی بامزه در حالت‌های نشسته و خوابیده، بافت کرکی نرم",
  },
  "space-adventure-bundle-us": {
    title: "ست ماجراجویی فضایی — فضانورد و عناصر فضا",
    description:
      "ست قالب‌های سیلیکونی با طرح فضانورد، موشک و سیارات؛ برای کیک تولد کهکشانی کودکان. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح فضانورد، موشک و سیارات، جزئیات برجسته و لبه‌های تمیز",
  },
  "once-upon-a-time-bundle": {
    title: "ست «یکی بود، یکی نبود» — نسخهٔ IL",
    description:
      "ست قالب‌های سیلیکونی داستانی پرنسس و قلعه — نسخهٔ بازار IL. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح پرنسس، قلعه و عناصر قصه‌های پریان، جزئیات برجستهٔ نرم",
  },
  "enchanted-forest-bundle": {
    title: "ست جنگل افسونشده — نسخهٔ IL",
    description:
      "ست قالب‌های سیلیکونی پری و عناصر جنگل — نسخهٔ بازار IL. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح پری و عناصر جنگلی، جزئیات برجستهٔ نرم",
  },
  "mermaid-sea-life-bundle": {
    title: "ست پری دریایی و دریا — نسخهٔ IL",
    description:
      "ست قالب‌های سیلیکونی پری دریایی و موجودات دریایی — نسخهٔ بازار IL. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح پری دریایی و موجودات دریایی، جزئیات برجستهٔ نرم",
  },
  "fuzzy-bear-trio-bundle": {
    title: "ست سه‌تایی خرس‌های کرکی — نسخهٔ IL",
    description:
      "ست سه قالب سیلیکونی سه‌بعدی خرس‌های کرکی — نسخهٔ بازار IL. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی سه‌بعدی خرس‌های کرکی بامزه، بافت کرکی نرم و فرم یک‌تکه",
  },
  "space-bundle": {
    title: "ست ماجراجویی فضایی — نسخهٔ IL",
    description:
      "ست قالب‌های سیلیکونی فضانورد و عناصر فضا — نسخهٔ بازار IL. منبع الهام: Avaler Molds.",
    seedPrompt:
      "ست قالب سیلیکونی تزئینات کیک با طرح فضانورد و سیارات، جزئیات برجسته و لبه‌های تمیز",
  },
  "daisy-flower-cake-silicone-mold-handmade": {
    title: "قالب کیک گل مینا",
    description:
      "قالب سیلیکونی کیک موس به فرم گل مینای چندپر؛ طراحی دست‌ساز برای کیک‌های بهاری و مجلسی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم گل مینا با گلبرگ‌های متقارن و مرکز برجسته، سطح صاف",
  },
  "infinite-love-cake-heart-silicon-mold-handmade": {
    title: "قالب کیک قلب «عشق بی‌پایان»",
    description:
      "قالب سیلیکونی کیک موس قلبی با طرح عشق بی‌پایان؛ برای ولنتاین و سالگرد. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک قلبی با نقش نمادین عشق، سطوح منحنی نرم و لبه‌های تمیز",
  },
  "3d-unicorn-silicone-mold-handmade": {
    title: "قالب سه‌بعدی تک‌شاخ کیک‌تاپر",
    description:
      "قالب سیلیکونی سه‌بعدی تک‌شاخ برای کیک‌تاپر و شکلات؛ محبوب جشن‌های کودکانه. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی تک‌شاخ با یال موج‌دار و شاخ برجسته، جزئیات نرم و فرم یک‌تکه",
  },
  "3d-teddy-bear-holding-heart-mold-handmade": {
    title: "قالب سه‌بعدی تدی‌بیر بزرگ با قلب",
    description:
      "قالب سیلیکونی سه‌بعدی تدی‌بیر بزرگ که قلبی در آغوش دارد؛ برای کیک تولد و ولنتاین. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی تدی‌بیر در حال بغل کردن قلب، جزئیات نرم و فرم یک‌تکه",
  },
  "hot-air-balloon-silicone-mold-handmade": {
    title: "قالب بالون هوای گرم — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با طرح بالون هوای گرم؛ برای شکلات و تزئینات فوندانت کیک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت بالون هوای گرم با راه‌راه‌های برجسته، جزئیات نرم و کف صاف",
  },
  "sea-life-silicon-molds-handmade": {
    title: "قالب موجودات دریایی — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با طرح موجودات دریایی؛ صدف، ستارهٔ دریایی و ماهی برای تزئین کیک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت با طرح موجودات دریایی شامل صدف و ستارهٔ دریایی، جزئیات برجستهٔ نرم",
  },
  "mermaid-silicone-mold-handmade": {
    title: "قالب پری دریایی — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با طرح پری دریایی؛ برای کیک‌های تابستانی و جشن دخترانه. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت پری دریایی با دم موج‌دار و جزئیات فلس‌ها، کف صاف و لبه‌های تمیز",
  },
  "3d-small-fuzzy-bear-sleeping-silicone-mold-handmade": {
    title: "قالب سه‌بعدی خرس کرکی خوابیده",
    description:
      "قالب سیلیکونی سه‌بعدی خرس کرکی خوابیده؛ کوچک و دوست‌داشتنی برای شکلات و کیک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی خرس کرکی خوابیده با بافت کرکی نرم، فرم جمع‌وجور و یک‌تکه",
  },
  "luminous-cake-silicone-mold-handmade": {
    title: "قالب کیک پوستهٔ صدف",
    description:
      "قالب سیلیکونی کیک موس با فرم پوستهٔ صدف و شیارهای شعاعی؛ ظاهری لطیف و مجلسی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی موس‌کیک به فرم پوستهٔ صدف با شیارهای شعاعی برجسته و سطوح منحنی نرم",
  },
  "3d-small-fuzzy-bear-hands-on-hips-silicone-mold-handmade": {
    title: "قالب سه‌بعدی خرس کرکی ایستاده",
    description:
      "قالب سیلیکونی سه‌بعدی خرس کرکی ایستاده با ژست بامزه؛ برای شکلات و کیک کودک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی خرس کرکی ایستاده دست به کمر، بافت کرکی نرم و فرم یک‌تکه",
  },
  "3d-small-fuzzy-bear-with-hand-up-silicone-mold-handmade": {
    title: "قالب سه‌بعدی خرس کرکی با پنجهٔ بالا",
    description:
      "قالب سیلیکونی سه‌بعدی خرس کرکی که پنجه‌اش را بالا گرفته؛ تزئین دوست‌داشتنی کیک و شکلات. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی سه‌بعدی خرس کرکی با یک پنجهٔ بالا رفته، بافت نرم و فرم یک‌تکه",
  },
  "forest-silicone-mold-handmade": {
    title: "قالب جنگل افسونشده — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با عناصر جنگل افسونشده؛ قارچ، برگ و موجودات کوچک جنگلی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت با عناصر جنگلی شامل قارچ و برگ‌های برجسته، کف صاف و جزئیات نرم",
  },
  "fairy-silicone-mold-handmade": {
    title: "قالب پری — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با طرح پری؛ بال‌های ظریف و حالت پرواز برای تزئین کیک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت پری با بال‌های ظریف برجسته و دامن موج‌دار، کف صاف",
  },
  "happy-birthday-silicone-mold-handmade": {
    title: "قالب «تولدت مبارک» — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با نوشته و عناصر جشن تولد؛ حروف و توپ‌های برجسته برای کیک تولد. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت با نوشتهٔ تولد و عناصر جشن برجسته، حروف تمیز و کف صاف",
  },
  "princess-silicone-mold-handmade": {
    title: "قالب پرنسس — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با طرح پرنسس؛ تاج و لباس مجلسی برای کیک‌های قصه‌ای. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت پرنسس با تاج و لباس مجلسی برجسته، جزئیات نرم و کف صاف",
  },
  "castle-silicone-mold-handmade": {
    title: "قالب قلعه — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با طرح قلعه افسانه‌ای؛ برج‌ها و پرچم‌های برجسته برای کیک قصه‌ای. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت قلعه با برج‌ها و دیوارهای برجسته، جزئیات معماری نرم و کف صاف",
  },
  "party-bears-silicone-mold-handmade": {
    title: "قالب جشن تدی‌بیرها — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با تدی‌بیرهای جشن‌گیر؛ کلاه و بادکنک برای کیک تولد کودک. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت تدی‌بیرهای در حال جشن با کلاک و بادکنک، جزئیات برجستهٔ نرم",
  },
  "space-silicone-mold-handmade": {
    title: "قالب عناصر فضایی — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با عناصر فضایی؛ سیارات، ستاره‌ها و موشک برای کیک کهکشانی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت با سیارات و ستاره‌های برجسته، جزئیات نرم و کف صاف",
  },
  "astronaut-silicone-mold-handmade": {
    title: "قالب فضانورد — شکلات و فوندانت",
    description:
      "قالب سیلیکونی تخت با طرح فضانورد؛ کلاه خلبان و لباس فضایی برای کیک تولد فضایی. منبع الهام: Avaler Molds.",
    seedPrompt:
      "قالب سیلیکونی تخت فضانورد با کلاه شیشه‌ای و جزئیات لباس فضایی برجسته، کف صاف",
  },
};

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(raw);
    if (match) args[match[1]] = match[2] ?? "true";
  }
  return args;
}

/** Read SEED_SECRET from .env.local (never printed). */
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

  const catalog = JSON.parse(readFileSync(path.join(process.cwd(), catalogPath), "utf8"));
  const products = (catalog.products ?? []).filter(
    (p) => !SKIP_TYPES.has(p.product_type ?? ""),
  );

  const missing = products.filter((p) => !PERSIAN[p.handle]);
  if (missing.length > 0) {
    console.error(`No Persian metadata for handle(s): ${missing.map((p) => p.handle).join(", ")}`);
    process.exit(1);
  }

  console.log(`Importing ${products.length} Avaler Molds product(s) -> ${base}/api/library/import`);
  let ok = 0, skipped = 0, failed = 0;
  for (const [index, product] of products.entries()) {
    const fa = PERSIAN[product.handle];
    const image = (product.images ?? []).find((i) => i.position === 1) ?? (product.images ?? [])[0];
    const tag = `[${index + 1}/${products.length}] ${fa.title}`;
    if (!image?.src) {
      failed += 1;
      console.log(`${tag} — FAIL no image in catalog`);
      continue;
    }
    if (dryRun) {
      console.log(`${tag} — would import ${image.src}`);
      continue;
    }
    process.stdout.write(`${tag} … `);
    try {
      const res = await fetch(`${base}/api/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-seed-key": secret },
        body: JSON.stringify({
          category: CATEGORY,
          title: fa.title,
          description: fa.description,
          seedPrompt: fa.seedPrompt,
          material: MATERIAL,
          imageUrl: image.src,
          source: {
            site: "Avaler Molds",
            url: `https://avalermolds.com/products/${product.handle}`,
            handle: product.handle,
            productId: String(product.id),
            price: product.variants?.[0]?.price,
            currency: "USD",
            productType: product.product_type ?? undefined,
          },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) ?? {};
      if (res.ok && data.imageId && data.skipped) {
        skipped += 1;
        console.log(`SKIPPED (${data.imageId})`);
      } else if (res.ok && data.imageId) {
        ok += 1;
        console.log(`OK (${data.imageId})`);
      } else {
        failed += 1;
        console.log(`FAIL ${res.status} ${data.error ?? ""} ${data.message ?? ""}`.trim());
      }
    } catch (err) {
      failed += 1;
      console.log(`FAIL ${err?.message ?? err}`);
    }
  }

  console.log(`Done: ${ok} imported, ${skipped} skipped, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
