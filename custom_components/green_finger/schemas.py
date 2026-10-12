"""Service schemas shared by the entity services and the integration services."""
from __future__ import annotations

import voluptuous as vol
from homeassistant.helpers import config_validation as cv

UPDATE_SCHEMA = {
    vol.Optional("name"): cv.string,
    vol.Optional("common_name"): vol.Any(None, cv.string),
    vol.Optional("species"): vol.Any(None, cv.string),
    vol.Optional("inside"): cv.boolean,
    vol.Optional("location"): vol.Any(None, cv.string),
    vol.Optional("area"): vol.Any(None, cv.string),
    vol.Optional("picture"): vol.Any(None, cv.string),
    vol.Optional("last_watered"): vol.Any(None, cv.date),
    vol.Optional("last_fertilised"): vol.Any(None, cv.date),
    vol.Optional("water"): vol.Any(str, list),
    vol.Optional("feed"): vol.Any(str, list),
    vol.Optional("moisture_entity"): vol.Any(None, cv.string),
    vol.Optional("auto_watered"): cv.boolean,
    vol.Optional("moisture_range"): vol.Any(None, list),
    vol.Optional("temperature_range"): vol.Any(None, list),
    vol.Optional("npk"): vol.Any(None, list),
    vol.Optional("fertiliser_name"): vol.Any(None, cv.string),
    vol.Optional("soil_mix"): vol.Any(None, str, list),
    vol.Optional("soil_notes"): vol.Any(None, cv.string),
    vol.Optional("notes"): vol.Any(None, cv.string),
}
