import assert from "node:assert/strict";
import test from "node:test";
import { chatRoutableProviders, groupProviders, providerTitle } from "./provider-groups.ts";
import type { Provider } from "./types.ts";

function provider(overrides: Partial<Provider> & Pick<Provider, "name">): Provider {
  return {
    id: overrides.name,
    adapter: "openai",
    base_url: "https://example.test/v1",
    enabled: true,
    has_api_key: false,
    api_key_last4: null,
    key_url: "https://example.test/keys",
    label: null,
    kind: "chat",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

test("preset cards keep chat and video in catalog order", () => {
  const grouped = groupProviders([
    provider({ name: "local", adapter: "ollama", label: null, key_url: null }),
    provider({ name: "hailuo", adapter: "video", kind: "video", label: "MiniMax Hailuo" }),
    provider({ name: "openai", label: "OpenAI" }),
    provider({ name: "dashscope", label: "DashScope Qwen" }),
    provider({ name: "veo", adapter: "video", kind: "video", label: "Google Veo" }),
  ]);
  assert.deepEqual(grouped.chat.map((item) => item.name), ["openai", "dashscope"]);
  assert.deepEqual(grouped.video.map((item) => item.name), ["veo", "hailuo"]);
  assert.deepEqual(grouped.rest.map((item) => item.name), ["local"]);
  assert.equal(providerTitle(grouped.video[0]), "Google Veo");
});

test("video providers stay out of the chat model picker", () => {
  const providers = [
    provider({ name: "groq" }),
    provider({ name: "sora", adapter: "video", kind: "video" }),
  ];
  assert.deepEqual(
    chatRoutableProviders(providers).map((item) => item.name),
    ["groq"],
  );
});
