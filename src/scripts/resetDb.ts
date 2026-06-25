import { existsSync, unlinkSync } from "fs";
import { DB_PATH } from "../config";

// SQLite WAL mode splits state across the main file plus -wal/-shm/-journal
// sidecars; all four need to go for a clean reset.
const suffixes = ["", "-wal", "-shm", "-journal"];

let deleted = 0;
let failed = false;
for (const suffix of suffixes) {
  const path = `${DB_PATH}${suffix}`;
  if (!existsSync(path)) continue;

  try {
    unlinkSync(path);
    console.log(`Deleted ${path}`);
    deleted += 1;
  } catch (error) {
    failed = true;
    console.error(`Could not delete ${path} — stop the running bot first.`, (error as Error).message);
  }
}

if (failed) process.exitCode = 1;
else if (deleted === 0) console.log("Nothing to delete — DB already clean.");
