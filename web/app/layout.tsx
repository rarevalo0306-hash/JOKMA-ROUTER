import type { Metadata } from "next";
import { Shell } from "@/components/shell";
import { apiOnline } from "@/lib/admin";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "JOKMA Router", template: "%s · JOKMA Router" },
  description: "Puerta de enlace privada de modelos.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const online = await apiOnline();
  return (
    <html lang="es">
      <body>
        <Shell online={online}>{children}</Shell>
      </body>
    </html>
  );
}
