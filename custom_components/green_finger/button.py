"""Water / fertilise buttons for each plant."""
from __future__ import annotations

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import SUBENTRY_PLANT
from .entity import device_info
from .manager import GreenFingerManager

PARALLEL_UPDATES = 0


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    manager: GreenFingerManager = entry.runtime_data
    for subentry_id, subentry in entry.subentries.items():
        if subentry.subentry_type == SUBENTRY_PLANT:
            async_add_entities(
                [GreenFingerButton(manager, subentry_id, kind) for kind in ("water", "fertilise")],
                config_subentry_id=subentry_id,
            )


class GreenFingerButton(ButtonEntity):
    """Marks the plant as watered / fertilised today."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, manager: GreenFingerManager, subentry_id: str, kind: str) -> None:
        self._manager = manager
        self._subentry_id = subentry_id
        self._kind = kind
        self._attr_unique_id = f"{subentry_id}_{kind}"
        self._attr_translation_key = kind
        self._attr_device_info = device_info(manager, subentry_id)

    async def async_press(self) -> None:
        self._manager.async_mark(self._subentry_id, self._kind)
