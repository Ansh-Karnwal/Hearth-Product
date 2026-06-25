import { Bot, Context, Keyboard } from "grammy";
import { HEARTH_ADMIN_TELEGRAM_IDS, TELEGRAM_BOT_TOKEN } from "../config";
import { UserRow } from "../data/schema";
import { DataStore } from "../data/store";
import { findUserByPhone, findUserByTelegramId, looksLikePhoneNumber, normalizePhone } from "../data/users";
import { isDebugMode, setDebugMode } from "../debug";
import { LlmClient } from "../llm";
import { runGrowthLoop } from "../loops/growth";
import { currentMonthRange, formatUsageSummary, usageFor, usageForAll } from "../loops/monetization";
import { handleBuyRequest, handleConfirmationCallback, handleCrowdReply } from "../loops/product";

const CONTACT_BUTTON_TEXT = "Share phone number to set up Hearth";
const ACK_TEXT = "Got it. Say 'buy me <item>' and I'll find you the best price.";

const USER_HELP_TEXT = [
  "Here's what you can do:",
  '• Say "buy me <item>" — I\'ll price-sweep grocery stores near you and confirm before checkout.',
  "/usage — see your token usage and spend this month.",
  "/help — show this again.",
].join("\n");

const ADMIN_HELP_TEXT = [
  "Admin commands:",
  "/growthnow — run the growth loop immediately.",
  "/usage_all — usage summary for all users.",
  "/debug [on|off] — toggle verbose debug logging.",
].join("\n");

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
    const greeting = `Welcome back, ${existing.display_name ?? "there"}!`;
    return existing.zip_code
      ? greeting
      : `${greeting} What's your ZIP code? I need it to match you with nearby prices.`;
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

export interface TelegramName {
  firstName: string;
  lastName?: string;
}

export async function handleTextMessage(
  store: DataStore,
  telegramUserId: number,
  text: string,
  from: TelegramName
): Promise<string> {
  const user = await findUserByTelegramId(store, telegramUserId);

  if (!user) {
    // Desktop/web clients don't always render the request-contact button, so
    // a user typing their number by hand should register just like tapping it.
    if (!looksLikePhoneNumber(text)) {
      return "Start with /start, then share your phone number — tap the button, or just type the number — so I can set up your Hearth account.";
    }

    return handleContactShare(store, {
      phoneNumber: text,
      firstName: from.firstName,
      lastName: from.lastName,
      telegramUserId,
    });
  }

  if (!user.zip_code) {
    const zipCode = text.trim();
    await store.update<UserRow>("users", user.id, { zip_code: zipCode });
    return `Got it — ${zipCode} saved.\n\n${USER_HELP_TEXT}`;
  }

  return ACK_TEXT;
}

export function createBot(store: DataStore, gemini: LlmClient): Bot {
  const bot = new Bot(TELEGRAM_BOT_TOKEN);

  // Without a global error boundary, an unhandled throw in any handler (e.g. a
  // LLM API error) crashes the whole long-polling process instead of just
  // failing that one update. See https://grammy.dev/guide/errors.
  bot.catch(({ ctx, error }) => {
    console.error(`Error while handling update ${ctx.update.update_id}:`, error);
    ctx.reply("Something went wrong on my end — please try again.").catch(() => undefined);
  });

  // Populates Telegram's native "/" command menu in DMs. Admin-only commands
  // (growthnow/usage_all/debug) are deliberately left off this public list.
  bot.api
    .setMyCommands([
      { command: "start", description: "Set up your Hearth account" },
      { command: "help", description: "See what Hearth can do" },
      { command: "usage", description: "Your token usage this month" },
    ])
    .catch((error) => console.error("setMyCommands failed", error));

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

  // Toggles verbose console tracing (raw LLM requests/responses, web-search
  // grounding, every DataStore key/value mutation) without a restart — see ../debug.ts.
  bot.command("debug", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const arg = ctx.match?.toString().trim().toLowerCase();
    if (arg === "on" || arg === "off") {
      setDebugMode(arg === "on");
    } else if (arg) {
      await ctx.reply("Usage: /debug on, /debug off, or /debug with no argument to check status.");
      return;
    }
    await ctx.reply(`Debug mode is ${isDebugMode() ? "ON" : "OFF"} (verbose logs print to the server console).`);
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
    await ctx.reply(
      "Welcome to Hearth! Share your phone number to get set up — tap the button below, or just type your number.",
      { reply_markup: keyboard }
    );
  });

  dm.command("help", async (ctx) => {
    const text = isAdmin(ctx.from.id) ? `${USER_HELP_TEXT}\n\n${ADMIN_HELP_TEXT}` : USER_HELP_TEXT;
    await ctx.reply(text);
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

    const reply = await handleTextMessage(store, ctx.from.id, ctx.message.text, {
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });
    await ctx.reply(reply);
  });

  return bot;
}
