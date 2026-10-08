import { buildImagePrompt, buildStandardizePrompt } from "../src/lib/image-prompt";
import { writeFileSync } from "node:fs";

const brief = "قالب شمع سیلیکونی به شکل گربهٔ نشسته با حالت کارتونی دوست‌داشتنی";
const gen = buildImagePrompt(brief, { material: "موم شمع مات کرم‌رنگ" });
const std = buildStandardizePrompt(brief);
writeFileSync(new URL("../.scratch/zl-prompt-gen.txt", import.meta.url), gen);
writeFileSync(new URL("../.scratch/zl-prompt-std.txt", import.meta.url), std);
console.log("gen:", gen.length, "chars | std:", std.length, "chars");
console.log("--- new constraint lines present:",
  gen.includes("هیچ عنصر شناور یا جداشدهٔ معلق"),
  gen.includes("تور یا قاب بازِ ظریف"),
  gen.includes("پایهٔ مجزا"),
  std.includes("یک تکهٔ واحد و پیوسته"));
