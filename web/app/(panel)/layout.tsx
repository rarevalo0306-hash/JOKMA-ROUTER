import { Shell } from "@/components/shell";
import { apiOnline } from "@/lib/admin";
import { isAllowedEmail } from "@/lib/allowlist";
import { readEnv } from "@/lib/env";
import { panelOrigin } from "@/lib/google";
import { readSession, SESSION_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSession(token, readEnv("AUTH_SECRET"));
  if (!session || !isAllowedEmail(session.email, readEnv("PANEL_ALLOWED_EMAILS"))) {
    const configured = readEnv("AUTH_URL");
    redirect(configured ? `${panelOrigin(configured, configured)}/login` : "/login");
  }
  const online = await apiOnline();
  return (
    <Shell online={online} email={session.email}>
      {children}
    </Shell>
  );
}
