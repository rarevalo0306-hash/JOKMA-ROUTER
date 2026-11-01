import { ModelsPanel } from "@/components/models-panel";
import { adminGet } from "@/lib/admin";
import type { CatalogModel, Provider } from "@/lib/types";

export const metadata = { title: "Modelos" };

export default async function ModelsPage() {
  const [models, providers] = await Promise.all([
    adminGet<CatalogModel[]>("/admin/models"),
    adminGet<Provider[]>("/admin/providers"),
  ]);
  return <ModelsPanel models={models} providers={providers} />;
}
