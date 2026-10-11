"""Diagnostics for The Green Finger."""
from __future__ import annotations

from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_CLIENT_ID, CONF_CLIENT_SECRET

TO_REDACT = {CONF_CLIENT_ID, CONF_CLIENT_SECRET}


async def async_get_config_entry_diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    manager = entry.runtime_data
    return {
        "entry": async_redact_data(dict(entry.data), TO_REDACT),
        "plants": {sid: dict(sub.data) for sid, sub in entry.subentries.items()},
        "species_cached": sorted(manager.species),
        "has_client": manager.client is not None,
        "hemisphere": manager.hemisphere,
    }
