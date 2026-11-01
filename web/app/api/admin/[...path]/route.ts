import { isAllowedEmail } from "@/lib/allowlist";
import { apiBase, readEnv } from "@/lib/env";
import { readCookie, readSession, SESSION_COOKIE } from "@/lib/session";

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: Context) {
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  const session = await readSession(token, readEnv("AUTH_SECRET"));
  if (!session || !isAllowedEmail(session.email, readEnv("PANEL_ALLOWED_EMAILS"))) {
    return Response.json({ detail: "No autorizado" }, { status: 401 });
  }
  const key = readEnv("ADMIN_API_KEY");
  if (!key) {
    return Response.json(
      { detail: "ADMIN_API_KEY is not configured" },
      { status: 500 },
    );
  }
  const { path } = await context.params;
  const incoming = new URL(request.url);
  const target = `${apiBase()}/admin/${path.join("/")}${incoming.search}`;
  const headers = new Headers();
  headers.set("authorization", `Bearer ${key}`);
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const init: RequestInit = { method: request.method, headers, cache: "no-store" };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.text();
  }
  try {
    const response = await fetch(target, init);
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return Response.json({ detail: "API unreachable" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
