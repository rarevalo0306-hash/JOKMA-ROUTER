import { apiBase } from "./env.ts";

export async function forwardGateway(request: Request, endpoint: "/v1/models" | "/v1/chat/completions") {
  const headers = new Headers();
  for (const name of ["authorization", "content-type", "accept"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers,
      cache: "no-store",
      redirect: "error",
      signal: request.signal,
    };
    if (request.body) {
      init.body = request.body;
      init.duplex = "half";
    }
    const upstream = await fetch(apiBase() + endpoint, init);
    const responseHeaders = new Headers({ "cache-control": "no-store" });
    for (const name of ["content-type", "x-jokma-model-served", "x-jokma-fallback", "x-accel-buffering", "retry-after", "www-authenticate"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      { error: { message: "No se pudo conectar con la API del router.", type: "server_error", code: "gateway_unavailable" } },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
