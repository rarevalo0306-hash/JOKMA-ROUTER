import { isAllowedEmail } from "./allowlist.ts";

export type Gate = "allow" | "login" | "unauthorized" | "dashboard";

export function gateDecision(
  pathname: string,
  email: string | null | undefined,
  allowlist?: string,
): Gate {
  if (pathname === "/v1/models" || pathname === "/v1/chat/completions") return "allow";
  if (pathname === "/api/auth" || pathname.startsWith("/api/auth/")) return "allow";
  const allowed = isAllowedEmail(email, allowlist);
  if (pathname === "/login") return allowed ? "dashboard" : "allow";
  if (!allowed) {
    if (pathname === "/api" || pathname.startsWith("/api/")) return "unauthorized";
    return "login";
  }
  return "allow";
}
