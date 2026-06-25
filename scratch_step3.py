"""Scratch script for Step 3's Done-when check.

Calls generate("say hi", operation="smoke_test") and shows the resulting
token_usage row.
"""
import os

from hearth.data.sqlite_store import SQLiteStore
from hearth.llm.gemini import Gemini

DB_PATH = "scratch_step3.db"
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

store = SQLiteStore(DB_PATH)
gemini = Gemini(store, api_key=os.getenv("GEMINI_API_KEY"))

text, usage = gemini.generate("say hi", operation="smoke_test")
print("text:", text)
print("usage:", usage)

rows = store.query("token_usage", filters={"operation": "smoke_test"})
print("token_usage row:", rows[0])
