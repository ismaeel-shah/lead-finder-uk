/**
 * Optional single-password protection (APP_PASSWORD). Uses Web Crypto only,
 * so it runs in both the Edge middleware and Node route handlers.
 *
 * The session cookie holds HMAC-SHA256(APP_PASSWORD, fixed label): it proves
 * the holder knew the password without storing it, and changing the password
 * invalidates every existing session.
 */

export const SESSION_COOKIE = "lf_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_LABEL = "lead-finder-session-v1";

export function appPassword(): string | null {
  const value = process.env.APP_PASSWORD?.trim();
  return value ? value : null;
}

export async function sessionToken(password: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(SESSION_LABEL));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison (length is not secret here). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(cookieValue: string | undefined, password: string): Promise<boolean> {
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await sessionToken(password));
}

/** Only allow redirects back to paths on this site. */
export function safeNextPath(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
