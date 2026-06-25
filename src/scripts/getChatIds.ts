import { Bot } from "grammy";
import { TELEGRAM_BOT_TOKEN } from "../config";

// Read-only helper: prints the bot's own username, then any chats it has seen
// recently (via getUpdates). Use this once after adding the bot to your
// broadcast channel and crowd group and posting one message in each, to read
// off the numeric chat ids for HEARTH_CHANNEL_ID / HEARTH_CROWD_GROUP_ID.
//
// IMPORTANT: stop any running long-polling bot (main.ts) before running this —
// Telegram only lets one consumer call getUpdates at a time.

async function main(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log("TELEGRAM_BOT_TOKEN is not set in .env");
    return;
  }

  const bot = new Bot(TELEGRAM_BOT_TOKEN);
  const me = await bot.api.getMe();
  console.log(`Bot: @${me.username} (id ${me.id})`);
  console.log("Add this bot to your channel/group, post a message, then re-run this script.\n");

  const updates = await bot.api.getUpdates({ limit: 100 });
  if (updates.length === 0) {
    console.log("No recent updates. Post a message in the channel/group and try again.");
    return;
  }

  const seen = new Set<number>();
  for (const update of updates) {
    const chat = update.channel_post?.chat ?? update.message?.chat;
    if (!chat || seen.has(chat.id)) continue;
    seen.add(chat.id);
    console.log(`chat.id=${chat.id}  type=${chat.type}  title=${"title" in chat ? chat.title : chat.id}`);
  }
}

main();
