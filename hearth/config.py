"""Central configuration for Hearth. Loaded once from the environment."""
import os

from dotenv import load_dotenv

load_dotenv()

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
HEARTH_CHANNEL_ID = os.getenv("HEARTH_CHANNEL_ID")
HEARTH_CROWD_GROUP_ID = os.getenv("HEARTH_CROWD_GROUP_ID")
DB_PATH = os.getenv("DB_PATH", "hearth.db")

# Single swappable model id. There is no "gemini-3.5-flash-lite" — 3.5 only
# ships as the pricier "gemini-3.5-flash". Default to 3.1-flash-lite.
GEMINI_MODEL = "gemini-3.1-flash-lite"

PRICE_PER_1M_INPUT_USD = 0.25
PRICE_PER_1M_OUTPUT_USD = 1.50
MONTHLY_FLOOR_USD = 20

# How recent a known price must be to skip a fresh sweep.
SWEEP_FRESHNESS_DAYS = 7

# Growth loop cadence.
GROWTH_INTERVAL_HOURS = 6
