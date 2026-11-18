"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./console-search.css";

const destinations = [
  { label: "Inicio", href: "/", terms: "resumen consola dashboard" },
  { label: "Proveedores", href: "/proveedores", terms: "conexiones apis cuentas local remoto ollama" },
  { label: "Modelos", href: "/modelos", terms: "catalogo alias respaldo" },
  { label: "Analítica", href: "/analitica", terms: "consumo coste costo uso tokens" },
  { label: "Claves", href: "/claves", terms: "credenciales api crear revocar" },
  { label: "Conectar mi app", href: "/claves#conectar-mi-app", terms: "guia sdk url base ejemplo python javascript codigo" },
] as const;

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function Magnifier() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" />
  </svg>;
}

export function ConsoleSearch() {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);
  const words = normalize(query).split(/\s+/);
  const matches = destinations.filter(({ label, terms }) => words.every((word) => normalize(`${label} ${terms}`).includes(word)));

  function show() {
    if (dialog.current?.open) return;
    setQuery("");
    setActive(0);
    dialog.current?.showModal();
    input.current?.focus();
  }

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    function onShortcut(event: globalThis.KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || (!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (event.repeat) return;
      if (dialog.current?.open) dialog.current.close();
      else show();
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  function choose(index: number) {
    const destination = matches[index];
    if (!destination) return;
    dialog.current?.close();
    router.push(destination.href);
  }

  function navigate(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !matches.length) return;
    if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length;
      setActive(next);
      dialog.current?.querySelector(`#console-result-${next}`)?.scrollIntoView({ block: "nearest" });
    }
  }

  return (
    <>
      <button type="button" className="palette-trigger" aria-label="Buscar en la consola" title={`Buscar en la consola (${mac ? "⌘" : "Ctrl+"}K)`}
        aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" onClick={show}>
        <Magnifier /><kbd aria-hidden="true">{mac ? "⌘ K" : "Ctrl K"}</kbd>
      </button>
      <dialog ref={dialog} aria-label="Buscar en la consola" className="console-palette"
        onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}>
        <div className="palette-body">
          <div className="palette-input-row">
            <Magnifier />
            <input ref={input} role="combobox" aria-label="Buscar sección o guía" aria-autocomplete="list" aria-expanded="true" aria-controls="console-results"
              aria-activedescendant={matches[active] ? `console-result-${active}` : undefined}
              placeholder="Buscar en la consola…" value={query} onKeyDown={navigate}
              onChange={(event) => { setQuery(event.target.value); setActive(0); }} autoComplete="off" spellCheck={false} />
            <button type="button" className="palette-close" aria-label="Cerrar búsqueda" onClick={() => dialog.current?.close()}>Esc</button>
          </div>
          <ul id="console-results" className="palette-results" role="listbox" aria-label="Destinos">
            {matches.map(({ label, href }, index) => (
              <li key={href} id={`console-result-${index}`} role="option" aria-selected={active === index}
                onPointerMove={() => setActive(index)} onClick={() => choose(index)}>
                <span>{label}</span><span className="palette-arrow" aria-hidden="true">↗</span>
              </li>
            ))}
          </ul>
          {!matches.length && <p role="status" className="palette-empty">Sin resultados para «{query}».</p>}
        </div>
      </dialog>
    </>
  );
}
