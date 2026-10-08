import OpenAI from "openai";
import "server-only";

export const GLM_BASE_URL = "https://api.z.ai/api/paas/v4";
export const GLM_CHAT_MODEL = "glm-4.5-flash";
/** Vision-capable sibling used when the transcript carries image parts. */
export const GLM_VISION_MODEL = process.env.GLM_VISION_MODEL ?? "glm-4.6v-flash";

/**
 * Server-only Z.ai GLM client (OpenAI-compatible). Reads GLM_API_KEY from
 * the environment — never import this module from client code.
 *
 * Powers the Persian ideation chat since 2026-10-05 (Aval's account ran out
 * of credit). glm-4.5-flash is the only model this key can call — the rest
 * of the lineup returns 1113 "Insufficient balance or no resource package".
 * It is a thinking model; the chat route disables thinking for latency
 * (`thinking: { type: "disabled" }` — "enabled"/"disabled" are accepted
 * here, unlike glm-5.3-flash which always thinks).
 *
 * Vision (2026-10-08): glm-4.5-flash rejects image parts (1210 — text only).
 * glm-4.5v/glm-4.6v exist but need a paid package (1113). glm-4.6v-flash
 * accepts the routing but was saturated with 1305 during probing — the chat
 * route uses it for image turns and degrades honestly to the text model
 * when it is unavailable (override with GLM_VISION_MODEL).
 */
export function getGlmClient(): OpenAI {
  const apiKey = process.env.GLM_API_KEY;
  if (!apiKey) throw new Error("GLM_API_KEY is not set");
  return new OpenAI({ apiKey, baseURL: GLM_BASE_URL });
}
