"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { readError } from "@/lib/format";
import { groupProviders, isVideoProvider, providerTitle } from "@/lib/provider-groups";
import type { AdapterInfo, Provider } from "@/lib/types";
import { Brand } from "./provider-brand";
import "./providers.css";

const icons = {
  add: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  settings: <><path d="M4 6h7m5 0h4M4 12h2m5 0h9M4 18h9m5 0h2" /><circle cx="13.5" cy="6" r="2.5" /><circle cx="8.5" cy="12" r="2.5" /><circle cx="15.5" cy="18" r="2.5" /></>,
  chat: <path d="M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5.5 4v-4H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />,
  video: <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" /></>,
  server: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.1M7 16.5h.1" /></>,
  all: <><rect x="3" y="3" width="7" height="7" rx="1.2" /><rect x="14" y="3" width="7" height="7" rx="1.2" /><rect x="3" y="14" width="7" height="7" rx="1.2" /><rect x="14" y="14" width="7" height="7" rx="1.2" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m7.5 12 3 3 6-6" /></>,
  key: <><circle cx="8" cy="9" r="4" /><path d="m11 12 8 8 2-2-2-2 1.5-1.5-2-2L17 14" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  arrow: <path d="M6 18 18 6M7 6h11v11" />,
};

function Icon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function displayHost(base: string) {
  try { return new URL(base).host; } catch { return base; }
}

function needsCredential(provider: Provider) {
  // Presets link to their credential issuer. Custom endpoints can use keyless authentication.
  return !provider.has_api_key && Boolean(provider.key_url);
}

function stateLabel(provider: Provider) {
  if (needsCredential(provider)) return "Falta clave";
  if (isVideoProvider(provider)) return provider.has_api_key ? "Clave guardada" : "Sin clave";
  return provider.enabled ? "Habilitado" : "Deshabilitado";
}

function protocol(provider: Provider) {
  if (isVideoProvider(provider)) return "Vídeo";
  if (provider.adapter === "ollama") return "Ollama";
  if (provider.adapter === "anthropic") return "Anthropic Messages";
  return "Compatible con OpenAI";
}

type Category = "Todos los tipos" | "Chat" | "Vídeo" | "Personalizados";
type Connection = "Todos" | "Configurados" | "Falta clave";

function FilterChoice({ text, icon, count, active, onClick }: {
  text: Category | Connection; icon: keyof typeof icons; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button className="pv-choice" type="button" aria-pressed={active} onClick={onClick}>
      <Icon name={icon} size={15} /><span>{text}</span><small aria-hidden="true">{count}</small>
    </button>
  );
}

export function ProvidersPanel({ providers, adapters }: { providers: Provider[]; adapters: AdapterInfo[] }) {
  const grouped = groupProviders(providers);
  const custom = new Set(grouped.rest.map((p) => p.id));
  const catalog = [...grouped.chat, ...grouped.rest, ...grouped.video];
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("Todos los tipos");
  const [connection, setConnection] = useState<Connection>("Todos");
  const [openFilters, setOpenFilters] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  const selected = providers.find((p) => p.id === modal);
  const search = query.trim().toLocaleLowerCase("es");
  const categories: { name: Category; icon: keyof typeof icons; match: (p: Provider) => boolean }[] = [
    { name: "Todos los tipos", icon: "all", match: () => true },
    { name: "Chat", icon: "chat", match: (p) => !isVideoProvider(p) },
    { name: "Vídeo", icon: "video", match: isVideoProvider },
    { name: "Personalizados", icon: "server", match: (p) => custom.has(p.id) },
  ];
  const connections: { name: Connection; icon: keyof typeof icons; match: (p: Provider) => boolean }[] = [
    { name: "Todos", icon: "all", match: () => true },
    { name: "Configurados", icon: "check", match: (p) => !needsCredential(p) },
    { name: "Falta clave", icon: "key", match: needsCredential },
  ];
  const matchCategory = categories.find((item) => item.name === category)!.match;
  const matchConnection = connections.find((item) => item.name === connection)!.match;
  const matches = catalog.filter((provider) =>
    [providerTitle(provider), provider.name, provider.adapter, displayHost(provider.base_url)]
      .some((value) => value.toLocaleLowerCase("es").includes(search)),
  );
  const visible = matches.filter((p) => matchCategory(p) && matchConnection(p));

  function clearFilters() {
    setConnection("Todos");
    setCategory("Todos los tipos");
    setQuery("");
  }
  const filtered = category !== "Todos los tipos" || connection !== "Todos" || Boolean(query);
  return (
    <section className="pv-page">
      <header className="pv-heading">
        <div><h1>Proveedores</h1><p>Conecta servicios de IA y servidores propios a tu API.</p></div>
        <button type="button" className="pv-primary" onClick={() => setModal("add")}><Icon name="add" size={17} />Añadir proveedor</button>
      </header>
      <div className="pv-directory">
        <aside className="pv-filters" aria-label="Filtros del directorio" data-open={openFilters}>
          <div className="pv-filter-title">
            <h2><Icon name="settings" size={16} />Filtros</h2>
            <button className="pv-filter-toggle" type="button" aria-controls="pv-filter-options" aria-expanded={openFilters} onClick={() => setOpenFilters(!openFilters)}>
              {openFilters ? "Ocultar" : "Mostrar"}
            </button>
          </div>
          <div id="pv-filter-options">
            <fieldset><legend>Configuración</legend>
              {connections.map((item) => <FilterChoice key={item.name} text={item.name} icon={item.icon} count={matches.filter((p) => matchCategory(p) && item.match(p)).length} active={connection === item.name} onClick={() => setConnection(item.name)} />)}
            </fieldset>
            <fieldset><legend>Tipo de proveedor</legend>
              {categories.map((item) => <FilterChoice key={item.name} text={item.name} icon={item.icon} count={matches.filter((p) => matchConnection(p) && item.match(p)).length} active={category === item.name} onClick={() => setCategory(item.name)} />)}
            </fieldset>
            {filtered && <button type="button" className="pv-clear" onClick={clearFilters}>Limpiar filtros</button>}
          </div>
        </aside>
        <div className="pv-results">
          <div className="pv-directory-head">
            <label className="pv-search"><Icon name="search" size={17} /><input aria-label="Buscar proveedores" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por proveedor o dominio…" /></label>
            <p aria-live="polite">{visible.length} {visible.length === 1 ? "proveedor" : "proveedores"}</p>
          </div>
          {visible.length ? (
            <ul className="pv-grid">
              {visible.map((provider) => {
                const label = stateLabel(provider);
                const video = isVideoProvider(provider);
                return (
                  <li key={provider.id} data-brand={provider.name}>
                    <button type="button" className="pv-card" aria-label={`Configurar ${providerTitle(provider)}`} onClick={() => setModal(provider.id)}>
                      <span className="pv-card-head">
                        <Brand provider={provider} />
                        <span className="pv-card-settings" aria-hidden="true"><Icon name="settings" size={16} /></span>
                      </span>
                      <span className="pv-name">{providerTitle(provider)}</span>
                      <span className="pv-host">{displayHost(provider.base_url)}</span>
                      <span className="pv-foot">
                        <span className="pv-protocol"><Icon name={video ? "video" : custom.has(provider.id) ? "server" : "chat"} size={14} />{protocol(provider)}</span>
                        <span className="pv-status" data-state={label}><i />{label}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <div className="pv-empty" role="status"><Icon name="search" size={22} /><p>{providers.length ? "No se encontraron proveedores." : "Añade tu primer proveedor para conectar sus modelos."}</p>{filtered && <button className="pv-clear" type="button" onClick={clearFilters}>Limpiar filtros</button>}</div>}
        </div>
      </div>

      {modal === "add" ? (
        <SettingsDialog title="Añadir proveedor" onClose={() => setModal(null)}>
          <ProviderForm adapters={adapters} onCreated={() => { setModal(null); clearFilters(); }} />
        </SettingsDialog>
      ) : selected ? (
        <SettingsDialog title={providerTitle(selected)} brand={<Brand provider={selected} />} onClose={() => setModal(null)}>
          <ProviderSettings provider={selected} custom={custom.has(selected.id)} onDelete={() => setModal(null)} />
        </SettingsDialog>
      ) : null}
    </section>
  );
}

function SettingsDialog({ title, brand, onClose, children }: { title: string; brand?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} aria-labelledby="pv-dialog-title" className="pv-dialog"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="pv-dialog-interior">
        <header>{brand}<h2 id="pv-dialog-title">{title}</h2><button type="button" aria-label="Cerrar ajustes" onClick={onClose}><Icon name="close" size={18} /></button></header>
        {children}
      </div>
    </dialog>
  );
}

async function changeProvider(path: string, method: string, payload?: Record<string, unknown>) {
  const response = await fetch(path, {
    method,
    ...(payload && { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response;
}

function ProviderForm({ adapters, onCreated }: { adapters: AdapterInfo[]; onCreated: () => void }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await changeProvider("/api/admin/providers", "POST", {
        name: String(data.get("name")).trim(), adapter: data.get("adapter"), base_url: String(data.get("base_url")).trim(),
        api_key: String(data.get("api_key") || "").trim() || null, enabled: data.has("enabled"),
      });
      router.refresh();
      onCreated();
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo crear el proveedor."); }
    finally { setPending(false); }
  }
  return (
    <form onSubmit={create} className="pv-fields">
      <label>Nombre<input name="name" placeholder="mi-servidor" required autoComplete="off" /></label>
      <label>Adaptador<select name="adapter" defaultValue="openai">{adapters.map((a) => <option key={a.slug} value={a.slug}>{a.slug}{a.implemented ? "" : " (sin implementar)"}</option>)}</select></label>
      <label>URL base accesible desde el router<input name="base_url" type="url" required placeholder="http://localhost:11434" /></label>
      <label>Clave API<input name="api_key" type="password" autoComplete="new-password" placeholder="Opcional para servidores locales" /></label>
      <label className="pv-check"><input name="enabled" type="checkbox" defaultChecked />Habilitado</label>
      {error && <p className="pv-error" role="alert">{error}</p>}
      <button className="pv-primary" disabled={pending}>{pending ? "Guardando…" : "Guardar proveedor"}</button>
    </form>
  );
}

function ProviderSettings({ provider, custom, onDelete }: { provider: Provider; custom: boolean; onDelete: () => void }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const url = `/api/admin/providers/${provider.id}`;
  const video = isVideoProvider(provider);

  async function perform(action: () => Promise<string>) {
    setBusy(true);
    setFeedback(null);
    try {
      const text = await action();
      setFeedback({ ok: true, text });
    } catch (err) { setFeedback({ ok: false, text: err instanceof Error ? err.message : "Error de conexión" }); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const changes: Record<string, unknown> = {};
    if (custom && data.get("base_url") !== provider.base_url) changes.base_url = String(data.get("base_url") || "").trim();
    const key = String(data.get("api_key") || "").trim();
    if (data.has("clear_key")) changes.api_key = "";
    else if (key) changes.api_key = key;
    if (!video && data.has("enabled") !== provider.enabled) changes.enabled = data.has("enabled");
    if (!Object.keys(changes).length) {
      setFeedback({ ok: true, text: "Los ajustes ya están guardados." });
      return;
    }
    await perform(async () => {
      await changeProvider(url, "PATCH", changes);
      const keyInput = form.current?.elements.namedItem("api_key") as HTMLInputElement | null;
      if (keyInput) keyInput.value = "";
      router.refresh();
      return "Ajustes guardados.";
    });
  }
  async function test() {
    await perform(async () => {
      const response = await changeProvider(url + "/test", "POST");
      const body: { ok: boolean; detail?: string } = await response.json();
      if (!body.ok) throw new Error(body.detail || "Falló la conexión.");
      return body.detail || "Conexión verificada.";
    });
  }
  async function remove() {
    if (!window.confirm(`¿Eliminar ${providerTitle(provider)} y sus modelos?`)) return;
    await perform(async () => {
      await changeProvider(url, "DELETE");
      router.refresh();
      onDelete();
      return "Proveedor eliminado.";
    });
  }
  return (
    <form ref={form} onSubmit={save} className="pv-fields">
      <p className="pv-meta">{video ? "Este proveedor permite guardar credenciales para vídeo." : `Adaptador · ${provider.adapter}`}</p>
      {provider.name === "openrouter" && <p className="pv-meta">Usa el nombre completo del modelo, por ejemplo openai/gpt-4o.</p>}
      <label>URL base<input name="base_url" defaultValue={provider.base_url} readOnly={!custom} type="url" required /></label>
      <label>Clave API<input name="api_key" type="password" autoComplete="new-password" placeholder={provider.has_api_key ? `Guardada ····${provider.api_key_last4 || ""}` : "Pega tu clave"} /></label>
      {provider.key_url && <a href={provider.key_url} target="_blank" rel="noopener noreferrer">Obtener clave <Icon name="arrow" size={13} /></a>}
      {provider.has_api_key && <label className="pv-check"><input name="clear_key" type="checkbox" />Borrar la clave guardada</label>}
      {!video && <label className="pv-check"><input name="enabled" type="checkbox" defaultChecked={provider.enabled} />Habilitar en el router</label>}
      {feedback && <p role="status" className={feedback.ok ? "pv-success" : "pv-error"}>{feedback.text}</p>}
      <div className="pv-actions">
        <button className="pv-primary" disabled={busy}>{busy ? "Procesando…" : "Guardar cambios"}</button>
        {!video && <button className="pv-secondary" type="button" onClick={test} disabled={busy}>Probar conexión</button>}
        {custom && <button className="pv-delete" type="button" onClick={remove} disabled={busy}>Eliminar</button>}
      </div>
    </form>
  );
}
