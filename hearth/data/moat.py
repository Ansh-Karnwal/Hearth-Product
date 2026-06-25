"""The moat helper: instant price lookups from prior purchases + crowd answers.

Built only on DataStore.query, so it works unchanged against SQLiteStore
today and a future ButterbaseStore.
"""
from datetime import datetime, timedelta, timezone

from hearth.data.store import DataStore, Record


def lookup_prices(
    store: DataStore, item_name: str, zip_code: str, fresh_within_days: int
) -> list[Record]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=fresh_within_days)).isoformat()
    return store.query(
        "price_intelligence",
        filters={
            "item_name": item_name.lower(),
            "zip_code": zip_code,
            "observed_at": {"gte": cutoff},
        },
        sort=[("price", "asc"), ("observed_at", "desc")],
    )
