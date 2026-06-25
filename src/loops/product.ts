import { Context, InlineKeyboard } from "grammy";
import {
  CROWD_COLLECTION_WINDOW_MS,
  HEARTH_CROWD_GROUP_ID,
  KNOWN_GROCERY_STORES,
  SWEEP_FRESHNESS_DAYS,
} from "../config";
import { lookupPrices } from "../data/moat";
import {
  CrowdResponseRow,
  PriceIntelligenceRow,
  PriceSource,
  PurchaseRequestRow,
  SocialPostRow,
  TokenUsageRow,
  UserRow,
} from "../data/schema";
import { DataStore } from "../data/store";
import { findUserByTelegramId } from "../data/users";
import Gemini from "../llm/gemini";

type CandidateSource = PriceSource | "db";

export interface PriceCandidate {
  store: string;
  price: number;
  unit: string | null;
  source: CandidateSource;
}

interface PendingConfirmation {
  requestId: number;
  userId: number;
  itemName: string;
  zipCode: string;
  candidates: PriceCandidate[];
  chosen: PriceCandidate;
}

interface ConfirmationResult {
  ok: boolean;
  message: string;
}

interface TelegramSender {
  sendMessage(chatId: number | string, text: string, options?: any): Promise<{ message_id: number }>;
}

type SendConfirmation = (text: string, keyboard: InlineKeyboard) => Promise<unknown>;

const pendingConfirmations = new Map<number, PendingConfirmation>();
const crowdTimers = new Map<number, NodeJS.Timeout>();

const requestParseSchema = {
  type: "object",
  properties: {
    itemName: { type: "string" },
    quantity: { type: "string" },
  },
  required: ["itemName"],
};

const priceSweepSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          store: { type: "string" },
          price: { type: "number" },
          unit: { type: "string" },
        },
        required: ["store", "price"],
      },
    },
  },
  required: ["candidates"],
};

const crowdParseSchema = {
  type: "object",
  properties: {
    store: { type: "string" },
    price: { type: "number" },
  },
  required: ["store", "price"],
};

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function messageText(ctx: Context): string {
  return ((ctx.message as { text?: string } | undefined)?.text ?? "").trim();
}

function fallbackItemName(rawText: string): string {
  const match = /\bbuy\s+me\s+(.+)$/i.exec(rawText.trim());
  return (match?.[1] ?? rawText).replace(/[?.!]+$/g, "").trim().toLowerCase();
}

function cleanCandidate(candidate: unknown, source: CandidateSource): PriceCandidate | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  const storeName = typeof record.store === "string" ? record.store.trim() : "";
  const price = typeof record.price === "number" ? record.price : Number(record.price);
  if (!storeName || !Number.isFinite(price) || price <= 0) return null;

  return {
    store: storeName,
    price,
    unit: typeof record.unit === "string" && record.unit.trim() ? record.unit.trim() : null,
    source,
  };
}

function parseCandidates(text: string, source: CandidateSource): PriceCandidate[] {
  const parsed = parseJsonObject(text);
  const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  return rawCandidates.map((candidate) => cleanCandidate(candidate, source)).filter((row) => row !== null);
}

function dbRowsToCandidates(rows: PriceIntelligenceRow[]): PriceCandidate[] {
  return rows.map((row) => ({
    store: row.store,
    price: row.price,
    unit: row.unit,
    source: "db",
  }));
}

export function chooseClearWinner(candidates: PriceCandidate[]): PriceCandidate | null {
  const sorted = candidates
    .filter((candidate) => Number.isFinite(candidate.price) && candidate.price > 0)
    .sort((a, b) => a.price - b.price);

  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];

  const [cheapest, nextCheapest] = sorted;
  return cheapest.price <= nextCheapest.price * 0.9 ? cheapest : null;
}

function formatPrice(candidate: PriceCandidate): string {
  const unit = candidate.unit ? `/${candidate.unit}` : "";
  return `$${candidate.price.toFixed(2)}${unit}`;
}

function sameCandidate(a: PriceCandidate, b: PriceCandidate): boolean {
  return a.store === b.store && Math.abs(a.price - b.price) < 0.001 && a.unit === b.unit;
}

async function logDbHit(store: DataStore, userId: number, requestId: number): Promise<void> {
  await store.insert<TokenUsageRow>("token_usage", {
    user_id: userId,
    operation: "sweep_db_hit",
    model: "local-db",
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    request_id: requestId,
    created_at: new Date().toISOString(),
  });
}

async function parseRequest(
  gemini: Gemini,
  rawText: string,
  userId: number,
  requestId: number
): Promise<{ itemName: string; quantity: string | null }> {
  const result = await gemini.generate(
    [
      "Parse this grocery purchase request into JSON.",
      'Return shape: {"itemName":"lowercase item name","quantity":"amount or null"}.',
      `Raw request: "${rawText.replace(/"/g, "'")}"`,
    ].join("\n"),
    {
      operation: "request_parse",
      userId,
      requestId,
      jsonSchema: requestParseSchema,
    }
  );

  const parsed = parseJsonObject(result.text);
  const itemName =
    typeof parsed.itemName === "string" && parsed.itemName.trim()
      ? parsed.itemName.trim().toLowerCase()
      : fallbackItemName(rawText);
  const quantity = typeof parsed.quantity === "string" && parsed.quantity.trim() ? parsed.quantity.trim() : null;

  return { itemName, quantity };
}

async function freshSweep(
  gemini: Gemini,
  itemName: string,
  zipCode: string,
  userId: number,
  requestId: number
): Promise<PriceCandidate[]> {
  const result = await gemini.generate(
    [
      "Find current grocery price candidates near the user's ZIP using grounded search.",
      `Item: ${itemName}`,
      `ZIP: ${zipCode}`,
      `Known grocery options: ${KNOWN_GROCERY_STORES.join(", ")}`,
      'Return JSON only: {"candidates":[{"store":"store name","price":1.23,"unit":"each"}]}.',
    ].join("\n"),
    {
      operation: "price_sweep",
      userId,
      requestId,
      jsonSchema: priceSweepSchema,
      grounded: true,
    }
  );

  return parseCandidates(result.text, "sweep");
}

async function queueConfirmation(
  store: DataStore,
  request: PurchaseRequestRow,
  user: UserRow,
  candidates: PriceCandidate[],
  chosen: PriceCandidate,
  sendConfirmation: SendConfirmation
): Promise<void> {
  if (!user.zip_code) throw new Error(`User ${user.id} has no ZIP code`);

  await store.update<PurchaseRequestRow>("purchase_requests", request.id, {
    status: "awaiting_confirmation",
    chosen_store: chosen.store,
    chosen_price: chosen.price,
  });

  pendingConfirmations.set(request.id, {
    requestId: request.id,
    userId: user.id,
    itemName: request.item_name ?? "",
    zipCode: user.zip_code,
    candidates,
    chosen,
  });

  const keyboard = new InlineKeyboard()
    .text("Yes", `confirm_buy:${request.id}:yes`)
    .text("No", `confirm_buy:${request.id}:no`);

  await sendConfirmation(
    `Best option: ${chosen.store} has ${request.item_name} for ${formatPrice(chosen)}. Confirm checkout?`,
    keyboard
  );
}

async function askCrowdForHelp(
  ctx: Context,
  store: DataStore,
  gemini: Gemini,
  request: PurchaseRequestRow,
  itemName: string,
  zipCode: string
): Promise<void> {
  if (!HEARTH_CROWD_GROUP_ID) {
    await store.update<PurchaseRequestRow>("purchase_requests", request.id, { status: "cancelled" });
    await ctx.reply("No clear winner yet, and the crowd group is not configured.");
    return;
  }

  const content = `Where's ${itemName} cheapest near ${zipCode} this week? Reply with store + price.`;
  const sent = await ctx.api.sendMessage(HEARTH_CROWD_GROUP_ID, content);

  const post = await store.insert<SocialPostRow>("social_posts", {
    post_type: "crowd_question",
    channel: HEARTH_CROWD_GROUP_ID,
    content,
    related_request_id: request.id,
    telegram_message_id: sent.message_id,
    posted_at: new Date().toISOString(),
  });

  await store.update<PurchaseRequestRow>("purchase_requests", request.id, { status: "crowd_pending" });
  scheduleCrowdResolution(post.id, store, gemini, ctx.api);
  await ctx.reply("No clear winner yet. I asked the Hearth crowd and will confirm before checkout.");
}

export async function handleBuyRequest(ctx: Context, store: DataStore, gemini: Gemini): Promise<void> {
  const rawText = messageText(ctx);
  const telegramUserId = ctx.from?.id;
  if (!telegramUserId) return;

  const user = await findUserByTelegramId(store, telegramUserId);
  if (!user) {
    await ctx.reply("Start with /start and share your phone number so I can set up your Hearth account.");
    return;
  }

  if (!user.zip_code) {
    await ctx.reply("Send me your ZIP code first so I can compare nearby grocery prices.");
    return;
  }

  let request = await store.insert<PurchaseRequestRow>("purchase_requests", {
    user_id: user.id,
    raw_text: rawText,
    item_name: null,
    quantity: null,
    status: "parsing",
    chosen_store: null,
    chosen_price: null,
    created_at: new Date().toISOString(),
    completed_at: null,
  });

  const parsed = await parseRequest(gemini, rawText, user.id, request.id);
  request = await store.update<PurchaseRequestRow>("purchase_requests", request.id, {
    item_name: parsed.itemName,
    quantity: parsed.quantity,
    status: "sweeping",
  });

  const dbCandidates = dbRowsToCandidates(
    await lookupPrices(store, parsed.itemName, user.zip_code, SWEEP_FRESHNESS_DAYS)
  );
  const dbWinner = chooseClearWinner(dbCandidates);
  if (dbWinner) {
    await logDbHit(store, user.id, request.id);
    await queueConfirmation(store, request, user, dbCandidates, dbWinner, (text, keyboard) =>
      ctx.reply(text, { reply_markup: keyboard })
    );
    return;
  }

  const sweptCandidates = await freshSweep(gemini, parsed.itemName, user.zip_code, user.id, request.id);
  const sweepWinner = chooseClearWinner(sweptCandidates);
  if (sweepWinner) {
    await queueConfirmation(store, request, user, sweptCandidates, sweepWinner, (text, keyboard) =>
      ctx.reply(text, { reply_markup: keyboard })
    );
    return;
  }

  await askCrowdForHelp(ctx, store, gemini, request, parsed.itemName, user.zip_code);
}

async function writeBackCandidates(store: DataStore, pending: PendingConfirmation): Promise<void> {
  const now = new Date().toISOString();
  let wroteChosenPurchase = false;

  for (const candidate of pending.candidates) {
    if (candidate.source === "db") continue;

    const candidateWasChosen = sameCandidate(candidate, pending.chosen);
    const source: PriceSource = candidate.source === "crowd" ? "crowd" : candidateWasChosen ? "purchase" : "sweep";
    if (source === "purchase") wroteChosenPurchase = true;

    await store.insert<PriceIntelligenceRow>("price_intelligence", {
      item_name: pending.itemName,
      store: candidate.store,
      zip_code: pending.zipCode,
      price: candidate.price,
      unit: candidate.unit,
      source,
      observed_at: now,
    });
  }

  if (!wroteChosenPurchase) {
    await store.insert<PriceIntelligenceRow>("price_intelligence", {
      item_name: pending.itemName,
      store: pending.chosen.store,
      zip_code: pending.zipCode,
      price: pending.chosen.price,
      unit: pending.chosen.unit,
      source: "purchase",
      observed_at: now,
    });
  }
}

export async function confirmPurchaseRequest(
  store: DataStore,
  requestId: number,
  confirmed: boolean
): Promise<ConfirmationResult> {
  const request = await store.get<PurchaseRequestRow>("purchase_requests", requestId);
  if (!request) return { ok: false, message: "That request no longer exists." };

  if (!confirmed) {
    pendingConfirmations.delete(requestId);
    await store.update<PurchaseRequestRow>("purchase_requests", requestId, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
    });
    return { ok: true, message: "Cancelled. I won't check out." };
  }

  const pending = pendingConfirmations.get(requestId);
  if (!pending) {
    return { ok: false, message: "I lost the pending choice. Send the request again so I can re-confirm it." };
  }

  console.log(
    `checkout stub: request=${requestId} user=${pending.userId} store=${pending.chosen.store} price=${pending.chosen.price}`
  );

  await store.update<PurchaseRequestRow>("purchase_requests", requestId, {
    status: "purchased",
    chosen_store: pending.chosen.store,
    chosen_price: pending.chosen.price,
    completed_at: new Date().toISOString(),
  });

  await writeBackCandidates(store, pending);
  pendingConfirmations.delete(requestId);

  return {
    ok: true,
    message: `Purchased ${pending.itemName} from ${pending.chosen.store} for ${formatPrice(pending.chosen)}.`,
  };
}

export async function handleConfirmationCallback(ctx: Context, store: DataStore): Promise<void> {
  const match = (ctx as Context & { match?: RegExpMatchArray }).match;
  const requestId = Number(match?.[1]);
  const decision = match?.[2];
  if (!requestId || (decision !== "yes" && decision !== "no")) {
    await ctx.answerCallbackQuery("Invalid confirmation.");
    return;
  }

  const result = await confirmPurchaseRequest(store, requestId, decision === "yes");
  await ctx.answerCallbackQuery(result.ok ? "Updated." : "Could not update.");
  await ctx.editMessageReplyMarkup().catch(() => undefined);
  await ctx.reply(result.message);
}

async function parseCrowdReply(
  store: DataStore,
  gemini: Gemini,
  post: SocialPostRow,
  rawText: string
): Promise<{ storeName: string | null; price: number | null }> {
  const request = post.related_request_id
    ? await store.get<PurchaseRequestRow>("purchase_requests", post.related_request_id)
    : null;

  const result = await gemini.generate(
    [
      "Parse this crowd grocery price reply into JSON.",
      'Return shape: {"store":"store name","price":1.23}.',
      `Question: "${post.content.replace(/"/g, "'")}"`,
      `Reply: "${rawText.replace(/"/g, "'")}"`,
    ].join("\n"),
    {
      operation: "crowd_parse",
      userId: request?.user_id,
      requestId: request?.id,
      jsonSchema: crowdParseSchema,
    }
  );

  const parsed = parseJsonObject(result.text);
  const storeName = typeof parsed.store === "string" && parsed.store.trim() ? parsed.store.trim() : null;
  const price = typeof parsed.price === "number" ? parsed.price : Number(parsed.price);

  return {
    storeName,
    price: Number.isFinite(price) && price > 0 ? price : null,
  };
}

export async function handleCrowdReply(ctx: Context, store: DataStore, gemini: Gemini): Promise<void> {
  if (!HEARTH_CROWD_GROUP_ID) return;

  const chatId = ctx.chat?.id;
  const chatUsername = (ctx.chat as { username?: string } | undefined)?.username;
  const isCrowdGroup = String(chatId) === HEARTH_CROWD_GROUP_ID || `@${chatUsername}` === HEARTH_CROWD_GROUP_ID;
  if (!isCrowdGroup || !ctx.from) return;

  // BotFather group privacy must be DISABLED for this bot, otherwise Telegram
  // only delivers commands/replies and Hearth cannot read crowd price answers.
  const text = messageText(ctx);
  const replyToMessageId = (ctx.message as { reply_to_message?: { message_id?: number } } | undefined)
    ?.reply_to_message?.message_id;
  if (!text || !replyToMessageId) return;

  const posts = await store.query<SocialPostRow>("social_posts", {
    filters: {
      post_type: "crowd_question",
      channel: HEARTH_CROWD_GROUP_ID,
      telegram_message_id: replyToMessageId,
    },
    limit: 1,
  });
  const post = posts[0];
  if (!post) return;

  const response = await store.insert<CrowdResponseRow>("crowd_responses", {
    post_id: post.id,
    telegram_user_id: ctx.from.id,
    raw_text: text,
    parsed_store: null,
    parsed_price: null,
    created_at: new Date().toISOString(),
  });

  const parsed = await parseCrowdReply(store, gemini, post, text);
  await store.update<CrowdResponseRow>("crowd_responses", response.id, {
    parsed_store: parsed.storeName,
    parsed_price: parsed.price,
  });

  if (!crowdTimers.has(post.id)) {
    scheduleCrowdResolution(post.id, store, gemini, ctx.api);
  }
}

function scheduleCrowdResolution(
  postId: number,
  store: DataStore,
  gemini: Gemini,
  api: TelegramSender
): void {
  if (crowdTimers.has(postId)) return;

  const timer = setTimeout(() => {
    crowdTimers.delete(postId);
    resolveCrowdQuestion(postId, store, api).catch((error) => {
      console.error("crowd resolution failed", error);
    });
  }, CROWD_COLLECTION_WINDOW_MS);
  timer.unref?.();

  crowdTimers.set(postId, timer);
  void gemini;
}

export async function resolveCrowdQuestion(
  postId: number,
  store: DataStore,
  api: TelegramSender
): Promise<void> {
  const post = await store.get<SocialPostRow>("social_posts", postId);
  if (!post?.related_request_id) return;

  const request = await store.get<PurchaseRequestRow>("purchase_requests", post.related_request_id);
  if (!request || request.status !== "crowd_pending") return;

  const user = await store.get<UserRow>("users", request.user_id);
  if (!user?.telegram_user_id || !user.zip_code || !request.item_name) return;

  const responses = await store.query<CrowdResponseRow>("crowd_responses", {
    filters: { post_id: postId },
    sort: [["parsed_price", "asc"]],
  });

  const candidates = responses
    .map((response) =>
      cleanCandidate(
        {
          store: response.parsed_store,
          price: response.parsed_price,
          unit: null,
        },
        "crowd"
      )
    )
    .filter((candidate) => candidate !== null);

  if (candidates.length === 0) {
    await store.update<PurchaseRequestRow>("purchase_requests", request.id, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
    });
    await api.sendMessage(user.telegram_user_id, `I did not get a credible crowd price for ${request.item_name}.`);
    return;
  }

  const chosen = candidates.sort((a, b) => a.price - b.price)[0];
  await queueConfirmation(store, request, user, candidates, chosen, (text, keyboard) =>
    api.sendMessage(user.telegram_user_id!, text, { reply_markup: keyboard })
  );
}
