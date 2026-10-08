import OpenAI from "openai";
import "server-only";

export const AVAL_BASE_URL = "https://api.avalai.ir/v1";
export const AVAL_CHAT_MODEL = "deepseek-v4.1-flash";

/**
 * Server-only AvalAI client (OpenAI-compatible). Reads AVAL_API_KEY from the
 * environment — never import this module from client code.
 */
export function getAvalClient(): OpenAI {
  const apiKey = process.env.AVAL_API_KEY;
  if (!apiKey) throw new Error("AVAL_API_KEY is not set");
  return new OpenAI({ apiKey, baseURL: AVAL_BASE_URL });
}
