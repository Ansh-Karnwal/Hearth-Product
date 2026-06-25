import { DB_PATH, GEMINI_API_KEY, TELEGRAM_BOT_TOKEN } from "./config";
import { SqliteStore } from "./data/sqliteStore";
import Gemini from "./llm/gemini";
import { createBot } from "./telegram/bot";

async function main(): Promise<void> {
  const store = new SqliteStore(DB_PATH);
  console.log("Hearth up — DB ready");

  const gemini = new Gemini(store, GEMINI_API_KEY);

  if (!TELEGRAM_BOT_TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN not set — skipping Telegram bot startup.");
    return;
  }

  const bot = createBot(store, gemini);
  await bot.start();
}

main();
