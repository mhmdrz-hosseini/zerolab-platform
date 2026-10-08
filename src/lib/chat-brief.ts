/**
 * Brief extraction for the image step (ticket 12 → 13 contract).
 *
 * The system prompt (ticket 06) makes the model end with a one-line
 * «کارت مشخصات طرح»: سوژهٔ هندسی | متریال نمایش | سبک | اندازه (cm) | جزئیات کلیدی.
 * `extractBrief` returns that line when present, otherwise falls back to
 * the last 10 messages concatenated. The result is emitted on
 * `lab:generate-image` as `{ brief, chatId }` for the image flow.
 */

/** The exact label the system prompt tells the model to write. */
export const SPEC_CARD_LABEL = "کارت مشخصات طرح";

export interface BriefMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Pull the spec-card line from the most recent assistant message that has
 * one; without it, concatenate the last 10 messages. Empty only when the
 * transcript carries no content at all.
 */
export function extractBrief(messages: readonly BriefMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "assistant") continue;
    const brief = specLineOf(message.content);
    if (brief) return brief;
  }
  return messages
    .slice(-10)
    .map((m) => m.content)
    .join("\n")
    .trim();
}

/** True once the model has written a spec card in the transcript. */
export function hasSpecCard(messages: readonly BriefMessage[]): boolean {
  return messages.some(
    (m) => m.role === "assistant" && m.content.includes(SPEC_CARD_LABEL),
  );
}

/** Text after the label on its line, else the following line. */
function specLineOf(content: string): string | null {
  const lines = content.split("\n");
  const at = lines.findIndex((line) => line.includes(SPEC_CARD_LABEL));
  if (at === -1) return null;

  const line = lines[at] ?? "";
  const afterLabel = stripDecorations(
    line.slice(line.indexOf(SPEC_CARD_LABEL) + SPEC_CARD_LABEL.length),
  );
  if (afterLabel) return afterLabel;

  return stripDecorations(lines[at + 1] ?? "") || null;
}

/** Drop label separators and markdown emphasis around the spec text. */
function stripDecorations(value: string): string {
  return value.replace(/^[\s:：\-–—*#»«]+/, "").trim();
}
