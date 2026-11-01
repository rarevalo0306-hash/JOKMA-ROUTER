import assert from "node:assert/strict";
import test from "node:test";
import { readSession, signSession } from "./session.ts";

const secret = "test-secret-value";

test("a signed session round-trips the email", async () => {
  const token = await signSession("rarevalo0306@gmail.com", secret, 1_700_000_000_000);
  const session = await readSession(token, secret, 1_700_000_000_000);
  assert.deepEqual(session, { email: "rarevalo0306@gmail.com" });
});

test("a tampered session is rejected", async () => {
  const token = await signSession("rarevalo0306@gmail.com", secret, 1_700_000_000_000);
  const [payload, sig] = token.split(".");
  const flipped = `${payload}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
  assert.equal(await readSession(flipped, secret, 1_700_000_000_000), null);
});

test("an expired session is rejected", async () => {
  const token = await signSession("rarevalo0306@gmail.com", secret, 1_700_000_000_000);
  assert.equal(await readSession(token, secret, 1_700_000_000_000 + 8 * 24 * 60 * 60 * 1000), null);
});

test("missing secret or token is rejected", async () => {
  assert.equal(await readSession(undefined, secret), null);
  assert.equal(await readSession("abc.def", undefined), null);
  assert.equal(await readSession("abc.def", ""), null);
});
