"""Shared device helpers for The Green Finger entities."""
from __future__ import annotations

from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant
from homeassistant.helpers import area_registry as ar, device_registry as dr
from homeassistant.helpers.device_registry import DeviceEntry, DeviceInfo

from .const import DOMAIN

if TYPE_CHECKING:
    from .manager import GreenFingerManager


def device_info(manager: GreenFingerManager, subentry_id: str) -> DeviceInfo:
    """Device description shared by every entity of one plant."""
    plant = manager.plant(subentry_id) or {}
    area = ar.async_get(manager.hass).async_get_area(plant["area"]) if plant.get("area") else None
    species = manager.species.get(plant.get("species") or "") or {}
    return DeviceInfo(
        identifiers={(DOMAIN, subentry_id)},
        name=plant.get("common_name") or plant.get("name"),
        manufacturer="The Green Finger",
        model=species.get("display_pid") or "Plant",
        entry_type=dr.DeviceEntryType.SERVICE,
        suggested_area=area.name if area else None,
    )


def find_device(hass: HomeAssistant, entry_id: str, subentry_id: str) -> DeviceEntry | None:
    """The device of a plant (looked up within this config entry)."""
    ident = (DOMAIN, subentry_id)
    for device in dr.async_entries_for_config_entry(dr.async_get(hass), entry_id):
        if ident in device.identifiers:
            return device
    return None
