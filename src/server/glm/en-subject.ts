import OpenAI from "openai";

/**
 * English subject hint for image generation (2026-10-08). The shrine brief
 * rendered as a Persian text document in every slot until the prompt carried
 * an English object phrase — Qwen's visual concept for Persian religious/
 * architectural wording maps to documents (calligraphy prior), while the
 * same concept in English maps to building imagery. The probe
 * (scripts/probe-shrine-text-mode.mts) isolated this as the decisive lever.
 *
 * No "server-only" here so the reliability scripts can import it; routes are
 * still the only callers in the app. Free text model, thinking disabled.
 */

const HINT_PROMPT = `Name the physical subject of this Persian product-design brief as ONE short English phrase for an image generator — a photographable physical object (examples: "a giraffe figurine maquette", "a shrine building miniature model", "a flower-vase decor object"). Output ONLY the phrase, nothing else.

Brief:
`;

export async function enSubjectHint(brief: string): Promise<string | null> {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey || !brief.trim()) return null;
  try {
    const client = new OpenAI({
      apiKey,
      baseURL: "https://api.z.ai/api/paas/v4",
    });
    const res = (await client.chat.completions.create({
      model: process.env.GLM_CHAT_MODEL ?? "glm-4.5-flash",
      temperature: 0,
      max_tokens: 40,
      messages: [{ role: "user", content: HINT_PROMPT + brief.trim() }],
      // GLM extension absent from the OpenAI types (same cast as the chat route).
      thinking: { type: "disabled" },
    } as Parameters<typeof client.chat.completions.create>[0])) as unknown as {
      choices: { message?: { content?: string } }[];
    };
    const phrase = (res.choices[0]?.message?.content ?? "")
      .replace(/["'`*]/g, "")
      .trim()
      .slice(0, 120);
    return phrase || null;
  } catch {
    return null; // degrade honestly — the prompt works without the hint for known subjects
  }
}
