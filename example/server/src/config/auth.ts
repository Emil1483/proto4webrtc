// Auth constants shared between the browser and the server. NO secrets here —
// this module is imported from client code. Secret handling lives in
// src/lib/session.ts (server-only).

export const SESSION_COOKIE = "proto4webrtc_auth";

// How long a login lasts. 7 days, matching the cookie Max-Age and the token exp.
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
