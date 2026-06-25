import Database from "better-sqlite3";
import { debugLog } from "../debug";
import { ColumnDef, schema, TableDef } from "./schema";
import { DataStore, QueryOptions, RangeFilter } from "./store";

// To migrate: implement ButterbaseStore satisfying the DataStore interface, calling the
// butterbase auto-REST CRUD endpoints. All loops depend only on DataStore — no changes needed there.

function columnSql(name: string, def: ColumnDef): string {
  const sqlType = def.type === "integer" ? "INTEGER" : def.type === "real" ? "REAL" : "TEXT";
  const parts = [name, sqlType];
  if (def.primaryKey) parts.push("PRIMARY KEY");
  if (def.primaryKey && def.autoIncrement) parts.push("AUTOINCREMENT");
  if (def.notNull) parts.push("NOT NULL");
  if (def.unique) parts.push("UNIQUE");
  return parts.join(" ");
}

function createTableSql(table: string, def: TableDef): string {
  const columnLines = Object.entries(def.columns).map(([name, col]) => columnSql(name, col));
  const foreignKeyLines = Object.entries(def.columns)
    .filter(([, col]) => col.references)
    .map(
      ([name, col]) =>
        `FOREIGN KEY (${name}) REFERENCES ${col.references!.table}(${col.references!.column})`
    );
  const lines = [...columnLines, ...foreignKeyLines];
  return `CREATE TABLE IF NOT EXISTS ${table} (\n  ${lines.join(",\n  ")}\n)`;
}

function isRangeFilter(value: unknown): value is RangeFilter {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return ["gte", "lte", "gt", "lt"].some((key) => key in (value as Record<string, unknown>));
}

export class SqliteStore implements DataStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.createTables();
  }

  private createTables(): void {
    for (const [table, def] of Object.entries(schema)) {
      this.db.exec(createTableSql(table, def));
    }
  }

  async insert<T>(table: string, record: Omit<T, "id">): Promise<T> {
    const keys = Object.keys(record as object);
    const columns = keys.join(", ");
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((key) => (record as Record<string, unknown>)[key]);

    const info = this.db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`).run(...values);
    const row = await this.get<T>(table, Number(info.lastInsertRowid));
    if (!row) throw new Error(`Failed to read back inserted row in ${table}`);
    debugLog("db:insert", `${table} id=${info.lastInsertRowid}`, record);
    return row;
  }

  async get<T>(table: string, id: number): Promise<T | null> {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    return (row as T) ?? null;
  }

  async query<T>(table: string, options: QueryOptions = {}): Promise<T[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    for (const [column, value] of Object.entries(options.filters ?? {})) {
      if (isRangeFilter(value)) {
        if (value.gte !== undefined) {
          clauses.push(`${column} >= ?`);
          params.push(value.gte);
        }
        if (value.lte !== undefined) {
          clauses.push(`${column} <= ?`);
          params.push(value.lte);
        }
        if (value.gt !== undefined) {
          clauses.push(`${column} > ?`);
          params.push(value.gt);
        }
        if (value.lt !== undefined) {
          clauses.push(`${column} < ?`);
          params.push(value.lt);
        }
      } else {
        if (value === null) {
          clauses.push(`${column} IS NULL`);
        } else {
          clauses.push(`${column} = ?`);
          params.push(value);
        }
      }
    }

    let sql = `SELECT * FROM ${table}`;
    if (clauses.length > 0) sql += ` WHERE ${clauses.join(" AND ")}`;
    if (options.sort && options.sort.length > 0) {
      const orderBy = options.sort.map(([column, dir]) => `${column} ${dir.toUpperCase()}`).join(", ");
      sql += ` ORDER BY ${orderBy}`;
    }
    if (options.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = this.db.prepare(sql).all(...params);
    return rows as T[];
  }

  async update<T>(table: string, id: number, patch: Partial<T>): Promise<T> {
    const keys = Object.keys(patch as object);
    if (keys.length > 0) {
      const setClause = keys.map((key) => `${key} = ?`).join(", ");
      const values = keys.map((key) => (patch as Record<string, unknown>)[key]);
      this.db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = ?`).run(...values, id);
    }
    const row = await this.get<T>(table, id);
    if (!row) throw new Error(`${table} id=${id} not found after update`);
    debugLog("db:update", `${table} id=${id}`, patch);
    return row;
  }

  async delete(table: string, id: number): Promise<void> {
    this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    debugLog("db:delete", `${table} id=${id}`);
  }

  close(): void {
    this.db.close();
  }
}
