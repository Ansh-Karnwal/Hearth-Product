"""Entrypoint. Boots the DB and the Telegram bot."""
from hearth import config
from hearth.data.sqlite_store import SQLiteStore
from hearth.llm.gemini import Gemini


def main() -> None:
    store = SQLiteStore(config.DB_PATH)
    gemini = Gemini(store)
    print("Hearth up — DB ready")

    if not config.TELEGRAM_BOT_TOKEN:
        print("TELEGRAM_BOT_TOKEN not set — skipping bot startup")
        return

    from hearth.telegram_bot.bot import build_application

    application = build_application(store, gemini)
    application.run_polling()


if __name__ == "__main__":
    main()
