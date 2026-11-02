"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readError } from "@/lib/format";
import { chatRoutableProviders, providerTitle } from "@/lib/provider-groups";
import type { CatalogModel, Provider } from "@/lib/types";

const field =
  "mt-1 w-full rounded-xl border border-line bg-ink px-3 py-2 text-sm text-paper outline-none";

export function ModelsPanel({
  models,
  providers,
}: {
  models: CatalogModel[];
  providers: Provider[];
}) {
  const router = useRouter();
  const routable = chatRoutableProviders(providers);
  const [error, setError] = useState<string | null>(null);
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  async function onCreate(formData: FormData) {
    setPending(true);
    setError(null);
    const alias = String(formData.get("alias") || "").trim();
    const response = await fetch("/api/admin/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider_id: String(formData.get("provider_id") || ""),
        name: String(formData.get("name") || ""),
        alias: alias || null,
        enabled: formData.get("enabled") === "on",
        fallback_model_ids: fallbacks,
        input_per_million: Number(formData.get("input_per_million") || 0),
        output_per_million: Number(formData.get("output_per_million") || 0),
      }),
    });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    setFallbacks([]);
    (document.getElementById("model-form") as HTMLFormElement | null)?.reset();
    router.refresh();
  }

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Catálogo de modelos</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          El id público es proveedor/modelo. El alias no lleva barra. Si el principal agota el tiempo,
          responde 429 o un 5xx, se intenta una sola vez el primer respaldo habilitado, antes de enviar
          tokens al cliente.
        </p>
      </header>

      {routable.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">
          Crea un proveedor antes de añadir modelos.
        </p>
      ) : (
        <form
          id="model-form"
          action={onCreate}
          className="mb-6 grid gap-4 rounded-2xl border border-line bg-panel p-5 md:grid-cols-2"
        >
          <label className="text-sm">
            Proveedor
            <select name="provider_id" className={field} defaultValue={routable[0]?.id}>
              {routable.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {providerTitle(provider)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Nombre del modelo
            <input name="name" required placeholder="gpt-4o" className={field} />
          </label>
          <label className="text-sm">
            Alias
            <input name="alias" placeholder="smart" className={field} />
          </label>
          <label className="flex items-end gap-2 text-sm">
            <input name="enabled" type="checkbox" defaultChecked className="h-4 w-4 accent-citron" />
            Activo
          </label>
          <label className="text-sm">
            Precio de entrada / 1M tokens (USD)
            <input name="input_per_million" type="number" min="0" step="0.000001" defaultValue="0" className={field} />
          </label>
          <label className="text-sm">
            Precio de salida / 1M tokens (USD)
            <input name="output_per_million" type="number" min="0" step="0.000001" defaultValue="0" className={field} />
          </label>
          <div className="md:col-span-2">
            <FallbackPicker options={models} value={fallbacks} onChange={setFallbacks} />
          </div>
          <div className="md:col-span-2 md:text-right">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full bg-citron px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
            >
              {pending ? "Guardando…" : "Añadir modelo"}
            </button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-danger md:col-span-2">
              No se pudo guardar: {error}
            </p>
          ) : null}
        </form>
      )}

      {models.length === 0 ? (
        <p className="text-sm text-muted">El catálogo está vacío.</p>
      ) : (
        <ul className="space-y-3">
          {models.map((model) => (
            <li
              key={`${model.id}:${model.alias}:${model.enabled}:${model.fallback_model_ids.join(",")}:${model.input_per_million}:${model.output_per_million}`}
            >
              <ModelRow model={model} options={models} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ModelRow({ model, options }: { model: CatalogModel; options: CatalogModel[] }) {
  const router = useRouter();
  const [alias, setAlias] = useState(model.alias ?? "");
  const [enabled, setEnabled] = useState(model.enabled);
  const [inputPrice, setInputPrice] = useState(String(model.input_per_million));
  const [outputPrice, setOutputPrice] = useState(String(model.output_per_million));
  const [fallbacks, setFallbacks] = useState(model.fallback_model_ids);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/models/${model.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: alias.trim() || null,
        enabled,
        fallback_model_ids: fallbacks,
        input_per_million: Number(inputPrice || 0),
        output_per_million: Number(outputPrice || 0),
      }),
    });
    setBusy(false);
    if (!response.ok) {
      setError(await readError(response));
      return;
    }
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar ${model.public_id}?`)) return;
    setBusy(true);
    await fetch(`/api/admin/models/${model.id}`, { method: "DELETE" });
    setBusy(false);
    router.refresh();
  }

  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="mono text-base font-semibold">{model.public_id}</h2>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((value) => !value)}
          className={`rounded-full px-3 py-1 text-sm ${enabled ? "bg-citron text-ink" : "border border-line text-muted"}`}
        >
          {enabled ? "Activo" : "Inactivo"}
        </button>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="text-sm">
          Alias
          <input value={alias} onChange={(event) => setAlias(event.target.value)} className={field} />
        </label>
        <label className="text-sm">
          Entrada / 1M
          <input
            type="number"
            min="0"
            step="0.000001"
            value={inputPrice}
            onChange={(event) => setInputPrice(event.target.value)}
            className={field}
          />
        </label>
        <label className="text-sm">
          Salida / 1M
          <input
            type="number"
            min="0"
            step="0.000001"
            value={outputPrice}
            onChange={(event) => setOutputPrice(event.target.value)}
            className={field}
          />
        </label>
      </div>
      <div className="mt-3">
        <FallbackPicker options={options} value={fallbacks} onChange={setFallbacks} selfId={model.id} />
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-full bg-citron px-4 py-2 text-sm font-semibold text-ink disabled:opacity-60"
        >
          Guardar
        </button>
        <button type="button" onClick={remove} disabled={busy} className="rounded-full px-4 py-2 text-sm text-danger">
          Eliminar
        </button>
      </div>
    </article>
  );
}

function FallbackPicker({
  options,
  value,
  onChange,
  selfId,
}: {
  options: CatalogModel[];
  value: string[];
  onChange: (ids: string[]) => void;
  selfId?: string;
}) {
  const available = options.filter((item) => item.id !== selfId && !value.includes(item.id));
  return (
    <fieldset className="text-sm">
      <legend className="mb-1">Respaldo, en orden</legend>
      {value.length === 0 ? (
        <p className="text-muted">Sin respaldo. Solo se usa el primero habilitado.</p>
      ) : (
        <ol className="space-y-1">
          {value.map((id, index) => {
            const label = options.find((item) => item.id === id)?.public_id ?? id;
            return (
              <li key={id} className="flex items-center justify-between gap-2 rounded-lg bg-panel-2 px-3 py-1.5">
                <span className="mono">
                  {index + 1}. {label}
                </span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((item) => item !== id))}
                  className="text-xs text-muted"
                >
                  Quitar
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <label className="mt-2 block">
        <span className="sr-only">Añadir respaldo</span>
        <select
          value=""
          onChange={(event) => {
            if (event.target.value) onChange([...value, event.target.value]);
          }}
          className={field}
        >
          <option value="">Añadir respaldo…</option>
          {available.map((item) => (
            <option key={item.id} value={item.id}>
              {item.public_id}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}
