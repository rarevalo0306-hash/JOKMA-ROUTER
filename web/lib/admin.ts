import { apiBase, readEnv } from "@/lib/env";

export async function adminGet<T>(path: string): Promise<T> {
  const key = readEnv("ADMIN_API_KEY");
  if (!key) {
    throw new Error("Falta ADMIN_API_KEY en el servidor del panel.");
  }
  const response = await fetch(`${apiBase()}${path}`, {
    headers: { authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `La API respondió ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function apiOnline(): Promise<boolean> {
  try {
    const response = await fetch(`${apiBase()}/health`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}
