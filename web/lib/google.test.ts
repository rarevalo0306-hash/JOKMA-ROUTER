import assert from "node:assert/strict";
import test from "node:test";
import { codeChallenge, emailFromGoogleClaims, googleCallbackUrl, panelOrigin } from "./google.ts";

test("the callback URL is the public panel origin", () => {
  assert.equal(
    googleCallbackUrl("https://router.jokma.app"),
    "https://router.jokma.app/api/auth/callback/google",
  );
  assert.equal(
    googleCallbackUrl("https://router.jokma.app/"),
    "https://router.jokma.app/api/auth/callback/google",
  );
});

test("AUTH_URL wins over the request host", () => {
  assert.equal(
    panelOrigin("https://router.jokma.app", "https://jokma-router.vercel.app"),
    "https://router.jokma.app",
  );
  assert.equal(panelOrigin(undefined, "http://localhost:3000"), "http://localhost:3000");
});

test("PKCE S256 matches the RFC 7636 vector", async () => {
  const challenge = await codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
  assert.equal(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
});

test("only a verified Google email for this client is accepted", () => {
  const now = 1_700_000_000;
  const good = {
    iss: "https://accounts.google.com",
    aud: "client-id",
    email: "rarevalo0306@gmail.com",
    email_verified: true,
    exp: now + 60,
  };
  assert.equal(emailFromGoogleClaims(good, "client-id", now), "rarevalo0306@gmail.com");
  assert.equal(emailFromGoogleClaims({ ...good, email_verified: false }, "client-id", now), null);
  assert.equal(emailFromGoogleClaims({ ...good, aud: "other" }, "client-id", now), null);
  assert.equal(emailFromGoogleClaims({ ...good, iss: "https://evil.example" }, "client-id", now), null);
  assert.equal(emailFromGoogleClaims({ ...good, exp: now - 1 }, "client-id", now), null);
  assert.equal(emailFromGoogleClaims({ ...good, email: "" }, "client-id", now), null);
});
