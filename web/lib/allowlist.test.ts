import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedEmail, parseAllowlist } from "./allowlist.ts";

test("an unset allowlist admits only the owner", () => {
  assert.deepEqual(parseAllowlist(undefined), ["rarevalo0306@gmail.com"]);
  assert.equal(isAllowedEmail("rarevalo0306@gmail.com", undefined), true);
  assert.equal(isAllowedEmail("otra@gmail.com", undefined), false);
});

test("the allowlist is case-insensitive and splits on commas", () => {
  const raw = " Ana@Example.com, rarevalo0306@gmail.com ";
  assert.equal(isAllowedEmail("ana@example.com", raw), true);
  assert.equal(isAllowedEmail("RAREVALO0306@GMAIL.COM", raw), true);
  assert.equal(isAllowedEmail("no@example.com", raw), false);
});

test("an empty allowlist admits nobody", () => {
  assert.deepEqual(parseAllowlist("  "), []);
  assert.equal(isAllowedEmail("rarevalo0306@gmail.com", ""), false);
});
