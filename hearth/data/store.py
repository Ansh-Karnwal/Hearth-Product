"""DataStore: the seam between every loop and the database.

Methods mirror butterbase's auto-REST CRUD semantics (insert / get /
query-with-filters-sort-limit / update / delete) so that swapping the
SQLite-backed implementation for a ButterbaseStore later requires no
changes to callers.
"""
from abc import ABC, abstractmethod
from typing import Any, Optional

Record = dict[str, Any]
Filters = dict[str, Any]
Sort = list[tuple[str, str]]


class DataStore(ABC):
    @abstractmethod
    def insert(self, table: str, record: Record) -> Record:
        """Insert a record, returning it with its assigned id."""

    @abstractmethod
    def get(self, table: str, id: int) -> Optional[Record]:
        """Fetch a single record by id, or None."""

    @abstractmethod
    def query(
        self,
        table: str,
        filters: Optional[Filters] = None,
        sort: Optional[Sort] = None,
        limit: Optional[int] = None,
    ) -> list[Record]:
        """Query records.

        filters: {column: value} for equality, or {column: {"gte"|"lte"|"gt"|"lt"|"ne": value}}
        sort: [(column, "asc"|"desc"), ...]
        """

    @abstractmethod
    def update(self, table: str, id: int, patch: Record) -> Record:
        """Patch a record by id, returning the updated record."""

    @abstractmethod
    def delete(self, table: str, id: int) -> None:
        """Delete a record by id."""
