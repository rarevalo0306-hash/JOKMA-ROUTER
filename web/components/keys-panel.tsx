"use client";

import { CopyButton, GatewayConnection } from "@/components/gateway-connection";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { readError, when } from "@/lib/format";
import { maskApiKey } from "@/lib/mask-key";
import type { ApiKeyRecord, GatewayModel } from "@/lib/types";
import { KeyModelMenu, menuLabel, menuMatchesResponse, modelMenuDraft } from "./key-model-menu";

function KeyIcon({ size = 20 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15.5 3a5.5 5.5 0 0 0-5.1 7.6L3 18v3h3v-2h3v-3l3.6-3.4A5.5 5.5 0 1 0 15.5 3Z" />
    <circle cx="17" cy="7" r=".9" fill="currentColor" />
  </svg>;
}

export function KeysPanel({ keys, models, publicBase }: {
  keys: ApiKeyRecord[];
  models: GatewayModel[];
  publicBase?: string;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<ApiKeyRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [newMenu, setNewMenu] = useState(() => modelMenuDraft(null));

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(formData.get("name") || "").trim(),
          model_ids: newMenu.limited ? newMenu.ids : null,
        }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const body = (await response.json()) as ApiKeyRecord;
      if (newMenu.limited && !menuMatchesResponse(newMenu, body.model_ids)) {
        const revocation = await fetch(`/api/admin/api-keys/${body.id}/revoke`, { method: "POST" }).catch(() => null);
        const status = revocation?.ok
          ? "La clave recién creada se revocó."
          : `Revisa «${body.name}» en Tus claves y revócala si sigue activa.`;
        setError(`El servidor no confirmó el menú solicitado. ${status} Actualiza la API y aplica sus migraciones antes de reintentar.`);
        router.refresh();
        return;
      }
      setRevealed(body);
      setCreating(false);
      setNewMenu(modelMenuDraft(null));
      router.refresh();
    } catch {
      setError("Se perdió la conexión. Revisa la lista antes de crear otra clave.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Claves de API</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Una clave por aplicación para acceder a tus modelos locales y de proveedores.</p>
        </div>
        {!revealed && (
          <button type="button" aria-expanded={creating} aria-controls="key-form" disabled={pending}
            onClick={() => { setCreating(!creating); setError(null); setNewMenu(modelMenuDraft(null)); }}
            className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${creating ? "border border-line text-paper hover:bg-panel" : "bg-citron text-on-accent hover:bg-accent hover:text-ink"}`}>
            <span aria-hidden="true" className="text-lg font-normal leading-none">{creating ? "×" : "+"}</span>
            {creating ? "Cancelar" : "Crear clave"}
          </button>
        )}
      </header>

      {creating && (
        <form id="key-form" onSubmit={onCreate} className="grid min-w-0 gap-4 rounded-2xl border border-accent/35 bg-panel p-5 sm:p-6">
          <label className="text-sm font-medium">
            Nombre de la aplicación
            <input name="name" required maxLength={120} autoFocus placeholder="Ej. Asistente de facturas" autoComplete="off"
              className="mt-2 block min-h-11 w-full rounded-xl border border-line bg-ink px-3.5 text-sm text-paper placeholder:text-muted/65" />
          </label>
          <KeyModelMenu models={models} draft={newMenu} onChange={setNewMenu} disabled={pending} />
          <button type="submit" disabled={pending} className="min-h-11 justify-self-start rounded-xl bg-citron px-4 text-sm font-semibold text-on-accent hover:bg-accent hover:text-ink disabled:opacity-60">
            {pending ? "Generando…" : "Generar clave"}
          </button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {revealed?.raw_key && (
        <div className="rounded-2xl border border-accent/40 bg-accent/[.06] p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold" role="status">Clave creada para {revealed.name}</h2>
              <p className="mt-1 text-sm text-muted">Cópiala ahora y guárdala como secreto en tu aplicación. Solo se muestra una vez.</p>
            </div>
            <button type="button" onClick={() => setRevealed(null)} className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-paper hover:border-accent/60">Ya la guardé</button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink p-3">
            <code className="min-w-0 flex-[1_1_180px] select-all break-all text-sm text-paper">{revealed.raw_key}</code>
            <CopyButton value={revealed.raw_key} label="Copiar clave" />
          </div>
        </div>
      )}

      <section aria-labelledby="keys-list" className="min-w-0 overflow-hidden rounded-2xl border border-line bg-panel">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent"><KeyIcon /></span>
          <h2 id="keys-list" className="text-lg font-semibold tracking-tight">Tus claves</h2>
          <span className="mono ml-auto text-xs text-muted">{keys.length} {keys.length === 1 ? "clave" : "claves"}</span>
        </header>
        {!keys.length ? (
          <p className="px-5 py-7 text-sm text-muted sm:px-6">Crea tu primera clave para conectar una aplicación.</p>
        ) : (
          <ul className="divide-y divide-line">
            {keys.map((key) => <KeyRow key={key.id} apiKey={key} models={models} onRevoked={() => {
              if (revealed?.id === key.id) setRevealed(null);
            }} />)}
          </ul>
        )}
      </section>

      <GatewayConnection keys={keys} models={models} publicBase={publicBase} />
    </section>
  );
}

function KeyRow({ apiKey, models, onRevoked }: { apiKey: ApiKeyRecord; models: GatewayModel[]; onRevoked: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<ReturnType<typeof modelMenuDraft> | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const revoked = Boolean(apiKey.revoked_at);

  async function saveMenu(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!menu) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/api-keys/${apiKey.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model_ids: menu.limited ? menu.ids : null }),
      });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      const saved = (await response.json()) as ApiKeyRecord;
      if (!menuMatchesResponse(menu, saved.model_ids)) {
        setError("El servidor no confirmó el nuevo menú. Actualiza la API y aplica sus migraciones antes de reintentar.");
        router.refresh();
        return;
      }
      setMenu(null);
      startRefresh(() => router.refresh());
    } catch {
      setError("Se perdió la conexión al guardar el menú. Puedes volver a intentarlo.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm(`¿Revocar «${apiKey.name}»? Las aplicaciones que la usen dejarán de tener acceso.`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/api-keys/${apiKey.id}/revoke`, { method: "POST" });
      if (!response.ok) {
        setError(await readError(response));
        return;
      }
      onRevoked();
      router.refresh();
    } catch {
      setError("No se pudo verificar la revocación. Actualiza la lista.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="min-w-0 px-5 py-4 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-[1_1_165px]">
          <p className="break-words text-sm font-semibold text-paper">{apiKey.name}</p>
          <p className="mt-1 text-xs text-muted"><code>{maskApiKey(apiKey.key_prefix)}</code> · Creada {when(apiKey.created_at)}</p>
          <p className="mt-1 text-xs text-muted">Menú · {menuLabel(apiKey.model_ids)}</p>
        </div>
        <span title={revoked ? `Revocada ${when(apiKey.revoked_at)}` : undefined}
          className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${revoked ? "border-line text-muted" : "border-ok/20 bg-ok/5 text-ok"}`}>
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {revoked ? "Revocada" : "Activa"}
        </span>
        {!revoked && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || refreshing} aria-expanded={menu !== null} aria-controls={`key-models-${apiKey.id}`}
              onClick={() => { setError(null); setMenu(menu ? null : modelMenuDraft(apiKey.model_ids)); }}
              className="min-h-9 rounded-lg border border-line bg-panel px-3 text-xs font-medium text-paper hover:border-accent/60">
              {menu ? "Cancelar" : "Editar menú"}
            </button>
            <button type="button" onClick={revoke} disabled={busy || refreshing}
              className="w-fit rounded-lg py-1.5 text-xs font-medium text-muted hover:text-danger sm:px-2">Revocar</button>
          </div>
        )}
      </div>
      {menu && !revoked && (
        <form id={`key-models-${apiKey.id}`} onSubmit={saveMenu} className="mt-4 grid min-w-0 gap-4 border-t border-line pt-4">
          <KeyModelMenu models={models} draft={menu} onChange={setMenu} disabled={busy} />
          <button type="submit" disabled={busy} className="min-h-10 justify-self-start rounded-xl bg-citron px-4 text-sm font-semibold text-on-accent hover:bg-accent hover:text-ink disabled:opacity-60">
            {busy ? "Guardando…" : "Guardar menú"}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
    </li>
  );
}
