"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CatalogModel } from "@/lib/types";

export type GatewayModel = Pick<CatalogModel, "public_id" | "alias">;

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => setStatus("idle"), [value]);
  useEffect(() => {
    if (status === "idle") return;
    const timeout = window.setTimeout(() => setStatus("idle"), 3500);
    return () => window.clearTimeout(timeout);
  }, [status]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <button type="button" onClick={copy} disabled={!value} data-status={status} title={label}
      className="inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-xs font-medium text-paper transition hover:border-accent/60 hover:text-accent disabled:opacity-50">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {status === "copied" ? <path d="m5 12 4 4L19 6" /> : <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3" /></>}
      </svg>
      <span aria-live="polite">{status === "copied" ? "Copiado" : status === "error" ? "Copia manual" : label}</span>
    </button>
  );
}

const languages = ["Python", "JavaScript"] as const;
type Language = (typeof languages)[number];

function codeExample(language: Language, base: string, model: string) {
  const url = JSON.stringify(base);
  const id = JSON.stringify(model);
  if (language === "JavaScript") {
    return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: ${url},
  apiKey: process.env.JOKMA_API_KEY,
});

const chat = await client.chat.completions.create({
  model: ${id},
  messages: [{ role: "user", content: "Hola" }],
});
console.log(chat.choices[0].message.content);`;
  }
  return `import os
from openai import OpenAI

client = OpenAI(
    base_url=${url},
    api_key=os.environ["JOKMA_API_KEY"],
)

chat = client.chat.completions.create(
    model=${id},
    messages=[{"role": "user", "content": "Hola"}],
)
print(chat.choices[0].message.content)`;
}

// Highlight the displayed source as text so configuration values never become HTML.
function highlight(line: string) {
  return line.split(/("(?:[^"\\]|\\.)*"|\b(?:const|from|import|new|await)\b)/g).map((part, index) => {
    if (!part) return null;
    const color = part.startsWith('"') ? "text-ok" : /^(const|from|import|new|await)$/.test(part) ? "text-accent" : undefined;
    return <span key={index} className={color}>{part}</span>;
  });
}

export function GatewayConnection({ models, publicBase }: { models: GatewayModel[]; publicBase?: string }) {
  const [origin, setOrigin] = useState("");
  const [selection, setSelection] = useState("");
  const [language, setLanguage] = useState<Language>("Python");
  useEffect(() => setOrigin(window.location.origin), []);

  const base = publicBase || (origin && `${origin}/v1`);
  const selected = models.some((m) => m.public_id === selection || m.alias === selection)
    ? selection
    : models.find((m) => m.alias)?.alias || models[0]?.public_id;
  const source = selected && base ? codeExample(language, base, selected) : "";

  return (
    <section id="conectar-mi-app" aria-labelledby="connect-app" className="min-w-0 scroll-mt-24 rounded-2xl border border-line bg-panel">
      <header className="flex items-center gap-3 border-b border-line px-5 py-4 sm:px-6">
        <span aria-hidden="true" className="mono grid h-9 w-9 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-sm font-semibold text-accent">&lt;/&gt;</span>
        <h2 id="connect-app" className="text-lg font-semibold tracking-tight">Conectar mi app</h2>
      </header>
      <div className="grid min-w-0 gap-5 p-5 sm:p-6 xl:grid-cols-[minmax(220px,.8fr)_minmax(0,1.2fr)]">
        <div className="min-w-0 space-y-4">
          <div>
            <label htmlFor="sdk-base" className="text-sm font-medium">URL base</label>
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink px-3 py-2">
              <input id="sdk-base" readOnly value={base} onFocus={(event) => event.target.select()}
                className="mono min-w-24 flex-1 bg-transparent py-1 text-xs text-paper" />
              <CopyButton value={base} label="Copiar URL" />
            </div>
          </div>
          {selected ? (
            <label className="block text-sm font-medium">
              Modelo o alias
              <select value={selected} onChange={(event) => setSelection(event.target.value)}
                className="mono mt-2 block min-h-11 w-full rounded-xl border border-line bg-ink px-3 text-xs text-paper">
                {models.map((model) => (
                  <optgroup key={model.public_id} label={model.public_id}>
                    {model.alias && <option value={model.alias}>{model.alias} (alias)</option>}
                    <option value={model.public_id}>{model.public_id}</option>
                  </optgroup>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              Activa un <Link href="/proveedores" className="text-accent underline">proveedor</Link> y añade un <Link href="/modelos" className="text-accent underline">modelo</Link> para generar el ejemplo.
            </p>
          )}
          <p className="text-sm leading-relaxed text-muted">Guarda la clave del router en la variable <code className="text-paper">JOKMA_API_KEY</code> del servidor de tu app.</p>
        </div>
        {source && (
          <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-ink">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel-2/45 px-3 py-2">
              <div role="group" aria-label="Lenguaje del ejemplo" className="inline-flex gap-0.5">
                {languages.map((item) => (
                  <button type="button" key={item} aria-pressed={language === item} onClick={() => setLanguage(item)}
                    className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${language === item ? "bg-accent/15 text-accent" : "text-muted hover:text-paper"}`}>
                    {item}
                  </button>
                ))}
              </div>
              <CopyButton value={source} label="Copiar código" />
            </div>
            <pre tabIndex={0} aria-label={`Ejemplo en ${language}`} className="mono overflow-x-auto px-4 py-4 text-[12px] leading-6 text-paper">
              <code>{source.split("\n").map((line, index) => (
                <span className="block" key={index}><span aria-hidden="true" className="mr-4 inline-block w-4 select-none text-right text-muted/65">{index + 1}</span>{highlight(line)}</span>
              ))}</code>
            </pre>
            <div className="border-t border-line px-4 py-2 text-xs text-muted">Instalación <code className="ml-2 text-paper">{language === "Python" ? "pip install openai" : "npm install openai"}</code></div>
          </div>
        )}
      </div>
    </section>
  );
}
