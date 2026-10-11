"""Constants for The Green Finger."""
from __future__ import annotations

DOMAIN = "green_finger"
SUBENTRY_PLANT = "plant"

CONF_CLIENT_ID = "client_id"
CONF_CLIENT_SECRET = "client_secret"

STATES = ["ok", "needs_water", "needs_feed", "needs_both"]

FRONTEND_URL = f"/{DOMAIN}/green-finger-card.js"
