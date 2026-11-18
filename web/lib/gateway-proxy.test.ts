import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { forwardGateway } from "./gateway-proxy.ts";

test("the SDK proxy streams chat, forwards the gateway bearer, and preserves backend errors", async (t) => {
  const oldBase = process.env.API_INTERNAL_URL;
  let finishStream = () => {};
  const server = createServer(async (request, response) => {
    if (request.url === "/v1/models") {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "invalid_api_key" } }));
      return;
    }
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer ak_local_test");
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers["x-panel-secret"], undefined);
    let text = "";
    for await (const chunk of request) text += chunk;
    assert.equal(JSON.parse(text).model, "local/demo");
    response.writeHead(200, { "content-type": "text/event-stream", "x-jokma-model-served": "local/demo" });
    response.write("data: first\n\n");
    finishStream = () => response.end("data: [DONE]\n\n");
  });
  server.listen(0, "127.0.0.1");
  t.after(() => {
    finishStream();
    server.closeAllConnections();
    server.close();
    if (oldBase === undefined) delete process.env.API_INTERNAL_URL;
    else process.env.API_INTERNAL_URL = oldBase;
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.API_INTERNAL_URL = `http://127.0.0.1:${address.port}`;
  const request = new Request("http://panel/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer ak_local_test",
      cookie: "jokma_panel_session=local-session",
      "x-panel-secret": "local-only",
    },
    body: JSON.stringify({ model: "local/demo", stream: true }),
  });
  const response = await forwardGateway(request, "/v1/chat/completions");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-jokma-model-served"), "local/demo");
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: first\n\n");
  finishStream();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "data: [DONE]\n\n");
  assert.equal((await reader.read()).done, true);
  const denied = await forwardGateway(new Request("http://panel/v1/models"), "/v1/models");
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: { code: "invalid_api_key" } });
});
