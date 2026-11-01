"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readError } from "@/lib/format";
import type { AdapterInfo, Provider } from "@/lib/types";

const field =
  "mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-paper outline-none";

export function ProvidersPanel({
  providers,
  adapters,
}: {
  providers: Provider[];
  adapters: AdapterInfo[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onCreate(formData: FormData) {
    setPending(true);
    setError(null);
    const apiKey = String(formData.get("api_key") || "");
    const response = await fetch("/api/admin/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: String(formData.get("name") || ""),
        adapter: String(formData.get("adapter") || ""),
        base_url: String(formData.get("base_url") || ""),
        api_key: apiKey || null,
        enabled: formData.get("enabled") === "on",
      }),
    });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    (document.getElementById("provider-form") as HTMLFormElement | null)?.reset();
    router.refresh();
  }

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Proveedores</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Cada proveedor es un origen de modelos. La clave se guarda cifrada y no vuelve a mostrarse.
          Groq, DeepSeek, Together y vLLM pueden registrarse hoy con el adaptador openai y su URL base.
        </p>
      </header>

      <form
        id="provider-form"
        action={onCreate}
        className="mb-6 grid gap-4 rounded-2xl border border-line bg-panel p-5 md:grid-cols-2"
      >
        <label className="block text-sm">
          Nombre
          <input name="name" required placeholder="openai" className={field} autoComplete="off" />
        </label>
        <label className="block text-sm">
          Adaptador
          <select name="adapter" className={field} defaultValue="openai">
            {adapters.map((adapter) => (
              <option key={adapter.slug} value={adapter.slug}>
                {adapter.slug}
                {adapter.implemented ? "" : " (sin implementar)"}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm md:col-span-2">
          URL base
          <input
            name="base_url"
            required
            placeholder="https://api.openai.com/v1"
            className={field}
            inputMode="url"
          />
        </label>
        <label className="block text-sm md:col-span-2">
          Clave API
          <input
            name="api_key"
            type="password"
            placeholder="Opcional para Ollama local"
            className={field}
            autoComplete="new-password"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input name="enabled" type="checkbox" defaultChecked className="h-4 w-4 accent-citron" />
          Habilitado
        </label>
        <div className="md:text-right">
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-citron px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
          >
            {pending ? "Guardando…" : "Guardar proveedor"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger md:col-span-2">
            No se pudo guardar: {error}
          </p>
        ) : null}
      </form>

      {providers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Todavía no hay proveedores.
        </p>
      ) : (
        <ul className="space-y-3">
          {providers.map((provider) => (
            <li key={provider.id}>
              <ProviderCard provider={provider} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProviderCard({ provider }: { provider: Provider }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  async function testConnection() {
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/admin/providers/${provider.id}/test`, { method: "POST" });
    const body = (await response.json()) as { ok?: boolean; detail?: string };
    setBusy(false);
    setOk(Boolean(body.ok));
    setMessage(body.detail || (body.ok ? "Conectado" : "Falló la prueba"));
  }

  async function toggle() {
    setBusy(true);
    await fetch(`/api/admin/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !provider.enabled }),
    });
    setBusy(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("¿Eliminar este proveedor? También se borran sus modelos.")) return;
    setBusy(true);
    await fetch(`/api/admin/providers/${provider.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  async function saveEdit(formData: FormData) {
    const baseUrl = String(formData.get("base_url") || "");
    const apiKey = String(formData.get("api_key") || "");
    const clear = formData.get("clear_key") === "on";
    const payload: Record<string, string | null> = {};
    if (baseUrl && baseUrl !== provider.base_url) payload.base_url = baseUrl;
    if (clear) payload.api_key = "";
    else if (apiKey) payload.api_key = apiKey;
    if (Object.keys(payload).length === 0) return;
    setBusy(true);
    const response = await fetch(`/api/admin/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!response.ok) {
      setOk(false);
      setMessage(await readError(response));
      return;
    }
    setOk(true);
    setMessage("Cambios guardados");
    router.refresh();
  }

  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {provider.name}{" "}
            <span className="mono text-sm font-normal text-muted">{provider.adapter}</span>
          </h2>
          <p className="mono mt-1 break-all text-sm text-muted">{provider.base_url}</p>
          <p className="mt-1 text-xs text-muted">
            {provider.has_api_key
              ? `Clave guardada ····${provider.api_key_last4}`
              : "Sin clave"}
            {provider.enabled ? " · habilitado" : " · deshabilitado"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={testConnection}
            disabled={busy}
            className="rounded-full border border-line px-3 py-1.5 text-sm"
          >
            Probar conexión
          </button>
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-pressed={provider.enabled}
            className="rounded-full border border-line px-3 py-1.5 text-sm"
          >
            {provider.enabled ? "Deshabilitar" : "Habilitar"}
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="rounded-full border border-danger/40 px-3 py-1.5 text-sm text-danger"
          >
            Eliminar
          </button>
        </div>
      </div>
      {message ? (
        <p role="status" className={`mt-3 text-sm ${ok ? "text-ok" : "text-danger"}`}>
          {message}
        </p>
      ) : null}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted">Cambiar URL o clave</summary>
        <form action={saveEdit} className="mt-3 grid gap-3">
          <label>
            URL base
            <input name="base_url" defaultValue={provider.base_url} className={field} />
          </label>
          <label>
            Nueva clave
            <input name="api_key" type="password" autoComplete="new-password" className={field} />
          </label>
          <label className="flex items-center gap-2">
            <input name="clear_key" type="checkbox" className="h-4 w-4 accent-citron" />
            Borrar la clave guardada
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-fit rounded-full bg-citron px-4 py-2 text-sm font-semibold text-ink"
          >
            Guardar cambios
          </button>
        </form>
      </details>
    </article>
  );
}
