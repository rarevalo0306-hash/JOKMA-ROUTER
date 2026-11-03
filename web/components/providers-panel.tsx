"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readError } from "@/lib/format";
import { groupProviders, providerTitle } from "@/lib/provider-groups";
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
  const grouped = groupProviders(providers);

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Proveedores</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Cada tarjeta ya trae el nombre, el adaptador y la dirección. Solo falta pegar la clave.
          El enlace abre la página donde se crea esa clave.
        </p>
      </header>

      <PresetSection title="Chat y código" providers={grouped.chat} />
      <PresetSection title="Vídeo" providers={grouped.video} video />

      {grouped.rest.length > 0 ? (
        <div className="mt-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Otros</h2>
          <ul className="space-y-3">
            {grouped.rest.map((provider) => (
              <li key={provider.id}>
                <ProviderCard provider={provider} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <OtherProviderForm adapters={adapters} />
    </section>
  );
}

function PresetSection({
  title,
  providers,
  video = false,
}: {
  title: string;
  providers: Provider[];
  video?: boolean;
}) {
  if (providers.length === 0) return null;
  return (
    <div className={video ? "mt-8" : ""}>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <ul className="grid gap-3 lg:grid-cols-2">
        {providers.map((provider) => (
          <li key={provider.id}>
            <PresetCard provider={provider} video={video || provider.kind === "video"} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function PresetCard({ provider, video }: { provider: Provider; video: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const stub = provider.adapter === "gemini";

  async function saveKey(formData: FormData) {
    const apiKey = String(formData.get("api_key") || "").trim();
    if (!apiKey) {
      setOk(false);
      setMessage("Pega la clave antes de guardar.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const response = await fetch(`/api/admin/providers/${provider.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
    setBusy(false);
    if (!response.ok) {
      setOk(false);
      setMessage(await readError(response));
      return;
    }
    setOk(true);
    setMessage("Clave guardada");
    (document.getElementById(`key-${provider.id}`) as HTMLFormElement | null)?.reset();
    router.refresh();
  }

  return (
    <article className="flex h-full flex-col rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-semibold">{providerTitle(provider)}</h3>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
          {video ? "Vídeo" : "Chat"}
        </span>
      </div>
      {video ? (
        <p className="mt-2 text-sm text-muted">
          El gateway solo hace chat. Esta tarjeta guarda la clave y no envía completions.
        </p>
      ) : (
        <p className="mono mt-2 break-all text-sm text-muted">
          {provider.adapter} · {provider.base_url}
        </p>
      )}
      {stub ? (
        <p className="mt-2 text-sm text-muted">
          El adaptador de Gemini todavía no enruta llamadas. Puedes guardar la clave; el chat no
          sale por aquí.
        </p>
      ) : null}
      {provider.name === "openrouter" ? (
        <p className="mt-2 text-sm text-muted">
          El modelo se escribe con el autor, por ejemplo openai/gpt-4o. Esa ruta completa es la que
          recibe OpenRouter.
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted">
        {provider.has_api_key ? `Clave guardada ····${provider.api_key_last4}` : "Sin clave"}
      </p>
      {provider.key_url ? (
        <a
          href={provider.key_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 text-sm font-medium text-accent"
        >
          Obtener clave
        </a>
      ) : null}
      <form id={`key-${provider.id}`} action={saveKey} className="mt-4 grid gap-3">
        <label className="text-sm">
          Clave API
          <input
            name="api_key"
            type="password"
            autoComplete="new-password"
            placeholder="Pega la clave"
            className={field}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-fit rounded-full bg-citron px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-60"
        >
          {busy ? "Guardando…" : "Guardar clave"}
        </button>
      </form>
      {message ? (
        <p role="status" className={`mt-3 text-sm ${ok ? "text-ok" : "text-danger"}`}>
          {message}
        </p>
      ) : null}
    </article>
  );
}

function OtherProviderForm({ adapters }: { adapters: AdapterInfo[] }) {
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
    <details className="mt-8 rounded-2xl border border-line bg-panel p-5">
      <summary className="cursor-pointer text-sm font-semibold">Agregar otro proveedor</summary>
      <form id="provider-form" action={onCreate} className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="block text-sm">
          Nombre
          <input name="name" required placeholder="vllm" className={field} autoComplete="off" />
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
            className="rounded-full bg-citron px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-60"
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
    </details>
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
            {providerTitle(provider)}{" "}
            <span className="mono text-sm font-normal text-muted">{provider.adapter}</span>
          </h2>
          <p className="mono mt-1 break-all text-sm text-muted">{provider.base_url}</p>
          <p className="mt-1 text-xs text-muted">
            {provider.has_api_key ? `Clave guardada ····${provider.api_key_last4}` : "Sin clave"}
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
            className="w-fit rounded-full bg-citron px-4 py-2 text-sm font-semibold text-on-accent"
          >
            Guardar cambios
          </button>
        </form>
      </details>
    </article>
  );
}
