import { readEnv } from "@/lib/env";
import { panelOrigin } from "@/lib/google";
import { SESSION_COOKIE } from "@/lib/session";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const origin = panelOrigin(readEnv("AUTH_URL"), new URL(request.url).origin);
  const response = NextResponse.redirect(new URL("/login", origin), 303);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/",
    maxAge: 0,
  });
  return response;
}
