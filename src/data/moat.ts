import { PriceIntelligenceRow } from "./schema";
import { DataStore } from "./store";

export async function lookupPrices(
  store: DataStore,
  itemName: string,
  zipCode: string,
  freshWithinDays: number
): Promise<PriceIntelligenceRow[]> {
  const cutoff = new Date(Date.now() - freshWithinDays * 24 * 60 * 60 * 1000).toISOString();

  return store.query<PriceIntelligenceRow>("price_intelligence", {
    filters: {
      item_name: itemName.trim().toLowerCase(),
      zip_code: zipCode,
      observed_at: { gte: cutoff },
    },
    sort: [
      ["price", "asc"],
      ["observed_at", "desc"],
    ],
  });
}
