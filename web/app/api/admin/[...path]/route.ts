import { apiBase, readEnv } from "@/lib/env";

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: Context) {
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
