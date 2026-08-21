import { buildProductionItem, type ProductionItem, type ProductionProvider, type ProductionSnapshot } from "@/domain/production";

const OBSERVED_AT = "2026-08-18T18:00:00.000Z";

const MOCK_ITEMS: ProductionItem[] = [
  buildProductionItem({
    name: "Iron Rod",
    form: "Solid",
    productionPerMinute: 120,
    consumptionPerMinute: 60,
    maxProductionPerMinute: 240,
    maxConsumptionPerMinute: 120,
    productionEfficiencyPercent: 50,
    consumptionEfficiencyPercent: 50,
  }),
  buildProductionItem({
    name: "Copper Sheet",
    form: "Solid",
    productionPerMinute: 20,
    consumptionPerMinute: 40,
    maxProductionPerMinute: 40,
    maxConsumptionPerMinute: 40,
    productionEfficiencyPercent: 50,
    consumptionEfficiencyPercent: 100,
  }),
  buildProductionItem({
    name: "Water",
    form: "Liquid",
    productionPerMinute: 300,
    consumptionPerMinute: 120,
    maxProductionPerMinute: 300,
    maxConsumptionPerMinute: 120,
    productionEfficiencyPercent: 100,
    consumptionEfficiencyPercent: 100,
  }),
];

export const MOCK_PRODUCTION_ITEMS = MOCK_ITEMS;

export class MockProductionProvider implements ProductionProvider {
  async getProduction(): Promise<ProductionSnapshot> {
    return { observedAt: OBSERVED_AT, items: structuredClone(MOCK_ITEMS) };
  }
}
