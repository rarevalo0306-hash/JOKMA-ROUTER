import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Iniciar sesión" };

const ERRORS: Record<string, string> = {
  denied: "Esta cuenta no tiene acceso.",
  config: "Falta conectar Google en el servidor.",
  oauth: "Google no pudo completar el acceso. Inténtalo de nuevo.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ready = Boolean(
    readEnv("AUTH_GOOGLE_ID") && readEnv("AUTH_GOOGLE_SECRET") && readEnv("AUTH_SECRET"),
  );
  const message = error ? ERRORS[error] : undefined;

  return (
    <main className="auth-shell grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-line bg-panel p-8">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-citron font-semibold text-on-accent">
          JR
        </span>
        <h1 className="mt-6 text-2xl font-semibold">Iniciar sesión</h1>
        <p className="mt-2 text-sm text-muted">
          Este panel es privado. Entra con la cuenta de Google autorizada.
        </p>
        {message ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {message}
          </p>
        ) : null}
        {ready ? (
          <a
            href="/api/auth/google"
            className="mt-6 inline-flex rounded-full bg-citron px-5 py-2.5 text-sm font-semibold text-on-accent"
          >
            Continuar con Google
          </a>
        ) : (
          <p className="mt-6 text-sm text-muted">El acceso con Google todavía no está conectado.</p>
        )}
      </section>
    </main>
  );
}
