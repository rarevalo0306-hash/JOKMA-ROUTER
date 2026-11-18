import { OrbitMark } from "@/components/orbit-mark";
import { readEnv } from "@/lib/env";
import "./login.css";

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
  const message = error && Object.hasOwn(ERRORS, error) ? ERRORS[error] : undefined;

  return (
    <main className="router-login">
      <header className="console-topbar">
        <div className="console-bar-inner">
          <div className="console-brand" aria-label="JOKMA Router">
            <OrbitMark />
            <span>JOKMA<span className="brand-suffix">Router</span></span>
          </div>
          <span className="router-login-private">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <rect x="5" y="10" width="14" height="10" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            Panel privado
          </span>
        </div>
      </header>

      <div className="router-login-layout">
        <section className="router-login-content" aria-labelledby="login-title">
          <h1 id="login-title">Inicia <em>sesión.</em></h1>
          <p className="router-login-description">
            Accede con tu cuenta de Google autorizada para gestionar los modelos, proveedores y claves de tu router.
          </p>
          <div className="router-login-action">
            {message ? <p className="router-login-error" role="alert">{message}</p> : null}
            {ready ? (
              <a className="router-login-google" href="/api/auth/google">
                <GoogleMark /> Continuar con Google
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 8h9m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            ) : (
              <>
                <button type="button" className="router-login-google" disabled>
                  <GoogleMark /> Continuar con Google
                </button>
                <p className="router-login-config">El acceso con Google todavía no está conectado.</p>
              </>
            )}
          </div>
        </section>
        <div className="router-login-art" aria-hidden="true" />
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#4285f4" d="M43.6 24.46c0-1.36-.12-2.66-.35-3.92H24v7.42h11a9.44 9.44 0 0 1-4.09 6.19v5.14h6.63c3.88-3.57 6.06-8.84 6.06-14.83Z" />
      <path fill="#34a853" d="M24 44c5.5 0 10.11-1.82 13.54-4.71l-6.63-5.14c-1.83 1.22-4.17 1.95-6.91 1.95-5.32 0-9.83-3.59-11.44-8.41H5.73v5.29A20.45 20.45 0 0 0 24 44Z" />
      <path fill="#fbbc05" d="M12.56 27.69a12.23 12.23 0 0 1 0-7.38v-5.29H5.73a19.87 19.87 0 0 0 0 17.96l6.83-5.29Z" />
      <path fill="#ea4335" d="M24 11.9c3.02 0 5.72 1.04 7.85 3.08l5.88-5.88A19.71 19.71 0 0 0 24 4 20.45 20.45 0 0 0 5.73 15.02l6.83 5.29A12.04 12.04 0 0 1 24 11.9Z" />
    </svg>
  );
}
