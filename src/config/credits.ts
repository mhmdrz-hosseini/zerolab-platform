/**
 * Credit economics for lab-v1 — the ONLY place these numbers live.
 * Values are placeholders until pricing is tuned; feature slices must
 * import from here instead of hard-coding costs.
 */

export const COSTS = {
  chat: 1,
  image: 5,
  /** Tripo H3.1 detailed ≈ $0.40 — see issue 05-grilling-credit-economics. */
  threed: 40,
} as const;

export const FREE_GRANT = {
  chat: 30,
  image: 8,
  threed: 1,
} as const;

export type CreditService = keyof typeof COSTS;

export const CREDIT_SERVICES = Object.keys(COSTS) as CreditService[];
