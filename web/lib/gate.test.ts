import assert from "node:assert/strict";
import test from "node:test";
import { gateDecision } from "./gate.ts";

const owner = "rarevalo0306@gmail.com";

test("anonymous visitors are sent to the login page", () => {
  assert.equal(gateDecision("/proveedores", null), "login");
  assert.equal(gateDecision("/", undefined), "login");
  assert.equal(gateDecision("/login", null), "allow");
});

test("admin proxy routes reject anonymous callers", () => {
  assert.equal(gateDecision("/api/admin/providers", null), "unauthorized");
  assert.equal(gateDecision("/api/admin/models/1", undefined), "unauthorized");
});

test("the Google callback stays reachable without a session", () => {
  assert.equal(gateDecision("/api/auth/google", null), "allow");
  assert.equal(gateDecision("/api/auth/callback/google", null), "allow");
  assert.equal(gateDecision("/api/auth/signout", null), "allow");
});

test("an allowed session opens the panel and leaves the login page", () => {
  assert.equal(gateDecision("/proveedores", owner), "allow");
  assert.equal(gateDecision("/api/admin/providers", owner), "allow");
  assert.equal(gateDecision("/login", owner), "dashboard");
});

test("a signed-in address outside the allowlist is treated as logged out", () => {
  assert.equal(gateDecision("/modelos", "otra@gmail.com"), "login");
  assert.equal(gateDecision("/api/admin/keys", "otra@gmail.com"), "unauthorized");
});
