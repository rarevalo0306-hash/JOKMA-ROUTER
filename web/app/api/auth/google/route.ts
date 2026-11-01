import { randomUrlToken } from "@/lib/encoding";
import { readEnv } from "@/lib/env";
import {
  codeChallenge,
  googleCallbackUrl,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  panelOrigin,
} from "@/lib/google";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const origin = panelOrigin(readEnv("AUTH_URL"), new URL(request.url).origin);
  const clientId = readEnv("AUTH_GOOGLE_ID");
  const clientSecret = readEnv("AUTH_GOOGLE_SECRET");
  if (!clientId || !clientSecret || !readEnv("AUTH_SECRET")) {
    return NextResponse.redirect(new URL("/login?error=config", origin));
  }

  const state = randomUrlToken();
  const verifier = randomUrlToken(48);
  const challenge = await codeChallenge(verifier);
  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.searchParams.set("client_id", clientId);
  google.searchParams.set("redirect_uri", googleCallbackUrl(origin));
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", "openid email profile");
  google.searchParams.set("state", state);
  google.searchParams.set("code_challenge", challenge);
  google.searchParams.set("code_challenge_method", "S256");
  google.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(google);
  const secure = origin.startsWith("https://");
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 600 };
  response.cookies.set({ name: OAUTH_STATE_COOKIE, value: state, ...cookie });
  response.cookies.set({ name: OAUTH_VERIFIER_COOKIE, value: verifier, ...cookie });
  return response;
}
