import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readEnv } from "@/lib/env";
import { gateDecision } from "@/lib/gate";
import { panelOrigin } from "@/lib/google";
import { readSession, SESSION_COOKIE } from "@/lib/session";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSession(token, readEnv("AUTH_SECRET"));
  const decision = gateDecision(
    request.nextUrl.pathname,
    session?.email,
    readEnv("PANEL_ALLOWED_EMAILS"),
  );
  const origin = panelOrigin(readEnv("AUTH_URL"), request.nextUrl.origin);
  if (decision === "login") return NextResponse.redirect(new URL("/login", origin));
  if (decision === "dashboard") return NextResponse.redirect(new URL("/proveedores", origin));
  if (decision === "unauthorized") {
    return NextResponse.json({ detail: "No autorizado" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
