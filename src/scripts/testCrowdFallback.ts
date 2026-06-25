import os from "node:os";
import path from "node:path";
import { HEARTH_CROWD_GROUP_ID } from "../config";
import { SocialPostRow, UserRow } from "../data/schema";
import { SqliteStore } from "../data/sqliteStore";
import { createLlm } from "../llm";
import {
  confirmPurchaseRequest,
  handleBuyRequest,
  handleCrowdReply,
  resolveCrowdQuestion,
} from "../loops/product";

const telegramUserId = 555000333;
const crowdUserId = 555000444;

const fakeApi = {
  sendMessage: async (chatId: string | number, message: string, options?: unknown) => {
    console.log("API sendMessage:", chatId, message);
    if (options) console.log("API options:", JSON.stringify(options));
    return { message_id: 777 };
  },
};

function fakePrivateCtx(text: string): any {
  return {
    from: { id: telegramUserId },
    chat: { id: telegramUserId, type: "private" },
    message: { text },
    reply: async (message: string) => console.log("DM:", message),
    api: fakeApi,
  };
}

function fakeCrowdCtx(replyToMessageId: number): any {
  return {
    from: { id: crowdUserId },
    chat: { id: Number(HEARTH_CROWD_GROUP_ID), type: "supergroup" },
    message: {
      text: "Market Basket has it for $1.89",
      reply_to_message: { message_id: replyToMessageId },
    },
    api: fakeApi,
  };
}

async function latestRequestId(store: SqliteStore): Promise<number> {
  const rows = await store.query<{ id: number }>("purchase_requests", {
    sort: [["id", "desc"]],
    limit: 1,
  });
  return rows[0].id;
}

async function main(): Promise<void> {
  if (!HEARTH_CROWD_GROUP_ID) {
    throw new Error("Set HEARTH_CROWD_GROUP_ID for this script, e.g. HEARTH_CROWD_GROUP_ID=-100123");
  }

  const store = new SqliteStore(path.join(os.tmpdir(), `hearth-crowd-loop-${process.pid}.db`));
  const llm = createLlm(store);

  await store.insert<UserRow>("users", {
    phone_number: "+16175550101",
    telegram_user_id: telegramUserId,
    display_name: "Crowd Loop Test",
    zip_code: "02139",
    created_at: new Date().toISOString(),
  });

  await handleBuyRequest(fakePrivateCtx("buy me ambiguous apples"), store, llm);
  const post = (
    await store.query<SocialPostRow>("social_posts", {
      filters: { post_type: "crowd_question" },
      sort: [["id", "desc"]],
      limit: 1,
    })
  )[0];
  console.log("Crowd post:", post);

  await handleCrowdReply(fakeCrowdCtx(post.telegram_message_id!), store, llm);
  console.log("Crowd responses:", await store.query("crowd_responses", { sort: [["id", "asc"]] }));

  await resolveCrowdQuestion(post.id, store, fakeApi);
  const requestId = await latestRequestId(store);
  console.log("Confirm:", await confirmPurchaseRequest(store, requestId, true, llm, fakeApi));
  console.log("Learned prices:", await store.query("price_intelligence", { sort: [["id", "asc"]] }));
  console.log("Token operations:", await store.query("token_usage", { sort: [["id", "asc"]] }));

  store.close();
}

main();
