import { Bot } from "grammy";
import { HEARTH_CHANNEL_ID, HEARTH_CROWD_GROUP_ID, TELEGRAM_BOT_TOKEN } from "../config";

// One-shot connectivity check: sends a single test message to the configured
// broadcast channel and crowd group, to confirm HEARTH_CHANNEL_ID /
// HEARTH_CROWD_GROUP_ID are correct and the bot has posting rights in both.
// Run this once after editing .env; it does not touch the database.

async function verify(bot: Bot, label: string, chatId: string): Promise<void> {
  if (!chatId) {
    console.log(`${label}: not set in .env, skipping.`);
    return;
  }
  try {
    const sent = await bot.api.sendMessage(chatId, `Hearth ${label} connectivity test ✅ (chat id ${chatId})`);
    console.log(`${label}: OK — posted message_id ${sent.message_id} to ${chatId}`);
  } catch (error) {
    console.log(`${label}: FAILED for chat id ${chatId} —`, error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN is not set in .env");
    return;
  }
  const bot = new Bot(TELEGRAM_BOT_TOKEN);
  await verify(bot, "broadcast channel", HEARTH_CHANNEL_ID);
  await verify(bot, "crowd group", HEARTH_CROWD_GROUP_ID);
}

main();
