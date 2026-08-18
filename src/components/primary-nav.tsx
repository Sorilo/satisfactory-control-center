"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  ["Overview", "/"], ["Map", "/map"], ["Power", "/power"],
  ["Production", "/production"], ["Bottlenecks", "/bottlenecks"],
  ["Factories", "/factories"], ["Storage", "/storage"], ["Trains", "/trains"],
  ["Drones", "/drones"], ["Players", "/players"], ["History", "/history"],
] as const;

const MOBILE_PRIMARY_COUNT = 4;

export function PrimaryNav({ serverId }: { serverId: string }) {
  const pathname = usePathname();
  const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
  const link = ([name, href]: (typeof NAV_ITEMS)[number]) => {
    const current = pathname === href;
    return (
      <li key={name}>
        <Link href={`${href}${query}`} aria-current={current ? "page" : undefined}>{name}</Link>
      </li>
    );
  };

  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      <ul className="primary-nav__all">{NAV_ITEMS.map(link)}</ul>
      <details className="primary-nav__more">
        <summary>More</summary>
        <ul>{NAV_ITEMS.slice(MOBILE_PRIMARY_COUNT).map(link)}</ul>
      </details>
    </nav>
  );
}
