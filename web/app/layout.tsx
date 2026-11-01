import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "JOKMA Router", template: "%s · JOKMA Router" },
  description: "Puerta de enlace privada de modelos.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
