export const DEFAULT_ALLOWED_EMAIL = "rarevalo0306@gmail.com";

/** Comma, semicolon, or whitespace separated addresses. Unset means the owner only. */
export function parseAllowlist(raw: string | undefined): string[] {
  if (raw === undefined) return [DEFAULT_ALLOWED_EMAIL];
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string | null | undefined, raw?: string): boolean {
  if (!email) return false;
  return parseAllowlist(raw).includes(email.trim().toLowerCase());
}
