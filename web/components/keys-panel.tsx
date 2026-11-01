"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readError, when } from "@/lib/format";
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
      body: JSON.stringify({
        name: String(formData.get("name") || ""),
        app_name: String(formData.get("app_name") || ""),
      }),
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
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
  }

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Claves internas</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Cada aplicación usa una clave <span className="mono text-paper">ak_…</span>. Se guarda solo
          el hash. El secreto se muestra una vez.
        </p>
      </header>

      <form id="key-form" action={onCreate} className="mb-6 grid gap-4 rounded-2xl border border-line bg-panel p-5 md:grid-cols-2">
        <label className="text-sm">
          Nombre
          <input name="name" required placeholder="Producción" className={field} />
        </label>
        <label className="text-sm">
          Aplicación
          <input name="app_name" required placeholder="facturas" className={field} />
        </label>
        <div className="md:col-span-2 md:text-right">
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-citron px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {pending ? "Creando…" : "Crear clave"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger md:col-span-2">
            No se pudo crear: {error}
          </p>
        ) : null}
      </form>

      {revealed ? (
        <div role="status" className="mb-6 rounded-2xl border border-citron/50 bg-panel p-4">
          <p className="text-sm font-medium">Copia esta clave ahora. No se volverá a mostrar.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input readOnly value={revealed} aria-label="Clave recién creada" className={`${field} mono`} />
            <button type="button" onClick={copy} className="rounded-full border border-line px-4 py-2 text-sm">
              {copied ? "Copiada" : "Copiar"}
            </button>
          </div>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <p className="text-sm text-muted">No hay claves todavía.</p>
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
    if (!window.confirm(`¿Revocar la clave de ${apiKey.app_name}? Las apps que la usen dejarán de entrar.`)) {
      return;
    }
    setBusy(true);
    await fetch(`/api/admin/api-keys/${apiKey.id}/revoke`, { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
      <div>
        <p className="font-medium">
          {apiKey.name} <span className="text-muted">· {apiKey.app_name}</span>
        </p>
        <p className="mono mt-1 text-xs text-muted">
          {apiKey.key_prefix}… · creada {when(apiKey.created_at)} · último uso {when(apiKey.last_used_at)}
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
          Revocar
        </button>
      )}
    </li>
  );
}
