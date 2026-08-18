"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { PrimaryNav } from "./primary-nav";

export interface AppShellServerEntry { id: string; displayName: string }
export interface AppShellProps {
  servers: AppShellServerEntry[];
  defaultServerId?: string;
  children: ReactNode;
}

export function resolveActiveServerId(
  servers: AppShellServerEntry[],
  defaultServerId: string | undefined,
  selectedServerId: string | null
): string {
  return selectedServerId && servers.some(({ id }) => id === selectedServerId)
    ? selectedServerId
    : defaultServerId ?? servers[0]?.id ?? "";
}

export function AppShell({ servers, defaultServerId, children }: AppShellProps) {
  const selectedServerId = useSearchParams().get("serverId");
  const activeServerId = resolveActiveServerId(servers, defaultServerId, selectedServerId);
  const query = activeServerId ? `?serverId=${encodeURIComponent(activeServerId)}` : "";

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href={`/${query}`} aria-label="Satisfactory Control Center overview">
          <span className="brand__mark" aria-hidden="true">F</span>
          <span><strong>FICSIT</strong><small>Control Center</small></span>
        </Link>
        <div className="topbar__signal" role="status" aria-label="Control center status">
          <span className="signal-dot" /> Monitoring
        </div>
        <form method="get" className="server-selector">
          <label htmlFor="active-server">Active server</label>
          <select key={activeServerId} id="active-server" name="serverId" defaultValue={activeServerId} disabled={servers.length === 0}>
            {servers.length === 0 ? <option>Configuration unavailable</option> : servers.map((server) => (
              <option key={server.id} value={server.id}>{server.displayName}</option>
            ))}
          </select>
          <button type="submit" disabled={servers.length === 0}>Apply</button>
        </form>
      </header>
      <PrimaryNav serverId={activeServerId} />
      <main className="content-shell">{children}</main>
      <footer className="app-footer">
        <span>Satisfactory Control Center</span><span>Read-only telemetry plane</span>
      </footer>
    </div>
  );
}
