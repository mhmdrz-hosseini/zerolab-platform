import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import "server-only";

/**
 * Manager gate (mold-studio ticket 15) — env-password, no account system.
 * `zlm_auth` carries sha256(MANAGER_PASSWORD) as a constant token; every
 * /api/manager route verifies it before touching data. Dev-grade by design
 * (real auth arrives with the OTP/account phase).
 */

const COOKIE = "zlm_auth";

export function managerConfigured(): boolean {
  return !!process.env.MANAGER_PASSWORD;
}

function tokenFor(password: string): string {
  return createHash("sha256").update(`zlm:${password}`).digest("hex");
}

export function verifyPassword(password: unknown): boolean {
  const expected = process.env.MANAGER_PASSWORD;
  if (!expected || typeof password !== "string") return false;
  const a = Buffer.from(tokenFor(password));
  const b = Buffer.from(tokenFor(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Throws-free check for route handlers; returns a 401 NextResponse if bad. */
export async function requireManager(): Promise<NextResponse | null> {
  if (!managerConfigured()) {
    return NextResponse.json(
      { error: "manager_not_configured" },
      { status: 503 },
    );
  }
  const jar = await cookies();
  const got = jar.get(COOKIE)?.value;
  const expected = tokenFor(process.env.MANAGER_PASSWORD!);
  if (!got || got.length !== expected.length) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (
    !timingSafeEqual(Buffer.from(got), Buffer.from(expected))
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function setManagerCookie(password: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, tokenFor(password), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearManagerCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
