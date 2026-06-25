import { Bot, Context, Keyboard } from "grammy";
import { HEARTH_ADMIN_TELEGRAM_IDS, TELEGRAM_BOT_TOKEN } from "../config";
import { UserRow } from "../data/schema";
import { DataStore } from "../data/store";
import { findUserByPhone, findUserByTelegramId, normalizePhone } from "../data/users";
import Gemini from "../llm/gemini";
import { runGrowthLoop } from "../loops/growth";
import { currentMonthRange, formatUsageSummary, usageFor, usageForAll } from "../loops/monetization";
import { handleBuyRequest, handleConfirmationCallback, handleCrowdReply } from "../loops/product";

const CONTACT_BUTTON_TEXT = "Share phone number to set up Hearth";
const ACK_TEXT = "Got it. Say 'buy me <item>' and I'll find you the best price.";

function isAdmin(telegramUserId: number): boolean {
  return HEARTH_ADMIN_TELEGRAM_IDS.includes(telegramUserId);
}

async function requireAdmin(ctx: Context): Promise<boolean> {
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId || !isAdmin(telegramUserId)) {
    await ctx.reply("Admin command. Set HEARTH_ADMIN_TELEGRAM_IDS to your Telegram user id.");
    return false;
  }
  return true;
}

// Pure, grammy-independent handlers — exported so the signup/zip flow can be
// exercised directly in tests without a live Telegram connection.

export async function handleStart(
  store: DataStore,
  telegramUserId: number
): Promise<{ alreadyRegistered: boolean; displayName: string | null }> {
  const existing = await findUserByTelegramId(store, telegramUserId);
  return existing
    ? { alreadyRegistered: true, displayName: existing.display_name }
    : { alreadyRegistered: false, displayName: null };
}

export interface ContactPayload {
  phoneNumber: string;
  firstName: string;
  lastName?: string;
  telegramUserId: number;
}

export async function handleContactShare(
  store: DataStore,
  payload: ContactPayload
): Promise<string> {
  const phoneNumber = normalizePhone(payload.phoneNumber);
  const existing = await findUserByPhone(store, phoneNumber);
  if (existing) {
    return `Welcome back, ${existing.display_name ?? "there"}!`;
  }

  const displayName =
    [payload.firstName, payload.lastName].filter(Boolean).join(" ").trim() || payload.firstName;

  await store.insert<UserRow>("users", {
    phone_number: phoneNumber,
    telegram_user_id: payload.telegramUserId,
    display_name: displayName,
    zip_code: null,
    created_at: new Date().toISOString(),
  });

  return "Thanks! What's your ZIP code? I need it to match you with nearby prices.";
}

export async function handleTextMessage(
  store: DataStore,
  telegramUserId: number,
  text: string
): Promise<string> {
  const user = await findUserByTelegramId(store, telegramUserId);

  if (user && !user.zip_code) {
    const zipCode = text.trim();
    await store.update<UserRow>("users", user.id, { zip_code: zipCode });
    return `Got it — ${zipCode} saved. ${ACK_TEXT}`;
  }

  return ACK_TEXT;
}

export function createBot(store: DataStore, gemini: Gemini): Bot {
  const bot = new Bot(TELEGRAM_BOT_TOKEN);

  // Without a global error boundary, an unhandled throw in any handler (e.g. a
  // Gemini API error) crashes the whole long-polling process instead of just
  // failing that one update. See https://grammy.dev/guide/errors.
  bot.catch(({ ctx, error }) => {
    console.error(`Error while handling update ${ctx.update.update_id}:`, error);
    ctx.reply("Something went wrong on my end — please try again.").catch(() => undefined);
  });

  const dm = bot.chatType("private");
  const group = bot.chatType("group");
  const supergroup = bot.chatType("supergroup");

  bot.callbackQuery(/^confirm_buy:(\d+):(yes|no)$/, async (ctx) => {
    await handleConfirmationCallback(ctx, store);
  });

  bot.command("growthnow", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const result = await runGrowthLoop(store, gemini, bot);
    await ctx.reply(result.posted ? "Growth insight posted." : `Growth skipped: ${result.reason ?? "unknown"}.`);
  });

  bot.command("usage_all", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const { start, end } = currentMonthRange();
    const summary = await usageForAll(store, start, end);
    await ctx.reply(formatUsageSummary(summary, "All Hearth usage this month"));
  });

  group.on("message:text", async (ctx) => {
    await handleCrowdReply(ctx, store, gemini);
  });

  supergroup.on("message:text", async (ctx) => {
    await handleCrowdReply(ctx, store, gemini);
  });

  dm.command("start", async (ctx) => {
    const { alreadyRegistered, displayName } = await handleStart(store, ctx.from.id);
    if (alreadyRegistered) {
      await ctx.reply(`Welcome back, ${displayName ?? "there"}!`);
      return;
    }

    const keyboard = new Keyboard().requestContact(CONTACT_BUTTON_TEXT).resized().oneTime();
    await ctx.reply("Welcome to Hearth! Share your phone number to get set up.", {
      reply_markup: keyboard,
    });
  });

  dm.command("usage", async (ctx) => {
    const user = await findUserByTelegramId(store, ctx.from.id);
    if (!user) {
      await ctx.reply("Start with /start and share your phone number so I can show account usage.");
      return;
    }

    const { start, end } = currentMonthRange();
    const summary = await usageFor(store, user.id, start, end);
    await ctx.reply(formatUsageSummary(summary, "Your Hearth usage this month"));
  });

  dm.on("message:contact", async (ctx) => {
    const contact = ctx.message.contact;
    const reply = await handleContactShare(store, {
      phoneNumber: contact.phone_number,
      firstName: contact.first_name,
      lastName: contact.last_name,
      telegramUserId: ctx.from.id,
    });
    await ctx.reply(reply, { reply_markup: { remove_keyboard: true } });
  });

  dm.on("message:text", async (ctx) => {
    if (ctx.message.text.startsWith("/")) return;
    if (/^\s*buy\s+me\b/i.test(ctx.message.text)) {
      await handleBuyRequest(ctx, store, gemini);
      return;
    }

    const reply = await handleTextMessage(store, ctx.from.id, ctx.message.text);
    await ctx.reply(reply);
  });

  return bot;
}
