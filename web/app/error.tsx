"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div role="alert" className="max-w-xl rounded-2xl border border-line bg-panel p-6">
      <h1 className="text-xl font-semibold">No se pudo cargar esta sección</h1>
      <p className="mt-2 text-sm text-muted">
        Revisa que FastAPI esté en marcha y que ADMIN_API_KEY sea el mismo en el panel y en la API.
      </p>
      <p className="mt-3 text-sm text-danger">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-full bg-citron px-4 py-2 text-sm font-semibold text-ink"
      >
        Reintentar
      </button>
    </div>
  );
}
