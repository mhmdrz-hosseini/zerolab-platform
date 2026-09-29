import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SERVICE_COOKIE, isServiceSlug } from "@/config/services";
import { getOrCreateSession } from "@/server/credits";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

interface ServiceBody {
  service?: string;
}

/**
 * Persist the service-world choice (issue 11).
 * The `zls_service` cookie is the lab context: /lab reads it to show the
 * selected world, and ticket 12 stamps `chats.service` from it when the
 * chat is created. The session cookie is anchored here so the choice and
 * the quota identity travel together.
 */
export async function POST(req: Request) {
  let body: ServiceBody;
  try {
    body = (await req.json()) as ServiceBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isServiceSlug(body.service)) {
    return NextResponse.json({ error: "invalid_service" }, { status: 400 });
  }

  await getOrCreateSession();
  const jar = await cookies();
  jar.set(SERVICE_COOKIE, body.service, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });

  return NextResponse.json({ ok: true, service: body.service });
}
