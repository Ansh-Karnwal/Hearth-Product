import { Bot } from "grammy";
import { GROWTH_INTERVAL_HOURS, HEARTH_CHANNEL_ID } from "../config";
import { PriceIntelligenceRow, SocialPostRow } from "../data/schema";
import { DataStore } from "../data/store";
import { LlmClient } from "../llm";

interface InterestingStat {
  score: number;
  summary: string;
}

interface GrowthRunResult {
  posted: boolean;
  content?: string;
  telegramMessageId?: number;
  reason?: string;
}

function average(rows: PriceIntelligenceRow[]): number {
  return rows.reduce((sum, row) => sum + row.price, 0) / rows.length;
}

function groupBy<T>(rows: T[], keyFor: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function pct(delta: number, base: number): number {
  return base > 0 ? delta / base : 0;
}

function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function biggestWeekOverWeekJump(currentRows: PriceIntelligenceRow[], previousRows: PriceIntelligenceRow[]): InterestingStat | null {
  const currentByItem = groupBy(currentRows, (row) => row.item_name);
  const previousByItem = groupBy(previousRows, (row) => row.item_name);
  let best: InterestingStat | null = null;

  for (const [itemName, rows] of currentByItem) {
    const previous = previousByItem.get(itemName);
    if (!previous || previous.length === 0) continue;

    const currentAvg = average(rows);
    const previousAvg = average(previous);
    const increase = pct(currentAvg - previousAvg, previousAvg);
    if (increase <= 0) continue;

    const stat = {
      score: increase * 1.2,
      summary: `${itemName} is up ${formatPct(increase)} week over week ($${currentAvg.toFixed(
        2
      )} vs $${previousAvg.toFixed(2)}).`,
    };
    if (!best || stat.score > best.score) best = stat;
  }

  return best;
}

function cheapestFrequentlyTrackedItem(currentRows: PriceIntelligenceRow[]): InterestingStat | null {
  const byItem = groupBy(currentRows, (row) => row.item_name);
  let best: InterestingStat | null = null;

  for (const [itemName, itemRows] of byItem) {
    if (itemRows.length < 2) continue;

    const byStore = groupBy(itemRows, (row) => row.store);
    const storeAverages = [...byStore.entries()]
      .map(([store, rows]) => ({ store, price: average(rows) }))
      .sort((a, b) => a.price - b.price);
    if (storeAverages.length < 2) continue;

    const [cheapest, nextCheapest] = storeAverages;
    const savings = pct(nextCheapest.price - cheapest.price, nextCheapest.price);
    if (savings <= 0) continue;

    const stat = {
      score: savings,
      summary: `${cheapest.store} is cheapest for ${itemName} this week at $${cheapest.price.toFixed(
        2
      )}, ${formatPct(savings)} under ${nextCheapest.store}.`,
    };
    if (!best || stat.score > best.score) best = stat;
  }

  return best;
}

function storeClearlyBeatingAnother(currentRows: PriceIntelligenceRow[]): InterestingStat | null {
  const byZipAndItem = groupBy(currentRows, (row) => `${row.zip_code}::${row.item_name}`);
  let best: InterestingStat | null = null;

  for (const [zipAndItem, rows] of byZipAndItem) {
    const [zipCode, itemName] = zipAndItem.split("::");
    const byStore = groupBy(rows, (row) => row.store);
    const storeAverages = [...byStore.entries()]
      .map(([store, storeRows]) => ({ store, price: average(storeRows) }))
      .sort((a, b) => a.price - b.price);
    if (storeAverages.length < 2) continue;

    const [cheapest, nextCheapest] = storeAverages;
    const savings = pct(nextCheapest.price - cheapest.price, nextCheapest.price);
    if (savings < 0.1) continue;

    const stat = {
      score: savings + 0.05,
      summary: `In ${zipCode}, ${cheapest.store} is beating ${nextCheapest.store} on ${itemName}: $${cheapest.price.toFixed(
        2
      )} vs $${nextCheapest.price.toFixed(2)} (${formatPct(savings)} lower).`,
    };
    if (!best || stat.score > best.score) best = stat;
  }

  return best;
}

async function computeInterestingStat(store: DataStore): Promise<InterestingStat | null> {
  const now = Date.now();
  const currentWeekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const previousWeekStart = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await store.query<PriceIntelligenceRow>("price_intelligence", {
    filters: { observed_at: { gte: previousWeekStart } },
  });
  const currentRows = rows.filter((row) => row.observed_at >= currentWeekStart);
  const previousRows = rows.filter((row) => row.observed_at < currentWeekStart);

  const candidates = [
    biggestWeekOverWeekJump(currentRows, previousRows),
    cheapestFrequentlyTrackedItem(currentRows),
    storeClearlyBeatingAnother(currentRows),
  ].filter((stat) => stat !== null);

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.score - a.score)[0];
}

export async function runGrowthLoop(store: DataStore, gemini: LlmClient, bot: Bot): Promise<GrowthRunResult> {
  const stat = await computeInterestingStat(store);
  if (!stat) {
    console.log("growth: insufficient data");
    return { posted: false, reason: "insufficient_data" };
  }

  if (!HEARTH_CHANNEL_ID) {
    console.log("growth: HEARTH_CHANNEL_ID not set");
    return { posted: false, reason: "missing_channel" };
  }

  const result = await gemini.generate(
    [
      "Write one short, punchy Telegram grocery price insight.",
      "No hashtags. No markdown table. Keep it under 280 characters.",
      `Stat: ${stat.summary}`,
    ].join("\n"),
    { operation: "growth_post" }
  );
  const content = result.text.trim();

  // The bot must be an ADMIN of the broadcast channel, otherwise Telegram will reject this post.
  const sent = await bot.api.sendMessage(HEARTH_CHANNEL_ID, content);
  await store.insert<SocialPostRow>("social_posts", {
    post_type: "growth_insight",
    channel: HEARTH_CHANNEL_ID,
    content,
    related_request_id: null,
    telegram_message_id: sent.message_id,
    posted_at: new Date().toISOString(),
  });

  return { posted: true, content, telegramMessageId: sent.message_id };
}

export function startGrowthScheduler(store: DataStore, gemini: LlmClient, bot: Bot): NodeJS.Timeout {
  return setInterval(() => {
    runGrowthLoop(store, gemini, bot).catch((error) => {
      console.error("growth loop failed", error);
    });
  }, GROWTH_INTERVAL_HOURS * 60 * 60 * 1000);
}
