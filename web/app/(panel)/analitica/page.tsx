import { adminGet } from "@/lib/admin";
import { STATUS_LABEL, money, tokens, when } from "@/lib/format";
import type { UsageSummary } from "@/lib/types";
import styles from "@/components/catalog.module.css";

export const metadata = { title: "Analítica" };

export default async function AnalyticsPage() {
  const summary = await adminGet<UsageSummary>("/admin/usage/summary");
  const maxTokens = Math.max(1, ...summary.tokens_by_app.map((row) => row.prompt_tokens + row.completion_tokens));

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Analítica</h1>
          <p>Uso de la API, rendimiento y costos estimados según los precios de tu catálogo.</p>
        </div>
      </header>
      <dl className={styles.stats}>
        <Stat label="Peticiones" value={tokens(summary.requests)} />
        <Stat label="Tokens totales" value={tokens(summary.prompt_tokens + summary.completion_tokens)} />
        <Stat label="Latencia media" value={summary.avg_latency_ms == null ? "—" : `${tokens(Math.round(summary.avg_latency_ms))} ms`} />
        <Stat label="Costo estimado" value={money(summary.estimated_cost)} />
      </dl>

      {summary.requests === 0 ? (
        <div className={styles.emptyActivity}>
          <span aria-hidden className={styles.chartGlyph}><i /><i /><i /><i /></span>
          <h2>Aún no hay actividad</h2>
          <p>La primera petición a <code>/v1/chat/completions</code> aparecerá aquí.</p>
        </div>
      ) : (
        <>
          <div className={styles.analyticsGrid}>
            <article className={styles.surface}>
              <header className={styles.cardHeader}>
                <h2>Tokens por aplicación</h2>
                <div className={styles.legend}><span>Entrada</span><span>Salida</span></div>
              </header>
              <div className={styles.bars}>
                {summary.tokens_by_app.map((row) => (
                  <div className={styles.barRow} key={row.app}>
                    <div><strong>{row.app}</strong><span>{tokens(row.prompt_tokens + row.completion_tokens)}</span></div>
                    <div aria-hidden className={styles.track}>
                      <i style={{ width: `${(row.prompt_tokens / maxTokens) * 100}%` }} />
                      <i style={{ width: `${(row.completion_tokens / maxTokens) * 100}%` }} />
                    </div>
                    <p>{tokens(row.prompt_tokens)} de entrada · {tokens(row.completion_tokens)} de salida · {tokens(row.requests)} peticiones</p>
                  </div>
                ))}
              </div>
            </article>

            <article className={styles.surface}>
              <header className={styles.cardHeader}><h2>Costo por modelo</h2></header>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <caption className="sr-only">Costo estimado por modelo servido</caption>
                  <thead><tr><th>Modelo servido</th><th>Costo</th><th>Tokens</th><th>Peticiones</th></tr></thead>
                  <tbody>
                    {summary.cost_by_model.map((row) => (
                      <tr key={row.model}>
                        <td><code>{row.model}</code></td>
                        <td className={styles.numeric}>{money(row.estimated_cost)}</td>
                        <td>{tokens(row.prompt_tokens + row.completion_tokens)}</td>
                        <td>{tokens(row.requests)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {summary.cost_by_model.length === 0 && <p className={styles.empty}>Aún no hay costos asignados a modelos.</p>}
              </div>
            </article>
          </div>

          <article className={styles.surface}>
            <header className={styles.cardHeader}><h2>Actividad reciente</h2></header>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <caption className="sr-only">Últimas peticiones registradas</caption>
                <thead><tr><th>Aplicación</th><th>Modelo pedido</th><th>Modelo servido</th><th>Estado</th><th>Latencia</th><th>Fecha</th></tr></thead>
                <tbody>
                  {summary.recent.map((row) => (
                    <tr key={row.id}>
                      <td>{row.app_name}</td>
                      <td><code>{row.model_requested}</code></td>
                      <td><code>{row.model_served ?? "—"}</code></td>
                      <td><span className={styles[row.status]}>{STATUS_LABEL[row.status]}</span></td>
                      <td className={styles.numeric}>{tokens(row.latency_ms)} ms</td>
                      <td>{when(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
