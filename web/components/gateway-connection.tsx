"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { when } from "@/lib/format";
import type { ApiKeyRecord, GatewayModel } from "@/lib/types";

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

function codeExample(language: Language, base: string, model?: string) {
  const url = JSON.stringify(base);
  const id = JSON.stringify(model);
  if (language === "JavaScript") {
    const action = model
      ? `const chat = await client.chat.completions.create({
  model: ${id},
  messages: [{ role: "user", content: "Hola" }],
});
console.log(chat.choices[0].message.content);`
      : `const menu = await client.models.list();
console.log(menu.data.map(model => model.id));`;
    return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: ${url},
  apiKey: process.env.JOKMA_API_KEY,
});

${action}`;
  }
  const action = model
    ? `chat = client.chat.completions.create(
    model=${id},
    messages=[{"role": "user", "content": "Hola"}],
)
print(chat.choices[0].message.content)`
    : `menu = client.models.list()
print([model.id for model in menu.data])`;
  return `import os
from openai import OpenAI

client = OpenAI(
    base_url=${url},
    api_key=os.environ["JOKMA_API_KEY"],
)

${action}`;
}

// Highlight the displayed source as text so configuration values never become HTML.
function highlight(line: string) {
  return line.split(/("(?:[^"\\]|\\.)*"|\b(?:const|from|import|new|await)\b)/g).map((part, index) => {
    if (!part) return null;
    const color = part.startsWith('"') ? "text-ok" : /^(const|from|import|new|await)$/.test(part) ? "text-accent" : undefined;
    return <span key={index} className={color}>{part}</span>;
  });
}

export function GatewayConnection({ keys, models, publicBase }: {
  keys: ApiKeyRecord[];
  models: GatewayModel[];
  publicBase?: string;
}) {
  const [origin, setOrigin] = useState("");
  const [keyId, setKeyId] = useState("");
  const [selection, setSelection] = useState("");
  const [example, setExample] = useState("chat");
  const [language, setLanguage] = useState<Language>("Python");
  useEffect(() => setOrigin(window.location.origin), []);

  const base = publicBase || (origin && `${origin}/v1`);
  const activeKeys = keys.filter((key) => !key.revoked_at);
  const key = activeKeys.find((item) => item.id === keyId) ?? activeKeys[0];
  const allowed = key?.model_ids == null ? null : new Set(key.model_ids);
  const options = models.filter((model) => model.available && (!allowed || allowed.has(model.id)))
    .flatMap((model) => {
      const canonical = { value: model.public_id, label: model.public_id };
      return !allowed && model.alias
        ? [{ value: model.alias, label: `${model.alias} (alias)` }, canonical]
        : [canonical];
    });
  const selected = options.find((option) => option.value === selection)?.value ?? options[0]?.value;
  const listMenu = example === "menu";
  const source = base && (listMenu || selected) ? codeExample(language, base, listMenu ? undefined : selected) : "";

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
          {key && (
            <label className="block text-sm font-medium">
              Clave de la aplicación
              <select value={key.id} onChange={(event) => setKeyId(event.target.value)}
                className="mt-2 block min-h-11 w-full rounded-xl border border-line bg-ink px-3 text-sm text-paper">
                {activeKeys.map((item) => <option key={item.id} value={item.id}>{item.name} · {when(item.created_at)}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm font-medium">
            Ejemplo de integración
            <select value={example} onChange={(event) => setExample(event.target.value)}
              className="mt-2 block min-h-11 w-full rounded-xl border border-line bg-ink px-3 text-sm text-paper">
              <option value="chat">Enviar un mensaje</option>
              <option value="menu">Cargar el menú de modelos</option>
            </select>
          </label>
          {listMenu ? (
            <p className="text-sm leading-relaxed text-muted">Usa los identificadores que devuelve <code>GET /v1/models</code> como opciones del menú de tu app.</p>
          ) : selected ? (
            <label className="block text-sm font-medium">
              Modelo del mensaje
              <select value={selected} onChange={(event) => setSelection(event.target.value)}
                className="mono mt-2 block min-h-11 w-full rounded-xl border border-line bg-ink px-3 text-xs text-paper">
                {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : (
            <p className="text-sm leading-relaxed text-muted">
              {allowed
                ? <>El menú de esta clave está vacío o sus modelos están inactivos. Revisa <a href="#keys-list" className="text-accent underline">Tus claves</a> y <Link href="/modelos" className="text-accent underline">Modelos</Link>.</>
                : <>Activa un <Link href="/proveedores" className="text-accent underline">proveedor</Link> y añade un <Link href="/modelos" className="text-accent underline">modelo</Link> para generar el ejemplo.</>}
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
