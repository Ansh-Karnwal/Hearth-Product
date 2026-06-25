import { Bot, Keyboard } from "grammy";
import { TELEGRAM_BOT_TOKEN } from "../config";
import { UserRow } from "../data/schema";
import { DataStore } from "../data/store";
import Gemini from "../llm/gemini";

const CONTACT_BUTTON_TEXT = "Share phone number to set up Hearth";
const ACK_TEXT = "Got it. Say 'buy me <item>' and I'll find you the best price.";

function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "");
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

async function findUserByPhone(store: DataStore, phoneNumber: string): Promise<UserRow | null> {
  const rows = await store.query<UserRow>("users", { filters: { phone_number: phoneNumber }, limit: 1 });
  return rows[0] ?? null;
}

async function findUserByTelegramId(store: DataStore, telegramUserId: number): Promise<UserRow | null> {
  const rows = await store.query<UserRow>("users", { filters: { telegram_user_id: telegramUserId }, limit: 1 });
  return rows[0] ?? null;
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
  void gemini; // wired in for the product loop (Step 5–6); unused until then

  const bot = new Bot(TELEGRAM_BOT_TOKEN);
  const dm = bot.chatType("private");

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
    const reply = await handleTextMessage(store, ctx.from.id, ctx.message.text);
    await ctx.reply(reply);
  });

  return bot;
}
