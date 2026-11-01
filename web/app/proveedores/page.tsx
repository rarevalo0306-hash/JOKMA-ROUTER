import { ProvidersPanel } from "@/components/providers-panel";
import { adminGet } from "@/lib/admin";
import type { AdapterInfo, Provider } from "@/lib/types";

export const metadata = { title: "Proveedores" };

export default async function ProvidersPage() {
  const [providers, catalog] = await Promise.all([
    adminGet<Provider[]>("/admin/providers"),
    adminGet<{ adapters: AdapterInfo[] }>("/admin/adapters"),
  ]);
  return <ProvidersPanel providers={providers} adapters={catalog.adapters} />;
}
