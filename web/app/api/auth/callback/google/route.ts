import { isAllowedEmail } from "@/lib/allowlist";
import { readEnv } from "@/lib/env";
import {
  emailFromGoogleClaims,
  googleCallbackUrl,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  panelOrigin,
} from "@/lib/google";
import { readCookie, SESSION_COOKIE, SESSION_TTL_MS, signSession } from "@/lib/session";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";

const googleCerts = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function sameString(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function fail(origin: string, error: "oauth" | "denied" | "config", secure: boolean) {
  const response = NextResponse.redirect(new URL(`/login?error=${error}`, origin));
  clearOauth(response, secure);
  return response;
}

function clearOauth(response: NextResponse, secure: boolean) {
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 0 };
  response.cookies.set({ name: OAUTH_STATE_COOKIE, value: "", ...cookie });
  response.cookies.set({ name: OAUTH_VERIFIER_COOKIE, value: "", ...cookie });
}

export async function GET(request: Request) {
  const origin = panelOrigin(readEnv("AUTH_URL"), new URL(request.url).origin);
  const secure = origin.startsWith("https://");
  const clientId = readEnv("AUTH_GOOGLE_ID");
  const clientSecret = readEnv("AUTH_GOOGLE_SECRET");
  const authSecret = readEnv("AUTH_SECRET");
  if (!clientId || !clientSecret || !authSecret) return fail(origin, "config", secure);

  const incoming = new URL(request.url);
  const code = incoming.searchParams.get("code");
  const state = incoming.searchParams.get("state");
  const cookie = request.headers.get("cookie");
  const expectedState = readCookie(cookie, OAUTH_STATE_COOKIE);
  const verifier = readCookie(cookie, OAUTH_VERIFIER_COOKIE);
  if (!code || !state || !expectedState || !verifier || !sameString(state, expectedState)) {
    return fail(origin, "oauth", secure);
  }

  let idToken = "";
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: googleCallbackUrl(origin),
      }),
      cache: "no-store",
    });
    if (!tokenResponse.ok) return fail(origin, "oauth", secure);
    const token = (await tokenResponse.json()) as { id_token?: unknown };
    if (typeof token.id_token !== "string") return fail(origin, "oauth", secure);
    idToken = token.id_token;
    const { payload } = await jwtVerify(idToken, googleCerts, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    const email = emailFromGoogleClaims(payload as Record<string, unknown>, clientId);
    if (!email) return fail(origin, "oauth", secure);
    if (!isAllowedEmail(email, readEnv("PANEL_ALLOWED_EMAILS"))) return fail(origin, "denied", secure);

    const response = NextResponse.redirect(new URL("/proveedores", origin));
    clearOauth(response, secure);
    response.cookies.set({
      name: SESSION_COOKIE,
      value: await signSession(email, authSecret),
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    return response;
  } catch {
    return fail(origin, "oauth", secure);
  }
}
