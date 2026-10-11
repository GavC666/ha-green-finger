"""One sensor entity per plant."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    config_validation as cv,
    device_registry as dr,
    entity_platform,
    entity_registry as er,
)
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event, async_track_time_change
from homeassistant.util import dt as dt_util

from . import logic
from .const import DOMAIN, STATES, SUBENTRY_PLANT
from .entity import device_info, find_device
from .manager import GreenFingerManager
from .schemas import UPDATE_SCHEMA

PARALLEL_UPDATES = 0

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    manager: GreenFingerManager = entry.runtime_data
    for subentry_id, subentry in entry.subentries.items():
        if subentry.subentry_type == SUBENTRY_PLANT:
            async_add_entities([GreenFingerSensor(manager, subentry_id)], config_subentry_id=subentry_id)

    platform = entity_platform.async_get_current_platform()
    date_schema = {vol.Optional("date"): cv.date}
    platform.async_register_entity_service("water", date_schema, "async_water")
    platform.async_register_entity_service("fertilise", date_schema, "async_fertilise")
    platform.async_register_entity_service("update_plant", UPDATE_SCHEMA, "async_update_plant")
    platform.async_register_entity_service("remove_plant", {}, "async_remove_plant")


class GreenFingerSensor(SensorEntity):
    """State = ok / needs_water / needs_feed / needs_both; everything else is an attribute."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_should_poll = False
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = STATES
    _attr_translation_key = "plant"
    # large / rarely useful attributes are kept out of the recorder database
    _unrecorded_attributes = frozenset({
        "care", "common_names", "water_schedule", "feed_schedule", "soil_mix", "soil_notes",
        "species_picture", "picture", "notes", "ideal_moisture", "ideal_temperature",
    })

    def __init__(self, manager: GreenFingerManager, subentry_id: str) -> None:
        self._manager = manager
        self._subentry_id = subentry_id
        self._attr_unique_id = subentry_id
        self._data: dict[str, Any] | None = None
        self._unsub_states: Any = None
        self._attr_device_info = device_info(manager, subentry_id)

    # ----------------------------------------------------------- properties
    @property
    def native_value(self) -> str | None:
        return self._data["state"] if self._data else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        if not self._data:
            return None
        return {**self._data["attributes"], "plant_id": self._subentry_id}

    @property
    def entity_picture(self) -> str | None:
        return (self._data or {}).get("attributes", {}).get("picture")

    # ------------------------------------------------------------- lifecycle
    async def async_added_to_hass(self) -> None:
        self._manager.entities[self._subentry_id] = self
        self.async_on_remove(lambda: self._manager.entities.pop(self._subentry_id, None))
        self.async_on_remove(self._untrack)
        self.async_on_remove(
            async_track_time_change(self.hass, lambda _now: self.refresh(), hour=0, minute=1, second=0)
        )
        self._recompute()
        self._track()

    # --------------------------------------------------------------- helpers
    def _siblings(self, moisture_entity: str) -> tuple[dict[str, str], str | None]:
        """Temperature / battery entities and the name of the moisture sensor's device."""
        ent_reg = er.async_get(self.hass)
        ent = ent_reg.async_get(moisture_entity)
        found: dict[str, str] = {}
        name: str | None = None
        if ent and ent.device_id:
            device = dr.async_get(self.hass).async_get(ent.device_id)
            if device:
                name = device.name_by_user or device.name
            for sib in er.async_entries_for_device(ent_reg, ent.device_id):
                if sib.domain != "sensor" or sib.entity_id == moisture_entity or sib.disabled:
                    continue
                dc = str(sib.device_class or sib.original_device_class or "")
                if dc in ("temperature", "battery") and dc not in found:
                    found[dc] = sib.entity_id
        return found, name

    def _readings(self, plant: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        moisture_entity = plant.get("moisture_entity")
        if not moisture_entity:
            return {}, []
        tracked = [moisture_entity]
        out: dict[str, Any] = {}
        st = self.hass.states.get(moisture_entity)
        if st and st.state not in ("unknown", "unavailable"):
            out["moisture"] = st.state
        siblings, device_name = self._siblings(moisture_entity)
        out["sensor_name"] = device_name or (st.attributes.get("friendly_name") if st else None)
        for key, ent_id in siblings.items():
            tracked.append(ent_id)
            s = self.hass.states.get(ent_id)
            if s and s.state not in ("unknown", "unavailable"):
                out[key] = s.state
        return out, tracked

    def _area_name(self) -> str | None:
        device = find_device(self.hass, self._manager.entry.entry_id, self._subentry_id)
        if device and device.area_id:
            area = ar.async_get(self.hass).async_get_area(device.area_id)
            return area.name if area else None
        return None

    def _recompute(self) -> list[str]:
        plant = self._manager.plant(self._subentry_id)
        if plant is None:
            self._data = None
            return []
        readings, tracked = self._readings(plant)
        species = self._manager.species.get(plant.get("species") or "")
        self._data = logic.compute(
            plant, species, readings, dt_util.now().date(),
            language=self._manager.language, area=self._area_name(),
        )
        return tracked

    @callback
    def _untrack(self) -> None:
        if self._unsub_states:
            self._unsub_states()
            self._unsub_states = None

    @callback
    def _track(self) -> None:
        self._untrack()
        plant = self._manager.plant(self._subentry_id) or {}
        _, tracked = self._readings(plant)
        if tracked:
            self._unsub_states = async_track_state_change_event(self.hass, tracked, self._sensor_changed)

    @callback
    def _sensor_changed(self, _event: Any) -> None:
        self.refresh()

    @callback
    def refresh(self) -> None:
        old = self._data["attributes"].get("moisture_entity") if self._data else None
        self._recompute()
        if self._data and self._data["attributes"].get("moisture_entity") != old:
            self._track()
        if self.hass is not None and self.entity_id:
            self._sync_device_name()
            self.async_write_ha_state()

    @callback
    def _sync_device_name(self) -> None:
        """Keep the device name in step with a renamed plant (unless the user renamed the device)."""
        if not self._data:
            return
        wanted = self._data["attributes"].get("display_name")
        reg = dr.async_get(self.hass)
        device = find_device(self.hass, self._manager.entry.entry_id, self._subentry_id)
        if device and wanted and device.name != wanted:
            reg.async_update_device(device.id, name=wanted)

    # --------------------------------------------------------------- actions
    async def async_water(self, date: Any = None) -> None:
        self._manager.async_mark(self._subentry_id, "water", date)

    async def async_fertilise(self, date: Any = None) -> None:
        self._manager.async_mark(self._subentry_id, "fertilise", date)

    async def async_update_plant(self, **data: Any) -> None:
        await self._manager.async_update_plant(self._subentry_id, data)

    async def async_remove_plant(self) -> None:
        self._manager.async_remove_plant(self._subentry_id)
