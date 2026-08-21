import type { Provenance } from "@/contracts/common-contracts";

export type ProductionForm = "Solid" | "Liquid" | "Gas" | "Unknown";

export interface ProductionRecord {
  name: string;
  form: ProductionForm;
  productionPerMinute: number;
  consumptionPerMinute: number;
  maxProductionPerMinute: number;
  maxConsumptionPerMinute: number;
  productionEfficiencyPercent: number;
  consumptionEfficiencyPercent: number;
}

export interface ProductionItem {
  itemKey: string;
  name: string;
  form: ProductionForm;
  productionPerMinute: number;
  consumptionPerMinute: number;
  maxProductionPerMinute: number;
  maxConsumptionPerMinute: number;
  netPerMinute: number;
  productionEfficiencyPercent: number;
  consumptionEfficiencyPercent: number;
  provenance: {
    throughput: Provenance;
    capacity: Provenance;
    net: Provenance;
  };
}

export interface ProductionSnapshot {
  observedAt: string;
  items: ProductionItem[];
}

export interface ProductionProvider {
  getProduction(): Promise<ProductionSnapshot>;
}

export function normalizeItemKey(name: string): string | null {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || null;
}

export function buildProductionItem(record: ProductionRecord): ProductionItem {
  const itemKey = normalizeItemKey(record.name);
  if (!itemKey || !record.name.trim()) throw new Error("invalid-production-item");
  const values = [
    record.productionPerMinute,
    record.consumptionPerMinute,
    record.maxProductionPerMinute,
    record.maxConsumptionPerMinute,
    record.productionEfficiencyPercent,
    record.consumptionEfficiencyPercent,
  ];
  if (values.some((value) => !Number.isFinite(value) || value < 0)
    || record.productionEfficiencyPercent > 100
    || record.consumptionEfficiencyPercent > 100) {
    throw new Error("invalid-production-value");
  }

  return {
    itemKey,
    name: record.name.trim().slice(0, 120),
    form: record.form,
    productionPerMinute: record.productionPerMinute,
    consumptionPerMinute: record.consumptionPerMinute,
    maxProductionPerMinute: record.maxProductionPerMinute,
    maxConsumptionPerMinute: record.maxConsumptionPerMinute,
    netPerMinute: record.productionPerMinute - record.consumptionPerMinute,
    productionEfficiencyPercent: record.productionEfficiencyPercent,
    consumptionEfficiencyPercent: record.consumptionEfficiencyPercent,
    provenance: { throughput: "observed", capacity: "observed", net: "calculated" },
  };
}

export function normalizeProductionItems(records: ProductionRecord[]): ProductionItem[] {
  const items = records.map(buildProductionItem);
  if (new Set(items.map((item) => item.itemKey)).size !== items.length) {
    throw new Error("duplicate-production-item");
  }
  return items;
}
