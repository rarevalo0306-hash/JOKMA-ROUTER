"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Brand } from "@/components/provider-brand";
import styles from "./catalog.module.css";
import { readError } from "@/lib/format";
import { chatRoutableProviders, providerTitle } from "@/lib/provider-groups";
import type { CatalogModel, Provider } from "@/lib/types";

const field = styles.field;

export function ModelsPanel({
  models,
  providers,
}: {
  models: CatalogModel[];
  providers: Provider[];
}) {
  const router = useRouter();
  const routable = chatRoutableProviders(providers);
  const [providerId, setProviderId] = useState(routable[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [fallbacks, setFallbacks] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const search = query.trim().toLowerCase();
  const shown = models.filter((model) =>
    (!providerFilter || providerFilter === model.provider_id) &&
    [model.public_id, model.alias].some((value) => value?.toLowerCase().includes(search)),
  );

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setPending(true);
    setError(null);
    const alias = String(formData.get("alias") || "").trim();
    try {
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
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      setFallbacks([]);
      form.reset();
      setAdding(false);
      setQuery("");
      setProviderFilter("");
      router.refresh();
    } catch {
      setError("No se pudo añadir el modelo. Revisa la conexión.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Catálogo de modelos</h1>
          <p>Configura los modelos, alias y respaldos que usan tus aplicaciones.</p>
        </div>
        {routable.length > 0 && (
          <button type="button" aria-expanded={adding} aria-controls="model-form"
            onClick={() => setAdding(!adding)} className={adding ? styles.secondary : styles.primary}>
            {adding ? "Cerrar formulario" : "＋ Añadir modelo"}
          </button>
        )}
      </header>
      {routable.length === 0 && (
        <p className={styles.empty}>
          Añade un proveedor de chat para registrar modelos. <Link href="/proveedores">Ir a proveedores</Link>
        </p>
      )}
      {adding && (
        <form id="model-form" onSubmit={onCreate} className={styles.create}>
          <h2 className={styles.formHeading}>Nuevo modelo</h2>
          <label className="text-sm">
            Proveedor
            <select
              name="provider_id"
              className={field}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {routable.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {providerTitle(provider)}
                </option>
              ))}
            </select>
          </label>
          <UpstreamModelField key={providerId} providerId={providerId} />
          <label className="text-sm">
            Alias
            <input name="alias" placeholder="asistente" className={field} />
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
              className={styles.primary}
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

      <div className={styles.surface}>
        <div className={styles.toolbar}>
          <span className={styles.count} aria-live="polite">{shown.length} {shown.length === 1 ? "modelo" : "modelos"}</span>
          <label className={styles.search}>
            <span className={styles.lens} aria-hidden="true" />
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
              aria-label="Buscar por modelo o alias" placeholder="Buscar modelo o alias" />
          </label>
          <select aria-label="Filtrar por proveedor" value={providerFilter}
            onChange={(event) => setProviderFilter(event.target.value)} className={styles.filter}>
            <option value="">Todos los proveedores</option>
            {routable.map((provider) => <option key={provider.id} value={provider.id}>{providerTitle(provider)}</option>)}
          </select>
        </div>
        {shown.length === 0 ? (
          <p className={styles.empty}>{models.length === 0 ? "El catálogo está vacío." : "Ningún modelo coincide con los filtros."}</p>
        ) : (
          <>
            <div aria-hidden="true" className={styles.columnNames}>
              <span>Modelo</span><span>Alias</span><span>Estado</span><span />
            </div>
            <ul className={styles.rows}>
              {shown.map((model) => (
                <li key={`${model.id}:${model.alias}:${model.enabled}:${model.fallback_model_ids.join(",")}:${model.input_per_million}:${model.output_per_million}`}>
                  <ModelRow model={model} options={models} provider={providers.find((p) => p.id === model.provider_id)} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function UpstreamModelField({ providerId }: { providerId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discover() {
    setLoading(true);
    setError(null);
    setNames(null);
    try {
      const response = await fetch(`/api/admin/providers/${providerId}/models`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const catalog: { models: string[] } = await response.json();
      setNames(catalog.models);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo consultar el proveedor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-sm">
      <label className="block">
        Nombre del modelo
        <input ref={input} name="name" required placeholder="gpt-4o o llama3.2:3b" className={field} />
      </label>
      <button
        type="button"
        disabled={loading}
        onClick={discover}
        className={styles.discover}
      >
        {loading ? "Consultando…" : "Consultar modelos del proveedor"}
      </button>
      {names && names.length > 0 ? (
        <select
          aria-label="Modelos del proveedor"
          className={field}
          value=""
          onChange={(event) => {
            if (input.current) input.current.value = event.target.value;
          }}
        >
          <option value="" disabled>Elegir un modelo disponible…</option>
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      ) : null}
      {names?.length === 0 ? (
        <p role="status" className="mt-1 text-muted">El proveedor devolvió un catálogo vacío.</p>
      ) : null}
      {error ? <p role="alert" className="mt-1 text-danger">{error}</p> : null}
    </div>
  );
}

function ModelRow({ model, options, provider }: { model: CatalogModel; options: CatalogModel[]; provider?: Provider }) {
  const router = useRouter();
  const [alias, setAlias] = useState(model.alias ?? "");
  const [enabled, setEnabled] = useState(model.enabled);
  const [inputPrice, setInputPrice] = useState(String(model.input_per_million));
  const [outputPrice, setOutputPrice] = useState(String(model.output_per_million));
  const [fallbacks, setFallbacks] = useState(model.fallback_model_ids);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const desiredAlias = alias.trim() || null;
  const aliasOwner = desiredAlias && options.find(
    (other) => other.id !== model.id && other.alias === desiredAlias,
  );

  async function save() {
    if (aliasOwner) {
      const replacing = model.alias ? ` El alias actual «${model.alias}» quedará libre.` : "";
      if (!window.confirm(
        `¿Mover «${desiredAlias}» de ${aliasOwner.public_id} a ${model.public_id}?${replacing}`,
      )) return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/models/${model.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(desiredAlias !== model.alias && { alias: desiredAlias, expected_alias: model.alias }),
          ...(aliasOwner && { transfer_alias_from: aliasOwner.id }),
          ...(enabled !== model.enabled && { enabled }),
          ...(fallbacks.join(",") !== model.fallback_model_ids.join(",") && { fallback_model_ids: fallbacks }),
          ...(Number(inputPrice) !== model.input_per_million && { input_per_million: Number(inputPrice) }),
          ...(Number(outputPrice) !== model.output_per_million && { output_per_million: Number(outputPrice) }),
        }),
      });
      if (!response.ok) {
        setError(await readError(response));
        if (response.status === 409) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo guardar. Comprueba la conexión.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`¿Eliminar ${model.public_id}?`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/models/${model.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      router.refresh();
    } catch {
      setError("No se pudo eliminar el modelo. Revisa la conexión.");
    } finally {
      setBusy(false);
    }
  }

  const available = model.enabled && provider?.enabled;
  const status = !model.enabled ? "Inactivo" : provider?.enabled ? "Habilitado" : "Proveedor inactivo";

  return (
    <details className={styles.row}>
      <summary className={styles.modelHeader}>
        <span className={styles.identity}>
          {provider && <Brand provider={provider} />}
          <span className={styles.modelText}>
            <strong>{model.name}</strong>
            <code>{model.public_id}</code>
          </span>
        </span>
        <span className={styles.alias}>{model.alias || "—"}</span>
        <span className={available ? styles.enabled : styles.disabled}>{status}</span>
        <span className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.editor}>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 accent-accent" />
          Modelo activo
        </label>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="text-sm">
            Alias
            <input
              list={`aliases-${model.id}`}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              className={field}
            />
            <datalist id={`aliases-${model.id}`}>
              {options.filter((other) => other.alias && other.id !== model.id).map((other) => (
                <option key={other.id} value={other.alias!}>{other.public_id}</option>
              ))}
            </datalist>
            {aliasOwner && (
              <span className="mt-1 block text-xs text-muted">Asignado a {aliasOwner.public_id}.</span>
            )}
          </label>
          <label className="text-sm">
            Entrada / 1M tokens (USD)
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
            Salida / 1M tokens (USD)
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
            className={styles.primary}
          >
            {aliasOwner ? "Mover alias y guardar" : "Guardar"}
          </button>
          <button type="button" onClick={remove} disabled={busy} className="rounded-lg px-4 py-2 text-sm text-danger">
            Eliminar
          </button>
        </div>
      </div>
    </details>
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
