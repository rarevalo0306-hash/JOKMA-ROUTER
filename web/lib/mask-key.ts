/** List view. The raw ak_ token is never reconstructed from the stored prefix. */
export function maskApiKey(prefix: string): string {
  if (prefix.startsWith("ak_")) return "ak_…";
  if (!prefix) return "••••";
  return `${prefix.slice(0, 3)}…`;
}
