"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/proveedores", "Proveedores"],
  ["/modelos", "Modelos"],
  ["/analitica", "Analítica"],
  ["/claves", "Claves"],
] as const;

export function Shell({
  online,
  email,
  children,
}: {
  online: boolean;
  email: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-6 px-4 py-6 md:grid-cols-[220px_1fr] md:px-6">
      <aside className="md:sticky md:top-6 md:self-start">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-citron font-semibold text-on-accent">
            JR
          </span>
          <div>
            <p className="text-sm font-semibold tracking-wide">JOKMA Router</p>
            <p className="text-xs text-muted">Puerta de enlace privada</p>
          </div>
        </div>
        <nav aria-label="Secciones" className="flex gap-2 overflow-auto md:flex-col">
          {LINKS.map(([href, label]) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`rounded-full px-3 py-2 text-sm md:rounded-xl ${
                  active ? "bg-citron font-semibold text-on-accent" : "text-paper hover:bg-panel"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <form action="/api/auth/signout" method="post" className="mt-6">
          <p className="mb-2 truncate text-xs text-muted">{email}</p>
          <button type="submit" className="rounded-full px-3 py-2 text-sm text-paper hover:bg-panel">
            Salir
          </button>
        </form>
      </aside>
      <div className="min-w-0">
        <p
          className={`mb-4 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1 text-xs ${
            online ? "text-ok" : "text-danger"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${online ? "bg-ok" : "bg-danger"}`} aria-hidden />
          {online ? "API en línea" : "La API no responde"}
        </p>
        {children}
      </div>
    </div>
  );
}
