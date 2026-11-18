"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Brand } from "@/components/provider-brand";
import { OrbitMark } from "@/components/orbit-mark";
import { providerTitle } from "@/lib/provider-groups";
import type { CatalogModel, Provider } from "@/lib/types";
import styles from "./route-map.module.css";

type Destination = { model: CatalogModel; provider: Provider };

export function RouteMap({ models, providers }: { models: CatalogModel[]; providers: Provider[] }) {
  const titleId = useId();
  const [requested, setRequested] = useState("");
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const destinations: Destination[] = [];
  for (const model of models) {
    const provider = providerById.get(model.provider_id);
    if (model.enabled && provider?.enabled && provider.kind !== "video" && provider.adapter !== "video") {
      destinations.push({ model, provider });
    }
  }
  const routes = destinations.flatMap((target) => (
    target.model.alias
      ? [{ ref: target.model.alias, target }, { ref: target.model.public_id, target }]
      : [{ ref: target.model.public_id, target }]
  ));
  const modelById = new Map(destinations.map((target) => [target.model.id, target]));
  function firstFallback(model: CatalogModel) {
    for (const id of model.fallback_model_ids) {
      const candidate = modelById.get(id);
      if (candidate && id !== model.id) return candidate;
    }
  }
  const selected = routes.find(({ ref }) => ref === requested)
    ?? routes.find(({ target }) => firstFallback(target.model))
    ?? routes[0];
  const fallback = selected && firstFallback(selected.target.model);

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <header className={styles.heading}>
        <h2 id={titleId}>Mapa de rutas</h2>
        {selected && (
          <select aria-label="Modelo o alias del mapa" value={selected.ref} onChange={(event) => setRequested(event.target.value)}>
            {routes.map(({ ref }) => <option key={ref} value={ref}>{ref}</option>)}
          </select>
        )}
      </header>
      {selected ? (
        <div className={styles.canvas}>
          <div className={styles.diagram} data-fallback={Boolean(fallback)}>
            <div className={styles.app}>
              <span className={styles.appIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m7 10 2 2-2 2m5 1h3" />
                </svg>
              </span>
              <span>Tu app</span>
            </div>
            <span className={styles.incoming} aria-hidden="true" />
            <div className={styles.router}>
              <OrbitMark />
              <span>JOKMA Router</span>
            </div>
            <svg className={styles.outgoing} aria-hidden="true" viewBox="0 0 100 144" preserveAspectRatio="none" fill="none">
              {fallback ? (
                <>
                  <path d="M0 72H30C57 72 44 36 72 36H100" />
                  <path className={styles.secondaryLine} d="M30 72C57 72 44 108 72 108H100" />
                </>
              ) : <path d="M0 72H100" />}
            </svg>
            <svg aria-hidden="true" className={styles.mobileLines} viewBox="0 0 100 34" preserveAspectRatio="none" fill="none">
              <path d="M78 0V34" />
              {fallback && <path className={styles.secondaryLine} d="M78 3V6Q78 17 69 17H31Q22 17 22 28V34" />}
            </svg>
            <div className={styles.targets} aria-live="polite" aria-atomic="true">
              <Target destination={selected.target} />
              {fallback && <Target destination={fallback} fallback />}
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.empty}>
          <p>Activa un modelo y su proveedor para ver la ruta.</p>
          <Link href="/modelos">Abrir modelos <span aria-hidden="true">→</span></Link>
        </div>
      )}
    </section>
  );
}

function Target({ destination, fallback = false }: { destination: Destination; fallback?: boolean }) {
  const { model, provider } = destination;
  return (
    <div className={fallback ? styles.fallback : styles.primary}>
      <Brand provider={provider} />
      <div className={styles.targetText}>
        <span>{fallback ? "Respaldo" : "Principal"} · {providerTitle(provider)}</span>
        <strong title={model.public_id}>{model.name}</strong>
      </div>
    </div>
  );
}
