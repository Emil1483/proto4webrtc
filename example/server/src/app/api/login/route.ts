import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/config/auth";
import {
  checkPassword,
  createSessionToken,
  isAuthConfigured,
} from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured on the server (AUTH_PASSWORD unset)." },
      { status: 500 },
    );
  }

  let password = "";
  try {
    const body = await request.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!checkPassword(password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
