"""SQLite-backed DataStore.

To migrate: implement ButterbaseStore(DataStore) calling the butterbase
auto-REST CRUD endpoints (driven by the same schema.SCHEMA dict handed to
butterbase's declarative schema API). Loops depend only on the DataStore
interface, so swapping the implementation here requires no changes to
loops/product.py, loops/growth.py, loops/monetization.py, or llm/gemini.py.
"""
import sqlite3
from typing import Any, Optional

from hearth.data.schema import SCHEMA
from hearth.data.store import DataStore, Filters, Record, Sort

_SQL_TYPES = {
    "integer": "INTEGER",
    "real": "REAL",
    "text": "TEXT",
}

_OPERATORS = {
    "gte": ">=",
    "lte": "<=",
    "gt": ">",
    "lt": "<",
    "ne": "!=",
    "eq": "=",
}


class SQLiteStore(DataStore):
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._create_tables()

    def _create_tables(self) -> None:
        for table, definition in SCHEMA.items():
            column_defs = []
            for name, spec in definition["columns"].items():
                col_sql = f'"{name}" {_SQL_TYPES[spec["type"]]}'
                if spec.get("pk"):
                    col_sql += " PRIMARY KEY"
                    if spec.get("autoincrement"):
                        col_sql += " AUTOINCREMENT"
                if spec.get("unique"):
                    col_sql += " UNIQUE"
                if not spec.get("nullable", True) and not spec.get("pk"):
                    col_sql += " NOT NULL"
                column_defs.append(col_sql)
            ddl = f'CREATE TABLE IF NOT EXISTS "{table}" ({", ".join(column_defs)})'
            self._conn.execute(ddl)
        self._conn.commit()

    def insert(self, table: str, record: Record) -> Record:
        columns = list(record.keys())
        placeholders = ", ".join("?" for _ in columns)
        col_sql = ", ".join(f'"{c}"' for c in columns)
        cursor = self._conn.execute(
            f'INSERT INTO "{table}" ({col_sql}) VALUES ({placeholders})',
            [record[c] for c in columns],
        )
        self._conn.commit()
        return self.get(table, cursor.lastrowid)

    def get(self, table: str, id: int) -> Optional[Record]:
        row = self._conn.execute(
            f'SELECT * FROM "{table}" WHERE id = ?', (id,)
        ).fetchone()
        return dict(row) if row else None

    def query(
        self,
        table: str,
        filters: Optional[Filters] = None,
        sort: Optional[Sort] = None,
        limit: Optional[int] = None,
    ) -> list[Record]:
        sql = f'SELECT * FROM "{table}"'
        params: list[Any] = []

        if filters:
            clauses = []
            for column, condition in filters.items():
                if isinstance(condition, dict):
                    for op, value in condition.items():
                        if op not in _OPERATORS:
                            raise ValueError(f"Unsupported filter operator: {op}")
                        clauses.append(f'"{column}" {_OPERATORS[op]} ?')
                        params.append(value)
                else:
                    clauses.append(f'"{column}" = ?')
                    params.append(condition)
            sql += " WHERE " + " AND ".join(clauses)

        if sort:
            order_clauses = [
                f'"{column}" {"ASC" if direction.lower() == "asc" else "DESC"}'
                for column, direction in sort
            ]
            sql += " ORDER BY " + ", ".join(order_clauses)

        if limit is not None:
            sql += " LIMIT ?"
            params.append(limit)

        rows = self._conn.execute(sql, params).fetchall()
        return [dict(row) for row in rows]

    def update(self, table: str, id: int, patch: Record) -> Record:
        columns = list(patch.keys())
        set_sql = ", ".join(f'"{c}" = ?' for c in columns)
        self._conn.execute(
            f'UPDATE "{table}" SET {set_sql} WHERE id = ?',
            [*[patch[c] for c in columns], id],
        )
        self._conn.commit()
        return self.get(table, id)

    def delete(self, table: str, id: int) -> None:
        self._conn.execute(f'DELETE FROM "{table}" WHERE id = ?', (id,))
        self._conn.commit()
