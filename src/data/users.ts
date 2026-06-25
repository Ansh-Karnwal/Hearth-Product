import { UserRow } from "./schema";
import { DataStore } from "./store";

export function normalizePhone(raw: string): string {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "");
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

export async function findUserByPhone(store: DataStore, phoneNumber: string): Promise<UserRow | null> {
  const rows = await store.query<UserRow>("users", { filters: { phone_number: phoneNumber }, limit: 1 });
  return rows[0] ?? null;
}

export async function findUserByTelegramId(
  store: DataStore,
  telegramUserId: number
): Promise<UserRow | null> {
  const rows = await store.query<UserRow>("users", {
    filters: { telegram_user_id: telegramUserId },
    limit: 1,
  });
  return rows[0] ?? null;
}
