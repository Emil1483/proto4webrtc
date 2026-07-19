// Signaling authorization for the example — the app's job, not the SFU's.
//
// proto4webrtc's SFU never authenticates: it enforces a Role that the host
// application resolves. This module is that resolver. Two kinds of peer, told
// apart by how they present credentials on the WS upgrade (the browser
// WebSocket API can't set headers, so the two differ):
//
//   robot   -> "Authorization: Bearer <ROBOT_TOKEN>" header. A backend peer
//              with a shared secret; only it may produce streams.
//   browser -> a session cookie set by the shared-password login (see
//              lib/session.ts + /api/login). Logged in -> admin (sees
//              protected streams); not logged in -> guest (denied them).
//
// The proto4webrtc *library* runs without auth by default. This *example*
// deliberately does not: it requires AUTH_PASSWORD and ROBOT_TOKEN and throws
// a clear error if either is missing, rather than silently granting everyone
// full access. Set them (see .env.example) to run it.

import crypto from "crypto";

import { Role } from "proto4webrtc";

import { SESSION_COOKIE } from "@/config/auth";
import { verifySessionToken } from "@/lib/session";

/** Read a required auth env var, or throw a message that says how to fix it. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[auth] ${name} is not set. This example enforces authentication and ` +
        `needs AUTH_PASSWORD (browser login) and ROBOT_TOKEN (robot peer). ` +
        `Set them in server/.env (see deploy/.env.example), or remove this ` +
        `resolver and pass Role.ROBOT to handleWSClient to run without auth.`,
    );
  }
  return value;
}

function bearerToken(headers: Headers): string | undefined {
  const auth = headers.get("authorization");
  return auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;
}

function sessionCookie(headers: Headers): string | undefined {
  const cookie = headers.get("cookie");
  const match = cookie?.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  );
  return match ? decodeURIComponent(match[1]) : undefined;
}

function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Resolve a peer's Role from its signaling upgrade request headers. Returns
 * undefined to reject the connection (a robot token was supplied but wrong).
 * Throws if the required auth env vars are missing (see `required`).
 */
export function resolveRole(headers: Headers): Role | undefined {
  // Fail loud if the deployment forgot to configure auth.
  const robotToken = required("ROBOT_TOKEN");
  required("AUTH_PASSWORD");

  const bearer = bearerToken(headers);
  if (bearer !== undefined) {
    // Robot peer: the shared secret must match.
    return tokensMatch(bearer, robotToken) ? Role.ROBOT : undefined;
  }

  // Browser peer: logged in -> admin, otherwise guest.
  return verifySessionToken(sessionCookie(headers)) ? Role.ADMIN : Role.GUEST;
}
