import crypto from "crypto";

import { SESSION_MAX_AGE_SECONDS } from "@/config/auth";

// Signed session tokens for the single shared-password login (browser side).
// A token is `<payload>.<signature>` where payload is base64url(JSON {exp})
// and signature is an HMAC-SHA256 of the payload keyed by the server secret.
// Self-contained: verifying needs only the secret, no server-side store.

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length > 0) return secret;

  // Fall back to a key derived from the password so a single AUTH_PASSWORD is
  // enough to get running in dev. Set AUTH_SECRET explicitly in production so
  // rotating the password doesn't silently invalidate the derivation logic.
  const password = process.env.AUTH_PASSWORD;
  if (password) {
    console.warn(
      "[auth] AUTH_SECRET not set; deriving the signing key from AUTH_PASSWORD. " +
        "Set AUTH_SECRET in production.",
    );
    return crypto
      .createHash("sha256")
      .update(`proto4webrtc:${password}`)
      .digest("hex");
  }

  throw new Error(
    "AUTH_SECRET or AUTH_PASSWORD must be set to sign session tokens",
  );
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
}

/** True when a shared password is configured; login is otherwise impossible. */
export function isAuthConfigured(): boolean {
  return !!process.env.AUTH_PASSWORD;
}

/** Constant-time comparison of the submitted password against AUTH_PASSWORD. */
export function checkPassword(input: string): boolean {
  const expected = process.env.AUTH_PASSWORD ?? "";
  if (expected === "") return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch; length itself is not secret.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function createSessionToken(nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return false;

  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp * 1000 > nowMs;
  } catch {
    return false;
  }
}
