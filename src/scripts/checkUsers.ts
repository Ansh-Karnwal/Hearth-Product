import { UserRow } from "../data/schema";
import { SqliteStore } from "../data/sqliteStore";

async function main(): Promise<void> {
  const store = new SqliteStore("hearth.db");
  const rows = await store.query<UserRow>("users");
  console.log(JSON.stringify(rows, null, 2));
  store.close();
}

main();
