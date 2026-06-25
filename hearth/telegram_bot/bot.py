"""Telegram bridge: phone-number signup (product-loop DM surface).

build_application() takes the shared DataStore/Gemini singletons as
closures so handlers never reach for global state.
"""
from datetime import datetime, timezone

from telegram import KeyboardButton, ReplyKeyboardMarkup, ReplyKeyboardRemove, Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from hearth import config
from hearth.data.store import DataStore
from hearth.llm.gemini import Gemini

ACK_MESSAGE = "Got it. Say 'buy me <item>' and I'll find you the best price."


def _normalize_phone(raw: str) -> str:
    raw = raw.strip()
    return raw if raw.startswith("+") else f"+{raw}"


def build_application(store: DataStore, gemini: Gemini) -> Application:
    async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        keyboard = ReplyKeyboardMarkup(
            [[KeyboardButton("Share phone number to set up Hearth", request_contact=True)]],
            resize_keyboard=True,
            one_time_keyboard=True,
        )
        await update.message.reply_text(
            "Welcome to Hearth! Tap below to share your phone number and get set up.",
            reply_markup=keyboard,
        )

    async def handle_contact(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        contact = update.message.contact
        phone_number = _normalize_phone(contact.phone_number)
        telegram_user_id = update.effective_user.id

        existing = store.query("users", filters={"phone_number": phone_number})
        if existing:
            user = existing[0]
            await update.message.reply_text(
                f"Welcome back, {user['display_name']}!",
                reply_markup=ReplyKeyboardRemove(),
            )
            return

        display_name = (
            " ".join(filter(None, [contact.first_name, contact.last_name]))
            or update.effective_user.first_name
            or "there"
        )
        store.insert(
            "users",
            {
                "phone_number": phone_number,
                "telegram_user_id": telegram_user_id,
                "display_name": display_name,
                "zip_code": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        await update.message.reply_text(
            f"Thanks, {display_name}! What's your ZIP code? I need it to match prices near you.",
            reply_markup=ReplyKeyboardRemove(),
        )

    async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        telegram_user_id = update.effective_user.id
        matches = store.query("users", filters={"telegram_user_id": telegram_user_id})

        if matches and matches[0]["zip_code"] is None:
            zip_code = update.message.text.strip()
            store.update("users", matches[0]["id"], {"zip_code": zip_code})
            await update.message.reply_text(f"Got it — {zip_code} saved. {ACK_MESSAGE}")
            return

        await update.message.reply_text(ACK_MESSAGE)

    application = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()
    application.add_handler(CommandHandler("start", start, filters=filters.ChatType.PRIVATE))
    application.add_handler(
        MessageHandler(filters.CONTACT & filters.ChatType.PRIVATE, handle_contact)
    )
    application.add_handler(
        MessageHandler(
            filters.TEXT & ~filters.COMMAND & filters.ChatType.PRIVATE, handle_text
        )
    )
    return application
