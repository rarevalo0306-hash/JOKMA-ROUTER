"use client";

import { useId, useState } from "react";
import type { GatewayModel } from "@/lib/types";

export type ModelMenuDraft = { limited: boolean; ids: string[] };

export function modelMenuDraft(ids: string[] | null | undefined): ModelMenuDraft {
  return { limited: Array.isArray(ids), ids: ids ?? [] };
}

export function menuLabel(ids: string[] | null | undefined) {
  if (ids == null) return "Todos los modelos";
  return ids.length === 1 ? "1 modelo" : `${ids.length} modelos`;
}

export function menuMatchesResponse(draft: ModelMenuDraft, ids: string[] | null | undefined) {
  if (!draft.limited) return ids === null;
  if (!Array.isArray(ids)) return false;
  const confirmed = new Set(ids);
  return ids.length === draft.ids.length && draft.ids.every((id) => confirmed.has(id));
}

export function KeyModelMenu({ models, draft, onChange, disabled }: {
  models: GatewayModel[];
  draft: ModelMenuDraft;
  onChange: (menu: ModelMenuDraft) => void;
  disabled: boolean;
}) {
  const name = useId();
  const [search, setSearch] = useState("");
  const ids = new Set(draft.ids);
  const groups = new Map<string, GatewayModel[]>();
  const query = search.trim().toLocaleLowerCase("es");
  for (const model of models) {
    if (query && ![model.public_id, model.provider_label, model.alias].some((value) => value?.toLocaleLowerCase("es").includes(query))) continue;
    const group = groups.get(model.provider_name);
    if (group) group.push(model);
    else groups.set(model.provider_name, [model]);
  }

  const catalogIds = new Set(models.map((model) => model.id));
  const unknownIds = draft.ids.filter((id) => !catalogIds.has(id));
  function toggle(id: string, checked: boolean) {
    onChange({ limited: true, ids: checked ? [...draft.ids, id] : draft.ids.filter((value) => value !== id) });
  }

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-medium text-paper">Menú de modelos</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="inline-flex min-h-8 items-center gap-2">
          <input type="radio" name={name} checked={!draft.limited} onChange={() => onChange({ ...draft, limited: false })} className="accent-accent" />
          Todos los modelos
        </label>
        <label className="inline-flex min-h-8 items-center gap-2">
          <input type="radio" name={name} checked={draft.limited} onChange={() => onChange({ ...draft, limited: true })} className="accent-accent" />
          Elegir modelos
        </label>
      </div>
      {draft.limited ? (
        <div className="mt-3 min-w-0 rounded-xl border border-line bg-ink">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2.5">
            <input type="search" aria-label="Buscar en el menú de modelos" placeholder="Buscar modelo o proveedor" value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-h-9 min-w-0 flex-[1_1_180px] rounded-lg border border-line bg-panel px-3 text-sm text-paper" />
            <span aria-live="polite" className="text-xs text-muted">{draft.ids.length === 1 ? "1 seleccionado" : `${draft.ids.length} seleccionados`}</span>
          </div>
          <div className="grid max-h-80 grid-cols-1 items-start gap-4 overflow-y-auto px-3 py-3 sm:max-h-[25rem] sm:grid-cols-2 sm:gap-x-6">
            {Array.from(groups, ([slug, options]) => (
              <fieldset key={slug} className="min-w-0">
                <legend className="mb-1 text-xs font-semibold text-muted">{options[0].provider_label}</legend>
                {options.map((model) => (
                  <label key={model.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-panel">
                    <input type="checkbox" checked={ids.has(model.id)} onChange={(event) => toggle(model.id, event.target.checked)} className="h-4 w-4 shrink-0 accent-accent" />
                    <span className="mono min-w-0 flex-1 break-words [overflow-wrap:anywhere]">{model.name}</span>
                    {!model.available && <span className="shrink-0 text-xs text-muted">Inactivo</span>}
                  </label>
                ))}
              </fieldset>
            ))}
            {unknownIds.length > 0 && (
              <fieldset className="min-w-0">
                <legend className="mb-1 text-xs font-semibold text-muted">Fuera del catálogo</legend>
                {unknownIds.map((id) => (
                  <label key={id} className="flex min-h-9 items-center gap-2.5 px-1.5 text-xs text-muted">
                    <input type="checkbox" checked onChange={() => toggle(id, false)} className="h-4 w-4 shrink-0 accent-accent" />
                    <code className="break-all">{id}</code>
                  </label>
                ))}
              </fieldset>
            )}
            {!groups.size && <p className="text-xs text-muted">{query ? "Ningún modelo coincide con la búsqueda." : "El catálogo de modelos de chat está vacío."}</p>}
          </div>
          {draft.ids.length === 0 && <p className="border-t border-line px-3 py-2 text-xs text-muted">Con este menú vacío, la clave no tendrá acceso a ningún modelo.</p>}
        </div>
      ) : <p className="mt-1 text-xs text-muted">Incluye todos los modelos habilitados y los que habilites más adelante.</p>}
    </fieldset>
  );
}
