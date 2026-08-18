import { notFound } from "next/navigation";
import { SectionStatus } from "@/features/sections/section-status";
import { parseRuntimeConfig, resolvePublicServer } from "@/lib/server/config/runtime-config";

const SECTIONS = {
  map: ["Map", "Factory locations and logistics topology on an original map surface."],
  power: ["Power", "Grid capacity, demand, reserve, and fuse events over time."],
  production: ["Production", "Item throughput, rates, and production trends."],
  bottlenecks: ["Bottlenecks", "Explainable constraints with supporting evidence."],
  factories: ["Factories", "Machine groups, utilization, recipes, and efficiency."],
  storage: ["Storage", "Inventory levels and capacity risk by normalized item."],
  trains: ["Trains", "Rail vehicles, stations, timetables, and service state."],
  drones: ["Drones", "Drone ports, routes, batteries, and transfer rates."],
  players: ["Players", "Online presence and safe public player summaries."],
  history: ["History", "Durable telemetry trends and retention-aware comparisons."],
} as const;

type Section = keyof typeof SECTIONS;
type AsyncRecord = Promise<Record<string, string | string[] | undefined>>;

export default async function PlannedSectionPage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: AsyncRecord }) {
  const { section } = await params;
  if (!(section in SECTIONS)) notFound();
  const [title, description] = SECTIONS[section as Section];
  let serverName = "Server configuration unavailable";
  try {
    const config = parseRuntimeConfig(process.env);
    const query = await searchParams;
    const selected = typeof query.serverId === "string" ? query.serverId : config.defaultServerId;
    let server;
    try { server = resolvePublicServer(config, selected); }
    catch { server = resolvePublicServer(config, config.defaultServerId); }
    serverName = server.displayName;
  } catch { /* rendered honestly above */ }
  return <SectionStatus title={title} description={description} serverName={serverName} />;
}
