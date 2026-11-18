import Link from "next/link";
import { adminGet } from "@/lib/admin";
import { readEnv } from "@/lib/env";
import { STATUS_LABEL, tokens } from "@/lib/format";
import { isVideoProvider } from "@/lib/provider-groups";
import { GatewayAddress } from "@/components/gateway-address";
import { RouteMap } from "@/components/route-map";
import type { CatalogModel, Provider, UsageSummary } from "@/lib/types";
import "./overview.css";

export const metadata = { title: "Inicio" };

const icons = {
  network: <><rect x="9" y="3" width="6" height="6" rx="1.5" /><path d="M12 9v4M5 16v-3h14v3" /><rect x="2" y="16" width="6" height="5" rx="1.5" /><rect x="16" y="16" width="6" height="5" rx="1.5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
  requests: <><path d="M3 8h16m-4-4 4 4-4 4M21 16H5m4-4-4 4 4 4" /></>,
  time: <><circle cx="12" cy="12" r="8.5" /><path d="M12 6.5V12l3.5 2" /></>,
  arrow: <path d="M5 12h13m-5-5 5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  error: <path d="m7 7 10 10M17 7 7 17" />,
  fallback: <><path d="M5 4v6a4 4 0 0 0 4 4h10m-5-5 5 5-5 5" /></>,
};

function Glyph({ name }: { name: keyof typeof icons }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>;
}

function Metric({ name, label, value, unit, href }: {
  name: keyof typeof icons; label: string; value?: number; unit?: string; href: string;
}) {
  return (
    <Link href={href} className="studio-metric">
      <span className="metric-name"><Glyph name={name} />{label}</span>
      <span className="metric-value">{value == null ? "—" : tokens(value)}{unit && value != null && <small>{unit}</small>}</span>
    </Link>
  );
}

function Activity({ summary }: { summary?: UsageSummary }) {
  return (
    <section className="studio-activity">
      <header><h2>Actividad reciente</h2><Link href="/analitica" aria-label="Ver toda la actividad en Analítica"><Glyph name="arrow" /></Link></header>
      {summary?.recent.length ? <ul>{summary.recent.slice(0, 3).map((row) => (
        <li key={row.id}>
          <span className={`studio-event ${row.status}`} title={STATUS_LABEL[row.status]}>
            <Glyph name={row.status === "success" ? "check" : row.status} /><span className="sr-only">{STATUS_LABEL[row.status]}</span>
          </span>
          <div><strong>{row.app_name}</strong><code title={row.model_served ?? row.model_requested}>{row.model_served ?? row.model_requested}</code></div>
          <span className="studio-latency">{tokens(row.latency_ms)} <small>ms</small></span>
        </li>
      ))}</ul> : <div className="studio-empty">
        <Glyph name="requests" />
        <strong>{summary ? "Aún no hay peticiones" : "Actividad no disponible"}</strong>
        {summary && <Link href="/claves#conectar-mi-app">Conectar una aplicación <Glyph name="arrow" /></Link>}
      </div>}
    </section>
  );
}

export default async function Home() {
  const [providerResult, modelResult, usageResult] = await Promise.allSettled([
    adminGet<Provider[]>("/admin/providers"),
    adminGet<CatalogModel[]>("/admin/models"),
    adminGet<UsageSummary>("/admin/usage/summary"),
  ]);
  const providers = providerResult.status === "fulfilled" ? providerResult.value : undefined;
  const models = modelResult.status === "fulfilled" ? modelResult.value : undefined;
  const usage = usageResult.status === "fulfilled" ? usageResult.value : undefined;
  const enabled = providers && new Set(providers.filter((p) => p.enabled && !isVideoProvider(p)).map((p) => p.id));
  const modelCount = enabled && models?.filter((m) => m.enabled && enabled.has(m.provider_id)).length;
  return (
    <div className="studio-overview">
      <section className="studio-hero" aria-labelledby="studio-title">
        <div className="studio-light" aria-hidden="true" />
        <div className="studio-intro">
          <h1 id="studio-title">Centro de <em>control</em></h1>
          <p>Una sola API para tus modelos locales y de la nube.</p>
          <GatewayAddress publicBase={readEnv("PUBLIC_API_BASE_URL")?.replace(/\/+$/, "")} />
          <Link href="/claves#conectar-mi-app" className="studio-quicklink"><span>Conectar mi app</span><Glyph name="arrow" /></Link>
        </div>
      </section>

      <div className="studio-metrics" aria-label="Resumen del gateway">
        <Metric name="network" label="Proveedores habilitados" value={enabled?.size} href="/proveedores" />
        <Metric name="layers" label="Modelos disponibles" value={modelCount} href="/modelos" />
        <Metric name="requests" label="Peticiones totales" value={usage?.requests} href="/analitica" />
        <Metric name="time" label="Latencia media" value={usage?.avg_latency_ms == null ? undefined : Math.round(usage.avg_latency_ms)} unit="ms" href="/analitica" />
      </div>

      <div className="studio-bottom">
        {providers && models ? <RouteMap providers={providers} models={models} /> : (
          <section className="studio-activity"><header><h2>Mapa de rutas</h2></header><div className="studio-empty">No se pudo cargar el catálogo.</div></section>
        )}
        <Activity summary={usage} />
      </div>
    </div>
  );
}
