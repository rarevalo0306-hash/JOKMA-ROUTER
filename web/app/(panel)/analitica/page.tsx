import { adminGet } from "@/lib/admin";
import { STATUS_LABEL, money, tokens, when } from "@/lib/format";
import type { UsageSummary } from "@/lib/types";

export const metadata = { title: "Analítica" };

export default async function AnalyticsPage() {
  const summary = await adminGet<UsageSummary>("/admin/usage/summary");
  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Analítica</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Tokens por aplicación, latencia media y costo estimado por modelo. El costo sale de la
          tabla de precios del catálogo y es una estimación, no una factura.
        </p>
      </header>
      {summary.requests === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-panel px-6 py-12 text-center">
          <p className="text-lg font-medium">Aún no hay uso</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            Cuando una aplicación llame a <span className="mono text-paper">/v1/chat/completions</span>,
            los totales aparecerán aquí.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Peticiones" value={tokens(summary.requests)} />
            <Stat
              label="Latencia media"
              value={summary.avg_latency_ms == null ? "—" : `${Math.round(summary.avg_latency_ms)} ms`}
            />
            <Stat label="Costo estimado" value={money(summary.estimated_cost)} />
          </div>

          <article className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="text-lg font-semibold">Tokens por aplicación</h2>
            <div className="mt-4 space-y-3">
              {summary.tokens_by_app.map((row) => {
                const total = row.prompt_tokens + row.completion_tokens;
                const max = Math.max(
                  ...summary.tokens_by_app.map((item) => item.prompt_tokens + item.completion_tokens),
                  1,
                );
                return (
                  <div key={row.app}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{row.app}</span>
                      <span className="mono text-muted">{tokens(total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-panel-2" aria-hidden>
                      <div
                        className="h-2 rounded-full bg-citron"
                        style={{ width: `${Math.max(4, (total / max) * 100)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {tokens(row.prompt_tokens)} de entrada · {tokens(row.completion_tokens)} de salida ·{" "}
                      {tokens(row.requests)} peticiones
                    </p>
                  </div>
                );
              })}
            </div>
          </article>

          <article className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="text-lg font-semibold">Costo estimado por modelo</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Costo estimado agrupado por el modelo que respondió</caption>
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Modelo servido</th>
                    <th className="py-2 pr-3 font-medium">Costo</th>
                    <th className="py-2 pr-3 font-medium">Tokens</th>
                    <th className="py-2 font-medium">Peticiones</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.cost_by_model.map((row) => (
                    <tr key={row.model} className="border-t border-line">
                      <td className="mono py-2 pr-3">{row.model}</td>
                      <td className="py-2 pr-3">{money(row.estimated_cost)}</td>
                      <td className="py-2 pr-3">{tokens(row.prompt_tokens + row.completion_tokens)}</td>
                      <td className="py-2">{tokens(row.requests)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-2xl border border-line bg-panel p-5">
            <h2 className="text-lg font-semibold">Actividad reciente</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Últimas peticiones registradas</caption>
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Aplicación</th>
                    <th className="py-2 pr-3 font-medium">Pedido</th>
                    <th className="py-2 pr-3 font-medium">Servido</th>
                    <th className="py-2 pr-3 font-medium">Estado</th>
                    <th className="py-2 pr-3 font-medium">Latencia</th>
                    <th className="py-2 font-medium">Cuándo</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recent.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="py-2 pr-3">{row.app_name}</td>
                      <td className="mono py-2 pr-3">{row.model_requested}</td>
                      <td className="mono py-2 pr-3">{row.model_served ?? "—"}</td>
                      <td className="py-2 pr-3">{STATUS_LABEL[row.status]}</td>
                      <td className="py-2 pr-3">{row.latency_ms} ms</td>
                      <td className="py-2">{when(row.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </article>
  );
}
