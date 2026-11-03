import assert from "node:assert/strict";
import test from "node:test";
import { maskApiKey } from "./mask-key.ts";

test("a stored prefix never comes back as a usable key", () => {
  assert.equal(maskApiKey("ak_abc123xyz"), "ak_…");
  assert.equal(maskApiKey(""), "••••");
  assert.equal(maskApiKey("sk-secret"), "sk-…");
});
