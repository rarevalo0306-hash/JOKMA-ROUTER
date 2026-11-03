"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readError, when } from "@/lib/format";
import { maskApiKey } from "@/lib/mask-key";
import type { ApiKeyRecord } from "@/lib/types";

const field =
  "mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-paper outline-none";

export function KeysPanel({ keys }: { keys: ApiKeyRecord[] }) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onCreate(formData: FormData) {
    setPending(true);
    setError(null);
    setCopied(false);
    const response = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: String(formData.get("name") || "").trim() }),
    });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    const body = (await response.json()) as ApiKeyRecord;
    setRevealed(body.raw_key ?? null);
    (document.getElementById("key-form") as HTMLFormElement | null)?.reset();
    router.refresh();
  }

  async function copy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed);
      setCopied(true);
    } catch {
      setCopied(false);
      setError("No se pudo copiar. Selecciona la clave y cópiala a mano.");
    }
  }

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Claves</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Escribe un nombre y crea la clave. El secreto <span className="mono text-paper">ak_…</span>{" "}
          se muestra una sola vez. Después solo verás la clave enmascarada y podrás revocarla.
        </p>
      </header>

      <form id="key-form" action={onCreate} className="mb-6 flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm">
          Nombre
          <input name="name" required placeholder="Producción" className={field} autoComplete="off" />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-citron px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          {pending ? "Creando…" : "Crear clave"}
        </button>
      </form>
      {error ? (
        <p role="alert" className="-mt-3 mb-6 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {revealed ? (
        <div role="status" className="mb-6 rounded-2xl border border-citron/50 bg-panel p-4">
          <p className="text-sm font-medium">Copia esta clave ahora. No se volverá a mostrar.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
            <code className="mono block min-w-0 flex-1 break-all rounded-xl border border-line bg-ink px-3 py-2 text-sm text-paper">
              {revealed}
            </code>
            <button type="button" onClick={copy} className="rounded-full border border-line px-4 py-2 text-sm">
              {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Todavía no hay claves.
        </p>
      ) : (
        <ul className="space-y-2">
          {keys.map((key) => (
            <KeyRow key={`${key.id}:${key.revoked_at ?? "active"}`} apiKey={key} />
          ))}
        </ul>
      )}
    </section>
  );
}

function KeyRow({ apiKey }: { apiKey: ApiKeyRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const revoked = Boolean(apiKey.revoked_at);

  async function revoke() {
    if (!window.confirm(`¿Revocar «${apiKey.name}»? Las aplicaciones que la usen dejarán de entrar.`)) {
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/admin/api-keys/${apiKey.id}/revoke`, { method: "POST" });
    setBusy(false);
    if (!response.ok) return;
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{apiKey.name}</p>
        <p className="mono mt-1 text-xs text-muted">
          {maskApiKey(apiKey.key_prefix)} · creada {when(apiKey.created_at)}
        </p>
      </div>
      {revoked ? (
        <span className="text-sm text-danger">Revocada {when(apiKey.revoked_at)}</span>
      ) : (
        <button
          type="button"
          onClick={revoke}
          disabled={busy}
          className="rounded-full border border-danger/40 px-3 py-1.5 text-sm text-danger"
        >
          {busy ? "Revocando…" : "Revocar"}
        </button>
      )}
    </li>
  );
}
