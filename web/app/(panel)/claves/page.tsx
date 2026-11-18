import { KeysPanel } from "@/components/keys-panel";
import { adminGet } from "@/lib/admin";
import { readEnv } from "@/lib/env";
import { chatRoutableProviders, providerTitle } from "@/lib/provider-groups";
import type { ApiKeyRecord, CatalogModel, GatewayModel, Provider } from "@/lib/types";

export const metadata = { title: "Claves" };

export default async function KeysPage() {
  const [keys, models, providers] = await Promise.all([
    adminGet<ApiKeyRecord[]>("/admin/api-keys"),
    adminGet<CatalogModel[]>("/admin/models"),
    adminGet<Provider[]>("/admin/providers"),
  ]);
  const chatProviders = new Map(chatRoutableProviders(providers).map((provider) => [provider.id, provider]));
  const menuModels: GatewayModel[] = models
    .flatMap((model) => {
      const provider = chatProviders.get(model.provider_id);
      if (!provider) return [];
      return [{
        id: model.id,
        public_id: model.public_id,
        alias: model.alias,
        name: model.name,
        provider_name: model.provider_name,
        provider_label: providerTitle(provider),
        available: model.enabled && provider.enabled,
      }];
    });
  return <KeysPanel keys={keys} models={menuModels} publicBase={readEnv("PUBLIC_API_BASE_URL")?.replace(/\/+$/, "")} />;
}
