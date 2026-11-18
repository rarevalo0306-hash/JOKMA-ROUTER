import { KeysPanel } from "@/components/keys-panel";
import { adminGet } from "@/lib/admin";
import { readEnv } from "@/lib/env";
import { chatRoutableProviders } from "@/lib/provider-groups";
import type { ApiKeyRecord, CatalogModel, Provider } from "@/lib/types";

export const metadata = { title: "Claves" };

export default async function KeysPage() {
  const [keys, models, providers] = await Promise.all([
    adminGet<ApiKeyRecord[]>("/admin/api-keys"),
    adminGet<CatalogModel[]>("/admin/models"),
    adminGet<Provider[]>("/admin/providers"),
  ]);
  const enabledProviders = new Set(
    chatRoutableProviders(providers).filter((provider) => provider.enabled).map((provider) => provider.id),
  );
  const modelIds = models
    .filter((model) => model.enabled && enabledProviders.has(model.provider_id))
    .map(({ public_id, alias }) => ({ public_id, alias }));
  return <KeysPanel keys={keys} models={modelIds} publicBase={readEnv("PUBLIC_API_BASE_URL")?.replace(/\/+$/, "")} />;
}
