"""Scratch script for Step 2's Done-when check.

Inserts two "celery" price_intelligence rows in zip 02139 and confirms
lookup_prices returns them cheapest-first.
"""
import os

from hearth.data.moat import lookup_prices
from hearth.data.sqlite_store import SQLiteStore

DB_PATH = "scratch_step2.db"
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

store = SQLiteStore(DB_PATH)

store.insert(
    "price_intelligence",
    {
        "item_name": "celery",
        "store": "Trader Joe's",
        "zip_code": "02139",
        "price": 1.99,
        "unit": "bunch",
        "source": "purchase",
        "observed_at": "2026-06-23T12:00:00+00:00",
    },
)
store.insert(
    "price_intelligence",
    {
        "item_name": "celery",
        "store": "Instacart",
        "zip_code": "02139",
        "price": 3.49,
        "unit": "bunch",
        "source": "sweep",
        "observed_at": "2026-06-24T08:00:00+00:00",
    },
)

results = lookup_prices(store, "celery", "02139", fresh_within_days=7)
for row in results:
    print(f"{row['store']:<15} ${row['price']:<6} observed {row['observed_at']}")
