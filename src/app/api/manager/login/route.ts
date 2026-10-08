import { NextResponse } from "next/server";
import {
  clearManagerCookie,
  managerConfigured,
  setManagerCookie,
  verifyPassword,
} from "@/server/manager/auth";

/** POST /api/manager/login — env-password gate (ticket 15). */
export async function POST(req: Request) {
  if (!managerConfigured()) {
    return NextResponse.json(
      { error: "manager_not_configured" },
      { status: 503 },
    );
  }
  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!verifyPassword(body.password)) {
    return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  }
  await setManagerCookie(body.password as string);
  return NextResponse.json({ ok: true });
}

/** DELETE /api/manager/login — sign out. */
export async function DELETE() {
  await clearManagerCookie();
  return NextResponse.json({ ok: true });
}
