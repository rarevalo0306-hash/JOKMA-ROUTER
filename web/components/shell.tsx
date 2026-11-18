"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { ConsoleSearch } from "./console-search";
import { OrbitMark } from "./orbit-mark";

const sections = [
  { href: "/", label: "Inicio", icon: "home" },
  { href: "/proveedores", label: "Proveedores", icon: "nodes" },
  { href: "/modelos", label: "Modelos", icon: "layers" },
  { href: "/claves", label: "Claves", icon: "key" },
  { href: "/analitica", label: "Analítica", icon: "chart" },
] as const;

type IconName = (typeof sections)[number]["icon"] | "exit" | "book";

function Icon({ name }: { name: IconName }) {
  const shapes = {
    home: <><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4.5v-7h-5v7H5a2 2 0 0 1-2-2z" /></>,
    nodes: <><rect x="3.5" y="3.5" width="6" height="6" rx="1.5" /><rect x="14.5" y="14.5" width="6" height="6" rx="1.5" /><path d="M9.5 6.5h5a3 3 0 0 1 3 3v5M6.5 9.5v5a3 3 0 0 0 3 3h5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12.2l9 5 9-5M3 16.5l9 5 9-5" /></>,
    key: <><circle cx="15.5" cy="8.5" r="5.5" /><path d="m11 12-8 8v1h4l1-3h3l2.4-4.2M17 7h.01" /></>,
    chart: <><path d="M3.5 3.5V20h17M7.5 15.5l4-5 3.4 2.2L20 6.5" /></>,
    exit: <><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5m4-13 5 5-5 5M8 12h11" /></>,
    book: <><path d="M12 6c-2-2-6-2-9-1v14c3-1 7-1 9 1 2-2 6-2 9-1V5c-3-1-7-1-9 1Zm0 0v14" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>;
}

function Brand() {
  return <Link href="/" className="console-brand" aria-label="JOKMA Router, inicio">
    <OrbitMark /><span>JOKMA<span className="brand-suffix">Router</span></span>
  </Link>;
}

export function Shell({ online, email, children }: { online: boolean; email: string; children: React.ReactNode }) {
  const path = usePathname();
  const account = useRef<HTMLDetailsElement>(null);
  return (
    <div className="console-frame">
      <a className="console-skip" href="#contenido">Ir al contenido</a>
      <header className="console-topbar">
        <div className="console-bar-inner">
          <Brand />
          <nav className="console-nav" aria-label="Secciones">
            {sections.map(({ href, label, icon }) => (
              <Link key={href} href={href} className="console-nav-link" aria-current={path === href ? "page" : undefined}>
                <Icon name={icon} /><span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="console-tools">
            <span className={online ? "console-health" : "console-health is-down"}><i />{online ? "API en línea" : "API sin conexión"}</span>
            <ConsoleSearch />
            <details className="console-account" ref={account}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}
              onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; account.current?.querySelector("summary")?.focus(); } }}>
              <summary aria-label="Menú de cuenta" title={email}>{email.slice(0, 1).toUpperCase()}</summary>
              <div className="console-popover">
                <strong>Mi cuenta</strong><span>{email}</span>
                <Link href="/claves#conectar-mi-app" onClick={() => { if (account.current) account.current.open = false; }}><Icon name="book" />Guía de conexión</Link>
                <form action="/api/auth/signout" method="post"><button type="submit"><Icon name="exit" />Cerrar sesión</button></form>
              </div>
            </details>
          </div>
        </div>
      </header>
      <main id="contenido" className="console-content">{children}</main>
    </div>
  );
}
