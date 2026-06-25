import "dotenv/config";

// Each of these is read once at startup. Telegram/LLM wiring (later steps) is
// responsible for deciding whether a missing value should block startup —
// config.ts itself never throws, so `tsx src/main.ts` always boots and the DB
// layer is always testable even before secrets are configured.
export const TELEGRAM_BOT_TOKEN: string = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const GEMINI_API_KEY: string = process.env.GEMINI_API_KEY ?? "";
export const OPENAI_API_KEY: string = process.env.OPENAI_API_KEY ?? "";
export const HEARTH_CHANNEL_ID: string = process.env.HEARTH_CHANNEL_ID ?? "";
export const HEARTH_CROWD_GROUP_ID: string = process.env.HEARTH_CROWD_GROUP_ID ?? "";
export const DB_PATH: string = process.env.DB_PATH ?? "hearth.db";
export const LLM_BACKEND = (process.env.LLM_BACKEND ?? "gemini").toLowerCase();
export const DEBUG_MODE = (process.env.DEBUG_MODE ?? "false").toLowerCase() === "true";
export const HEARTH_ADMIN_TELEGRAM_IDS = (process.env.HEARTH_ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isFinite(id));

// LLM
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
export const PRICE_PER_1M_INPUT_USD = 0.25;
export const PRICE_PER_1M_OUTPUT_USD = 1.5;

// Monetization
export const MONTHLY_FLOOR_USD = 20;

// Product loop
export const SWEEP_FRESHNESS_DAYS = 7;
// How far below the next-cheapest price the cheapest candidate must be to
// count as a "clear winner" (skip crowd-sourcing). Real grocery prices
// rarely differ by more than a few percent across stores, so this is small.
export const CLEAR_WINNER_MARGIN = 0.03;
// Chance Hearth sends a short, human-sounding reaction to the price it found
// (only when crowd-sourcing did NOT activate). 1 = always; dial down later
// if it gets annoying.
export const PRODUCT_COMMENT_PROBABILITY = 1;
export const CROWD_COLLECTION_WINDOW_MS = Number(process.env.CROWD_COLLECTION_WINDOW_MS ?? 180_000);
export const KNOWN_GROCERY_STORES = [
  "Trader Joe's",
  "Whole Foods",
  "Star Market",
  "Instacart",
  "Walmart",
  "Target",
];

// Growth loop
export const GROWTH_INTERVAL_HOURS = 6;
