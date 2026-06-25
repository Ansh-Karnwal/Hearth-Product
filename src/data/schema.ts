// Declarative, JSON-serializable schema — mirrors how butterbase.ai describes
// tables/columns. sqliteStore.ts reads this object to create tables; when we
// migrate to butterbase, the same shape can describe its declarative schema.

export type ColumnType = "integer" | "real" | "text";

export interface ColumnDef {
  type: ColumnType;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  unique?: boolean;
  notNull?: boolean;
  references?: { table: string; column: string };
}

export interface TableDef {
  columns: Record<string, ColumnDef>;
}

export const schema: Record<string, TableDef> = {
  users: {
    columns: {
      id: { type: "integer", primaryKey: true, autoIncrement: true },
      phone_number: { type: "text", unique: true, notNull: true },
      telegram_user_id: { type: "integer", unique: true },
      display_name: { type: "text" },
      zip_code: { type: "text" },
      created_at: { type: "text", notNull: true },
    },
  },

  price_intelligence: {
    columns: {
      id: { type: "integer", primaryKey: true, autoIncrement: true },
      item_name: { type: "text", notNull: true },
      store: { type: "text", notNull: true },
      zip_code: { type: "text", notNull: true },
      price: { type: "real", notNull: true },
      unit: { type: "text" },
      source: { type: "text", notNull: true },
      observed_at: { type: "text", notNull: true },
    },
  },

  purchase_requests: {
    columns: {
      id: { type: "integer", primaryKey: true, autoIncrement: true },
      user_id: { type: "integer", notNull: true, references: { table: "users", column: "id" } },
      raw_text: { type: "text", notNull: true },
      item_name: { type: "text" },
      quantity: { type: "text" },
      status: { type: "text", notNull: true },
      chosen_store: { type: "text" },
      chosen_price: { type: "real" },
      created_at: { type: "text", notNull: true },
      completed_at: { type: "text" },
    },
  },

  token_usage: {
    columns: {
      id: { type: "integer", primaryKey: true, autoIncrement: true },
      user_id: { type: "integer", references: { table: "users", column: "id" } },
      operation: { type: "text", notNull: true },
      model: { type: "text", notNull: true },
      prompt_tokens: { type: "integer", notNull: true },
      completion_tokens: { type: "integer", notNull: true },
      total_tokens: { type: "integer", notNull: true },
      request_id: { type: "integer", references: { table: "purchase_requests", column: "id" } },
      created_at: { type: "text", notNull: true },
    },
  },

  social_posts: {
    columns: {
      id: { type: "integer", primaryKey: true, autoIncrement: true },
      post_type: { type: "text", notNull: true },
      channel: { type: "text", notNull: true },
      content: { type: "text", notNull: true },
      related_request_id: { type: "integer", references: { table: "purchase_requests", column: "id" } },
      telegram_message_id: { type: "integer" },
      posted_at: { type: "text", notNull: true },
    },
  },

  crowd_responses: {
    columns: {
      id: { type: "integer", primaryKey: true, autoIncrement: true },
      post_id: { type: "integer", notNull: true, references: { table: "social_posts", column: "id" } },
      telegram_user_id: { type: "integer", notNull: true },
      raw_text: { type: "text", notNull: true },
      parsed_store: { type: "text" },
      parsed_price: { type: "real" },
      created_at: { type: "text", notNull: true },
    },
  },
};

// ---- Row types (TypeScript-only; mirror the declarative schema above) ----

export interface UserRow {
  id: number;
  phone_number: string;
  telegram_user_id: number | null;
  display_name: string | null;
  zip_code: string | null;
  created_at: string;
}

export type PriceSource = "sweep" | "crowd" | "purchase";

export interface PriceIntelligenceRow {
  id: number;
  item_name: string;
  store: string;
  zip_code: string;
  price: number;
  unit: string | null;
  source: PriceSource;
  observed_at: string;
}

export type PurchaseRequestStatus =
  | "parsing"
  | "sweeping"
  | "crowd_pending"
  | "awaiting_confirmation"
  | "purchased"
  | "cancelled";

export interface PurchaseRequestRow {
  id: number;
  user_id: number;
  raw_text: string;
  item_name: string | null;
  quantity: string | null;
  status: PurchaseRequestStatus;
  chosen_store: string | null;
  chosen_price: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface TokenUsageRow {
  id: number;
  user_id: number | null;
  operation: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  request_id: number | null;
  created_at: string;
}

export type SocialPostType = "growth_insight" | "crowd_question";

export interface SocialPostRow {
  id: number;
  post_type: SocialPostType;
  channel: string;
  content: string;
  related_request_id: number | null;
  telegram_message_id: number | null;
  posted_at: string;
}

export interface CrowdResponseRow {
  id: number;
  post_id: number;
  telegram_user_id: number;
  raw_text: string;
  parsed_store: string | null;
  parsed_price: number | null;
  created_at: string;
}
