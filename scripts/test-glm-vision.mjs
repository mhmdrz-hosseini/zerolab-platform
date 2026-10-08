// Probe: which GLM models this key can call with an image_url part.
// Usage: node scripts/test-glm-vision.mjs [model ...]
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
const key = (env.match(/^GLM_API_KEY=(.+)$/m) || [])[1];
if (!key) {
  console.error("GLM_API_KEY not found in .env.local");
  process.exit(1);
}

// Small public test image (weserv proxy of a Wikimedia file) — the same
// host library seeds use.
const IMG =
  "https://images.weserv.nl/?url=upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/300px-PNG_transparency_demonstration_1.png";

const defaults = [
  "glm-4.5-flash",
  "glm-4.5v",
  "glm-4v-flash",
  "glm-4.6v",
  "glm-4.1v-thinking-flash",
];
const models = process.argv.slice(2);
const list = models.length > 0 ? models : defaults;

for (const model of list) {
  process.stdout.write(model + ": ");
  try {
    const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key.trim(),
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "In one short sentence, what is in this image?" },
              { type: "image_url", image_url: { url: IMG } },
            ],
          },
        ],
        max_tokens: 100,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = (data && data.error) || {};
      console.log("HTTP " + res.status + " — " + (err.code || "") + " " + String(err.message || JSON.stringify(data)).slice(0, 160));
      continue;
    }
    const choices = data.choices || [];
    const content = (choices[0] && choices[0].message && choices[0].message.content) || JSON.stringify(data).slice(0, 120);
    console.log("OK — " + String(content).slice(0, 120).replace(/\n/g, " "));
  } catch (err) {
    console.log("FETCH FAILED — " + err.message);
  }
}
