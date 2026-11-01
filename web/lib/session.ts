import { base64UrlToBytes, bytesToBase64Url } from "./encoding.ts";

export const SESSION_COOKIE = "jokma_panel_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function signSession(email: string, secret: string, now = Date.now()): Promise<string> {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify({ email: email.trim().toLowerCase(), exp: now + SESSION_TTL_MS })),
  );
  const signature = bytesToBase64Url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

export async function readSession(
  token: string | undefined,
  secret: string | undefined,
  now = Date.now(),
): Promise<{ email: string } | null> {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  let expected: Uint8Array;
  let actual: Uint8Array;
  try {
    expected = await hmac(secret, payload);
    actual = base64UrlToBytes(signature);
  } catch {
    return null;
  }
  if (!sameBytes(expected, actual)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as {
      email?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.email !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp <= now) return null;
    return { email: parsed.email };
  } catch {
    return null;
  }
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return undefined;
}
