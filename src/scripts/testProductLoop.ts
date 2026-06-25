import os from "node:os";
import path from "node:path";
import { UserRow } from "../data/schema";
import { SqliteStore } from "../data/sqliteStore";
import { createLlm } from "../llm";
import { currentMonthRange, formatUsageSummary, usageFor } from "../loops/monetization";
import { confirmPurchaseRequest, handleBuyRequest } from "../loops/product";

const telegramUserId = 555000222;

function fakePrivateCtx(text: string): any {
  return {
    from: { id: telegramUserId },
    chat: { id: telegramUserId, type: "private" },
    message: { text },
    reply: async (message: string, options?: unknown) => {
      console.log("DM:", message);
      if (options) console.log("DM options:", JSON.stringify(options));
    },
    api: {
      sendMessage: async (chatId: string | number, message: string) => {
        console.log("API sendMessage:", chatId, message);
        return { message_id: 999 };
      },
    },
  };
}

async function latestRequestId(store: SqliteStore): Promise<number> {
  const rows = await store.query<{ id: number }>("purchase_requests", {
    sort: [["id", "desc"]],
    limit: 1,
  });
  return rows[0].id;
}

async function operationsForRequest(store: SqliteStore, requestId: number): Promise<string[]> {
  const rows = await store.query<{ operation: string }>("token_usage", {
    filters: { request_id: requestId },
    sort: [["id", "asc"]],
  });
  return rows.map((row) => row.operation);
}

async function main(): Promise<void> {
  const store = new SqliteStore(path.join(os.tmpdir(), `hearth-product-loop-${process.pid}.db`));
  const llm = createLlm(store);

  const user = await store.insert<UserRow>("users", {
    phone_number: "+16175550100",
    telegram_user_id: telegramUserId,
    display_name: "Product Loop Test",
    zip_code: "02139",
    created_at: new Date().toISOString(),
  });

  await handleBuyRequest(fakePrivateCtx("buy me celery"), store, llm);
  const firstRequestId = await latestRequestId(store);
  console.log("First request ops before confirm:", await operationsForRequest(store, firstRequestId));
  console.log("First confirm:", await confirmPurchaseRequest(store, firstRequestId, true));

  const learnedAfterFirst = await store.query("price_intelligence", {
    filters: { item_name: "celery", zip_code: "02139" },
    sort: [["id", "asc"]],
  });
  console.log("Learned prices after first run:", learnedAfterFirst);

  await handleBuyRequest(fakePrivateCtx("buy me celery"), store, llm);
  const secondRequestId = await latestRequestId(store);
  console.log("Second request ops before confirm:", await operationsForRequest(store, secondRequestId));
  console.log("Second confirm:", await confirmPurchaseRequest(store, secondRequestId, true));

  const tokenRows = await store.query("token_usage", { sort: [["id", "asc"]] });
  console.log("All token_usage rows:", tokenRows);

  const { start, end } = currentMonthRange();
  const usage = await usageFor(store, user.id, start, end);
  console.log(formatUsageSummary(usage, "Product-loop user usage this month"));
  console.log("Reconciliation:", {
    prompt: tokenRows.reduce((sum: number, row: any) => sum + row.prompt_tokens, 0),
    completion: tokenRows.reduce((sum: number, row: any) => sum + row.completion_tokens, 0),
  });

  store.close();
}

main();
