import { DB_PATH, LLM_BACKEND, OPENAI_MODEL, TELEGRAM_BOT_TOKEN } from "./config";
import { SqliteStore } from "./data/sqliteStore";
import { createLlm } from "./llm";
import { startGrowthScheduler } from "./loops/growth";
import { createBot } from "./telegram/bot";

async function main(): Promise<void> {
  const store = new SqliteStore(DB_PATH);
  console.log("Hearth up — DB ready");

  console.log(`LLM backend: ${LLM_BACKEND}`);
  if (LLM_BACKEND === "openai") {
    console.log(`OpenAI model: ${OPENAI_MODEL}`);
  }

  const llm = createLlm(store);

  if (!TELEGRAM_BOT_TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN not set — skipping Telegram bot startup.");
    return;
  }

  const bot = createBot(store, llm);
  startGrowthScheduler(store, llm, bot);
  await bot.start();
}

main();
