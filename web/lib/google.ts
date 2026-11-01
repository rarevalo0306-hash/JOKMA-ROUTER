import { bytesToBase64Url } from "./encoding.ts";

export const OAUTH_STATE_COOKIE = "jokma_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "jokma_oauth_verifier";

const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export function panelOrigin(authUrl: string | undefined, requestOrigin: string): string {
  const configured = authUrl?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return requestOrigin.replace(/\/$/, "");
}

export function googleCallbackUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/callback/google`;
}

export async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function emailFromGoogleClaims(
  payload: Record<string, unknown>,
  clientId: string,
  nowSec = Math.floor(Date.now() / 1000),
): string | null {
  if (!ISSUERS.has(String(payload.iss))) return null;
  const aud = payload.aud;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(clientId)) return null;
  if (payload.email_verified !== true && payload.email_verified !== "true") return null;
  if (typeof payload.exp !== "number" || payload.exp <= nowSec) return null;
  if (typeof payload.email !== "string" || !payload.email.includes("@")) return null;
  return payload.email;
}
