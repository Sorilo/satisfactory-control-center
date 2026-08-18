import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getPublicServerCatalog, parseRuntimeConfig } from "@/lib/server/config/runtime-config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Satisfactory Control Center", template: "%s · Control Center" },
  description: "Read-only operations visibility for Satisfactory factories.",
};
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  let servers: ReturnType<typeof getPublicServerCatalog> = [];
  let defaultServerId: string | undefined;
  try {
    const config = parseRuntimeConfig(process.env);
    servers = getPublicServerCatalog(config);
    defaultServerId = config.defaultServerId;
  } catch {
    // The UI remains available as a diagnostic surface; readiness reports 503.
  }
  return <html lang="en"><body><AppShell servers={servers} defaultServerId={defaultServerId}>{children}</AppShell></body></html>;
}
