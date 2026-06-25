// DataStore mirrors butterbase.ai's REST CRUD semantics (insert / get /
// query-with-filters-sort-limit / update / delete). Every loop depends only on
// this interface, never on SQLite directly — see sqliteStore.ts for the swap
// comment explaining how a ButterbaseStore drops in later.

export interface RangeFilter {
  gte?: unknown;
  lte?: unknown;
  gt?: unknown;
  lt?: unknown;
}

export interface QueryOptions {
  filters?: Record<string, unknown | RangeFilter>;
  sort?: Array<[string, "asc" | "desc"]>;
  limit?: number;
}

export interface DataStore {
  insert<T>(table: string, record: Omit<T, "id">): Promise<T>;
  get<T>(table: string, id: number): Promise<T | null>;
  query<T>(table: string, options?: QueryOptions): Promise<T[]>;
  update<T>(table: string, id: number, patch: Partial<T>): Promise<T>;
  delete(table: string, id: number): Promise<void>;
}
