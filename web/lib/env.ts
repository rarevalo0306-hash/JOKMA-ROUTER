/** Read at request time. Bracket access avoids Next inlining an empty build-time value. */
export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function apiBase(): string {
  return (readEnv("API_INTERNAL_URL") || "http://127.0.0.1:8000").replace(/\/$/, "");
}
