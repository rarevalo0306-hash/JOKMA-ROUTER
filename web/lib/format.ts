export function money(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

export function tokens(value: number): string {
  return new Intl.NumberFormat("es-ES").format(value);
}

export function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as {
      detail?: string | { msg?: string }[];
      error?: { message?: string };
    };
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail) && body.detail[0]?.msg) return String(body.detail[0].msg);
    if (body.error?.message) return body.error.message;
  } catch {
    return text || `HTTP ${response.status}`;
  }
  return text || `HTTP ${response.status}`;
}

export const STATUS_LABEL = {
  success: "Éxito",
  fallback: "Respaldo",
  error: "Error",
} as const;
