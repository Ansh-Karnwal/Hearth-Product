import { MONTHLY_FLOOR_USD, PRICE_PER_1M_INPUT_USD, PRICE_PER_1M_OUTPUT_USD } from "../config";
import { TokenUsageRow } from "../data/schema";
import { DataStore } from "../data/store";

export interface OperationUsage {
  promptTokens: number;
  completionTokens: number;
  usd: number;
}

export interface UsageSummary {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  computedUsd: number;
  billedUsd: number;
  byOperation: Record<string, OperationUsage>;
}

function usdFor(promptTokens: number, completionTokens: number): number {
  return (
    (promptTokens / 1_000_000) * PRICE_PER_1M_INPUT_USD +
    (completionTokens / 1_000_000) * PRICE_PER_1M_OUTPUT_USD
  );
}

function summarizeRows(rows: TokenUsageRow[]): UsageSummary {
  const byOperation: Record<string, OperationUsage> = {};
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (const row of rows) {
    totalPromptTokens += row.prompt_tokens;
    totalCompletionTokens += row.completion_tokens;

    byOperation[row.operation] ??= { promptTokens: 0, completionTokens: 0, usd: 0 };
    byOperation[row.operation].promptTokens += row.prompt_tokens;
    byOperation[row.operation].completionTokens += row.completion_tokens;
  }

  for (const usage of Object.values(byOperation)) {
    usage.usd = usdFor(usage.promptTokens, usage.completionTokens);
  }

  const computedUsd = usdFor(totalPromptTokens, totalCompletionTokens);
  return {
    totalPromptTokens,
    totalCompletionTokens,
    computedUsd,
    billedUsd: Math.max(MONTHLY_FLOOR_USD, computedUsd),
    byOperation,
  };
}

export async function usageFor(
  store: DataStore,
  userId: number,
  periodStart: string,
  periodEnd: string
): Promise<UsageSummary> {
  const rows = await store.query<TokenUsageRow>("token_usage", {
    filters: {
      user_id: userId,
      created_at: { gte: periodStart, lte: periodEnd },
    },
  });

  return summarizeRows(rows);
}

export async function usageForAll(
  store: DataStore,
  periodStart: string,
  periodEnd: string
): Promise<UsageSummary> {
  const rows = await store.query<TokenUsageRow>("token_usage", {
    filters: {
      created_at: { gte: periodStart, lte: periodEnd },
    },
  });

  return summarizeRows(rows);
}

export function currentMonthRange(now = new Date()): { start: string; end: string } {
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return { start: start.toISOString(), end: now.toISOString() };
}

export function formatUsageSummary(summary: UsageSummary, label: string): string {
  const operations = Object.entries(summary.byOperation)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([operation, usage]) =>
        `- ${operation}: ${usage.promptTokens} prompt, ${usage.completionTokens} completion ($${usage.usd.toFixed(4)})`
    );

  return [
    `${label}`,
    `Prompt tokens: ${summary.totalPromptTokens}`,
    `Completion tokens: ${summary.totalCompletionTokens}`,
    `Computed cost: $${summary.computedUsd.toFixed(4)}`,
    `Billed this month: $${summary.billedUsd.toFixed(2)}`,
    "By operation:",
    operations.length > 0 ? operations.join("\n") : "- none yet",
  ].join("\n");
}
