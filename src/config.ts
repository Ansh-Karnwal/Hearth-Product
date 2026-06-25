import "dotenv/config";

// Each of these is read once at startup. Telegram/Gemini wiring (later steps) is
// responsible for deciding whether a missing value should block startup —
// config.ts itself never throws, so `tsx src/main.ts` always boots and the DB
// layer is always testable even before secrets are configured.
export const TELEGRAM_BOT_TOKEN: string = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const GEMINI_API_KEY: string = process.env.GEMINI_API_KEY ?? "";
export const HEARTH_CHANNEL_ID: string = process.env.HEARTH_CHANNEL_ID ?? "";
export const HEARTH_CROWD_GROUP_ID: string = process.env.HEARTH_CROWD_GROUP_ID ?? "";
export const DB_PATH: string = process.env.DB_PATH ?? "hearth.db";
export const HEARTH_ADMIN_TELEGRAM_IDS = (process.env.HEARTH_ADMIN_TELEGRAM_IDS ?? "")
  .split(",")
  .map((id) => Number(id.trim()))
  .filter((id) => Number.isFinite(id));

// LLM
export const GEMINI_MODEL = "gemini-3.1-flash-lite";
export const PRICE_PER_1M_INPUT_USD = 0.25;
export const PRICE_PER_1M_OUTPUT_USD = 1.5;

// Monetization
export const MONTHLY_FLOOR_USD = 20;

// Product loop
export const SWEEP_FRESHNESS_DAYS = 7;
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
