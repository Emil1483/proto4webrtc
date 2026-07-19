import { NextRequest, NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/config/auth";
import { isAuthConfigured, verifySessionToken } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return NextResponse.json({
    authenticated: verifySessionToken(token),
    // The UI hides the Login button when auth isn't configured.
    authConfigured: isAuthConfigured(),
  });
}
