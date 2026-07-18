// Signaling authentication for the SFU.
//
// Peers pass a token as a `?token=` query parameter on the signaling
// WebSocket URL. The SFU verifies it and derives a role:
//
//   "guest"  no token (or a token whose role claim says so). May consume
//            non-protected streams and produce "<label>/requests" channels.
//   "admin"  may consume every stream (protected included). Protected rpc
//            methods are enforced robot-side from the role the SFU stamps
//            into the requests channel's appData.
//   "robot"  everything admins can, plus producing streams. The robot's
//            long-lived / client-credentials token carries role "robot".
//
// When no auth is configured (no secret, no verifyToken) every peer gets
// role "robot" — the pre-auth behavior, everything allowed.
//
// The built-in verifier accepts HS256 JWTs signed with a shared secret
// (PROTO4WEBRTC_AUTH_SECRET or config.auth.secret) whose payload carries a
// `role` claim; `exp`/`nbf` are honored when present. Any other scheme
// (RS256, an IdP, opaque session tokens) plugs in via config.auth.verifyToken.

import { createHmac, timingSafeEqual } from "node:crypto";

export type Role = "guest" | "admin" | "robot";

export interface TokenClaims {
  role: Role;
  [claim: string]: unknown;
}

/** Return the verified claims, or throw to reject the connection. */
export type VerifyToken = (token: string) => TokenClaims | Promise<TokenClaims>;

export interface AuthConfig {
  /** HS256 shared secret for the built-in JWT verifier. Default: env PROTO4WEBRTC_AUTH_SECRET. */
  secret?: string;
  /** Custom verifier; overrides the built-in one. Throw to reject. */
  verifyToken?: VerifyToken;
}

const ROLES: readonly string[] = ["guest", "admin", "robot"];

function b64url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Verify an HS256 JWT and return its claims. Throws on any failure. */
export function verifyJwtHs256(token: string, secret: string): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(b64url(headerB64).toString("utf8"));
  if (header.alg !== "HS256") throw new Error(`unsupported alg: ${header.alg}`);

  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = b64url(signatureB64);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("bad signature");

  const claims = JSON.parse(b64url(payloadB64).toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && now >= claims.exp)
    throw new Error("token expired");
  if (typeof claims.nbf === "number" && now < claims.nbf)
    throw new Error("token not yet valid");
  if (!ROLES.includes(claims.role))
    throw new Error(`missing or invalid role claim: ${claims.role}`);
  return claims as TokenClaims;
}

/** True when the config enables auth (otherwise every peer is "robot"). */
export function authEnabled(auth: AuthConfig): boolean {
  return !!(auth.secret || auth.verifyToken);
}

/**
 * Resolve a peer's role from the token on its signaling URL. No token means
 * guest (when auth is enabled) or robot (when it isn't). Throws — rejecting
 * the connection — when a token is present but fails verification.
 */
export async function resolveRole(
  auth: AuthConfig,
  token: string | undefined,
): Promise<Role> {
  if (!authEnabled(auth)) return "robot";
  if (!token) return "guest";
  const verify =
    auth.verifyToken ?? ((t: string) => verifyJwtHs256(t, auth.secret!));
  const claims = await verify(token);
  if (!ROLES.includes(claims.role))
    throw new Error(`missing or invalid role claim: ${claims.role}`);
  return claims.role;
}

/** Extract the `token` query parameter from a WebSocket upgrade request URL. */
export function tokenFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const query = url.split("?", 2)[1];
  if (!query) return undefined;
  return new URLSearchParams(query).get("token") ?? undefined;
}
