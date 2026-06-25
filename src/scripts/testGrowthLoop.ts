import os from "node:os";
import path from "node:path";
import { Bot } from "grammy";
import { HEARTH_CHANNEL_ID } from "../config";
import { PriceIntelligenceRow } from "../data/schema";
import { SqliteStore } from "../data/sqliteStore";
import { createLlm } from "../llm";
import { runGrowthLoop } from "../loops/growth";

const fakeBot = {
  api: {
    sendMessage: async (chatId: string | number, message: string) => {
      console.log("CHANNEL POST:", chatId, message);
      return { message_id: 4242 };
    },
  },
} as unknown as Bot;

async function insertPrice(
  store: SqliteStore,
  itemName: string,
  storeName: string,
  price: number,
  observedAt: string
): Promise<void> {
  await store.insert<PriceIntelligenceRow>("price_intelligence", {
    item_name: itemName,
    store: storeName,
    zip_code: "02139",
    price,
    unit: "each",
    source: "sweep",
    observed_at: observedAt,
  });
}

async function main(): Promise<void> {
  if (!HEARTH_CHANNEL_ID) {
    throw new Error("Set HEARTH_CHANNEL_ID for this script, e.g. HEARTH_CHANNEL_ID=@hearth_test");
  }

  const store = new SqliteStore(path.join(os.tmpdir(), `hearth-growth-loop-${process.pid}.db`));
  const llm = createLlm(store);
  const now = new Date();
  const current = now.toISOString();
  const previous = new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString();

  await insertPrice(store, "celery", "Trader Joe's", 1.99, current);
  await insertPrice(store, "celery", "Star Market", 2.49, current);
  await insertPrice(store, "eggs", "Trader Joe's", 4.49, current);
  await insertPrice(store, "eggs", "Trader Joe's", 2.99, previous);

  console.log("Growth result:", await runGrowthLoop(store, llm, fakeBot));
  console.log("Social posts:", await store.query("social_posts", { sort: [["id", "asc"]] }));
  console.log("Token usage:", await store.query("token_usage", { sort: [["id", "asc"]] }));

  store.close();
}

main();
