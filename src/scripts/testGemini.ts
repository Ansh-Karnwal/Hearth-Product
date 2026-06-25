import { GEMINI_API_KEY } from "../config";
import { SqliteStore } from "../data/sqliteStore";
import { TokenUsageRow } from "../data/schema";
import Gemini from "../llm/gemini";

async function main(): Promise<void> {
  const store = new SqliteStore("hearth.db");
  const gemini = new Gemini(store, GEMINI_API_KEY);

  const result = await gemini.generate("say hi", { operation: "smoke_test" });
  console.log("generate() result:", result);

  const rows = await store.query<TokenUsageRow>("token_usage", {
    filters: { operation: "smoke_test" },
    sort: [["id", "desc"]],
    limit: 1,
  });
  console.log("token_usage row:", rows[0]);

  store.close();
}

main();
