import { UserRow } from "../data/schema";
import { SqliteStore } from "../data/sqliteStore";
import { handleContactShare, handleStart, handleTextMessage } from "../telegram/bot";

async function main(): Promise<void> {
  const store = new SqliteStore("hearth.db");
  const telegramUserId = 555000111;

  console.log("1) /start (new user):", await handleStart(store, telegramUserId));

  console.log(
    "2) share contact:",
    await handleContactShare(store, {
      phoneNumber: "+1 (617) 555-0100",
      firstName: "Test",
      lastName: "User",
      telegramUserId,
    })
  );

  console.log(
    "3) share contact AGAIN (simulating a second /start + tap):",
    await handleContactShare(store, {
      phoneNumber: "+1 (617) 555-0100",
      firstName: "Test",
      lastName: "User",
      telegramUserId,
    })
  );

  console.log("4) /start again (already registered):", await handleStart(store, telegramUserId));

  const fromName = { firstName: "Test", lastName: "User" };

  console.log("5) reply with ZIP:", await handleTextMessage(store, telegramUserId, "02139", fromName));

  console.log(
    "6) reply with item request:",
    await handleTextMessage(store, telegramUserId, "buy me celery", fromName)
  );

  const rows = await store.query<UserRow>("users", { filters: { telegram_user_id: telegramUserId } });
  console.log("final user rows for this telegram_user_id:", rows);

  // Regression check: a desktop user who types their phone number instead of
  // tapping the contact button should still register and get asked for a ZIP.
  const typedPhoneUserId = 555000222;
  console.log("7) /start (new user):", await handleStart(store, typedPhoneUserId));
  console.log(
    "8) types phone number instead of tapping contact button:",
    await handleTextMessage(store, typedPhoneUserId, "6175550100", fromName)
  );
  console.log("9) reply with ZIP:", await handleTextMessage(store, typedPhoneUserId, "02139", fromName));
  console.log(
    "10) reply with item request:",
    await handleTextMessage(store, typedPhoneUserId, "buy me celery", fromName)
  );

  const typedPhoneRows = await store.query<UserRow>("users", { filters: { telegram_user_id: typedPhoneUserId } });
  console.log("final user rows for typed-phone-number signup:", typedPhoneRows);

  store.close();
}

main();
