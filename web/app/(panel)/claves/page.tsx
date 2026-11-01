import { KeysPanel } from "@/components/keys-panel";
import { adminGet } from "@/lib/admin";
import type { ApiKeyRecord } from "@/lib/types";

export const metadata = { title: "Claves" };

export default async function KeysPage() {
  const keys = await adminGet<ApiKeyRecord[]>("/admin/api-keys");
  return <KeysPanel keys={keys} />;
}
