import { lookupPrices } from "../data/moat";
import { PriceIntelligenceRow } from "../data/schema";
import { SqliteStore } from "../data/sqliteStore";

async function main(): Promise<void> {
  const store = new SqliteStore("hearth.db");
  const now = new Date().toISOString();

  await store.insert<PriceIntelligenceRow>("price_intelligence", {
    item_name: "celery",
    store: "Trader Joe's",
    zip_code: "02139",
    price: 1.99,
    unit: "bunch",
    source: "sweep",
    observed_at: now,
  });

  await store.insert<PriceIntelligenceRow>("price_intelligence", {
    item_name: "celery",
    store: "Star Market",
    zip_code: "02139",
    price: 2.49,
    unit: "bunch",
    source: "sweep",
    observed_at: now,
  });

  const results = await lookupPrices(store, "celery", "02139", 7);
  console.log(results);

  store.close();
}

main();
