"""Scratch script for Step 4's Done-when check.

This can't open a real Telegram connection without a live bot token, so it
drives the registered handler callbacks directly with mock Update objects —
verifying the signup/dedup/ZIP-capture logic that a real Telegram message
would trigger.
"""
import asyncio
import os
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "123456:fake-token-for-handler-construction")

from hearth.data.sqlite_store import SQLiteStore
from hearth.llm.gemini import Gemini
from hearth.telegram_bot.bot import build_application

DB_PATH = "scratch_step4.db"
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

store = SQLiteStore(DB_PATH)
gemini = Gemini(store, api_key=None)
app = build_application(store, gemini)

handlers = {}
for handler in app.handlers[0]:
    handlers[handler.callback.__name__] = handler.callback


def make_contact_update(telegram_user_id, phone_number, first_name):
    update = MagicMock()
    update.effective_user.id = telegram_user_id
    update.effective_user.first_name = first_name
    update.message.contact.phone_number = phone_number
    update.message.contact.first_name = first_name
    update.message.contact.last_name = None
    update.message.reply_text = AsyncMock()
    return update


def make_text_update(telegram_user_id, text):
    update = MagicMock()
    update.effective_user.id = telegram_user_id
    update.message.text = text
    update.message.reply_text = AsyncMock()
    return update


async def run():
    contact_cb = handlers["handle_contact"]
    text_cb = handlers["handle_text"]

    u1 = make_contact_update(111, "16175551234", "Rajat")
    await contact_cb(u1, None)
    print("after first contact share, reply:", u1.message.reply_text.call_args[0][0])

    u2 = make_contact_update(111, "16175551234", "Rajat")
    await contact_cb(u2, None)
    print("after second /start + contact share, reply:", u2.message.reply_text.call_args[0][0])

    users = store.query("users", filters={"phone_number": "+16175551234"})
    print(f"user rows for this phone number: {len(users)} -> {users}")

    u3 = make_text_update(111, "02139")
    await text_cb(u3, None)
    print("after ZIP reply:", u3.message.reply_text.call_args[0][0])

    updated = store.get("users", users[0]["id"])
    print("user row after ZIP capture:", updated)


asyncio.run(run())
