"""One sensor entity per plant."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import voluptuous as vol

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
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
from .entity import device_info
from .manager import GreenFingerManager
from .schemas import UPDATE_SCHEMA

PARALLEL_UPDATES = 0

# a rise of the soil moisture by at least this many points between two readings counts as watering
WATERING_JUMP = 10.0
_UNKNOWN = ("unknown", "unavailable")


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    manager: GreenFingerManager = entry.runtime_data
    for subentry_id, subentry in entry.subentries.items():
        if subentry.subentry_type == SUBENTRY_PLANT:
            async_add_entities([GreenFingerSensor(manager, subentry_id)], config_subentry_id=subentry_id)

    platform = entity_platform.async_get_current_platform()
    date_schema = {vol.Optional("date"): cv.date}
    platform.async_register_entity_service("water", date_schema, "async_water")
    platform.async_register_entity_service("fertilise", date_schema, "async_fertilise")
    platform.async_register_entity_service(
        "postpone",
        {
            vol.Required("kind"): vol.In(["water", "feed"]),
            vol.Optional("days", default=1): vol.All(vol.Coerce(int), vol.Range(min=1, max=90)),
        },
        "async_postpone",
    )
    platform.async_register_entity_service("update_plant", UPDATE_SCHEMA, "async_update_plant")
    platform.async_register_entity_service("remove_plant", {}, "async_remove_plant")


@dataclass(frozen=True, slots=True)
class _SensorLink:
    """The soil sensor of a plant and the entities found on the same device (looked up once)."""

    moisture: str
    temperature: str | None
    battery: str | None
    device_id: str | None
    name: str | None

    @property
    def tracked(self) -> tuple[str, ...]:
        return tuple(e for e in (self.moisture, self.temperature, self.battery) if e)


class GreenFingerSensor(SensorEntity):
    """State = ok / needs_water / needs_feed / needs_both; everything else is an attribute."""

    _attr_has_entity_name = True
    _attr_name = None
    _attr_should_poll = False
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = STATES
    _attr_translation_key = "plant"
    # bulky or rarely useful attributes are kept out of the recorder database
    _unrecorded_attributes = frozenset({
        "common_names", "water_schedule", "feed_schedule", "soil_mix", "soil_notes", "species_picture",
        "picture", "notes", "ideal_moisture", "ideal_temperature", "species_alias", "fertiliser_name",
    })

    def __init__(self, manager: GreenFingerManager, subentry_id: str) -> None:
        self._manager = manager
        self._subentry_id = subentry_id
        self._attr_unique_id = subentry_id
        self._attr_device_info = device_info(manager, subentry_id)
        self._data: dict[str, Any] | None = None
        self._link: _SensorLink | None = None
        self._link_for: str | None = None  # moisture entity the cached link belongs to
        self._tracked: tuple[str, ...] = ()
        self._unsub_states: Any = None
        self._device_id: str | None = None
        self._synced_name: str | None = None
        self._last_moisture: float | None = None
        self._added = False

    # ----------------------------------------------------------- properties
    @property
    def native_value(self) -> str | None:
        return self._data["state"] if self._data else None

    @property
    def extra_state_attributes(self) -> dict[str, Any] | None:
        return self._data["attributes"] if self._data else None

    @property
    def entity_picture(self) -> str | None:
        return self._data["attributes"].get("picture") if self._data else None

    # ------------------------------------------------------------- lifecycle
    async def async_added_to_hass(self) -> None:
        manager = self._manager
        manager.entities[self._subentry_id] = self
        self.async_on_remove(lambda: manager.entities.pop(self._subentry_id, None))
        self.async_on_remove(self._untrack)
        self.async_on_remove(
            async_track_time_change(self.hass, lambda _now: self.refresh(), hour=0, minute=1, second=0)
        )
        entry = er.async_get(self.hass).async_get(self.entity_id)
        self._device_id = entry.device_id if entry else None
        self._retrack(self._recompute())
        self._added = True

    # --------------------------------------------------------------- helpers
    def _resolve_link(self, moisture_entity: str) -> _SensorLink:
        """Find temperature / battery sensors and the name of the soil sensor's device (cached)."""
        if self._link is not None and self._link_for == moisture_entity:
            return self._link
        ent_reg = er.async_get(self.hass)
        ent = ent_reg.async_get(moisture_entity)
        temperature = battery = name = device_id = None
        if ent and ent.device_id:
            device_id = ent.device_id
            device = dr.async_get(self.hass).async_get(device_id)
            if device:
                name = device.name_by_user or device.name
            for sib in er.async_entries_for_device(ent_reg, device_id):
                if sib.domain != "sensor" or sib.entity_id == moisture_entity or sib.disabled:
                    continue
                dc = str(sib.device_class or sib.original_device_class or "")
                if dc == "temperature" and temperature is None:
                    temperature = sib.entity_id
                elif dc == "battery" and battery is None:
                    battery = sib.entity_id
        if name is None:
            st = self.hass.states.get(moisture_entity)
            name = st.attributes.get("friendly_name") if st else None
        self._link = _SensorLink(moisture_entity, temperature, battery, device_id, name)
        self._link_for = moisture_entity
        return self._link

    def _area_name(self) -> str | None:
        if not self._device_id:
            return None
        device = dr.async_get(self.hass).async_get(self._device_id)
        if device and device.area_id:
            area = ar.async_get(self.hass).async_get_area(device.area_id)
            return area.name if area else None
        return None

    def _recompute(self) -> tuple[str, ...]:
        """Recalculate state and attributes; returns the entities that must be tracked."""
        plant = self._manager.plant(self._subentry_id)
        if plant is None:
            self._data = None
            return ()
        readings: dict[str, Any] = {}
        tracked: tuple[str, ...] = ()
        moisture_entity = plant.get("moisture_entity")
        if moisture_entity:
            link = self._resolve_link(moisture_entity)
            tracked = link.tracked
            states = self.hass.states
            for key, ent_id in (("moisture", link.moisture), ("temperature", link.temperature), ("battery", link.battery)):
                st = states.get(ent_id) if ent_id else None
                if st is not None and st.state not in _UNKNOWN:
                    readings[key] = st.state
            readings["sensor_name"] = link.name
            if self._last_moisture is None:
                self._last_moisture = logic.to_float(readings.get("moisture"))
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
        self._tracked = ()

    @callback
    def _retrack(self, tracked: tuple[str, ...]) -> None:
        if tracked == self._tracked:
            return
        self._untrack()
        if tracked:
            self._tracked = tracked
            self._unsub_states = async_track_state_change_event(self.hass, list(tracked), self._sensor_changed)

    @callback
    def _sensor_changed(self, event: Event) -> None:
        if self._link is not None and event.data.get("entity_id") == self._link.moisture:
            self._detect_watering(event.data.get("new_state"))
        self.refresh()

    @callback
    def _detect_watering(self, new_state: Any) -> None:
        """Record a watering when the soil suddenly gets much wetter (opt-in per plant)."""
        value = logic.to_float(new_state.state) if new_state is not None else None
        previous, self._last_moisture = self._last_moisture, value if value is not None else self._last_moisture
        if value is None or previous is None or not (self._data and self._data["attributes"].get("auto_watered")):
            return
        if value - previous >= WATERING_JUMP:
            today = dt_util.now().date().isoformat()
            if self._data["attributes"].get("last_watered") != today:
                self._manager.async_mark(self._subentry_id, "water")

    @callback
    def refresh(self) -> None:
        """Recompute and publish; called for sensor changes, plant edits, midnight and registry changes."""
        if not self._added:
            return
        self._retrack(self._recompute())
        self._sync_device_name()
        self.async_write_ha_state()

    @callback
    def registry_changed(self, entity_id: str | None = None, device_id: str | None = None) -> None:
        """A registry entry changed: refresh if it concerns this plant or its soil sensor."""
        if not self._added:
            return
        link = self._link
        if device_id is not None:
            relevant = device_id == self._device_id or (link is not None and device_id == link.device_id)
        else:
            relevant = entity_id in self._tracked or entity_id == self.entity_id
            if not relevant and link is not None and link.device_id and entity_id:
                ent = er.async_get(self.hass).async_get(entity_id)
                relevant = ent is not None and ent.device_id == link.device_id
        if relevant:
            self._link = self._link_for = None  # look the sensor links up again
            self.refresh()

    @callback
    def _sync_device_name(self) -> None:
        """Keep the device name in step with a renamed plant (unless the user renamed the device)."""
        if not self._data or not self._device_id:
            return
        wanted = self._data["attributes"].get("display_name")
        if not wanted or wanted == self._synced_name:
            return
        self._synced_name = wanted
        reg = dr.async_get(self.hass)
        device = reg.async_get(self._device_id)
        if device and device.name != wanted:
            reg.async_update_device(device.id, name=wanted)

    # --------------------------------------------------------------- actions
    async def async_water(self, date: Any = None) -> None:
        self._manager.async_mark(self._subentry_id, "water", date)

    async def async_fertilise(self, date: Any = None) -> None:
        self._manager.async_mark(self._subentry_id, "fertilise", date)

    async def async_postpone(self, kind: str, days: int = 1) -> None:
        self._manager.async_postpone(self._subentry_id, kind, days)

    async def async_update_plant(self, **data: Any) -> None:
        await self._manager.async_update_plant(self._subentry_id, data)

    async def async_remove_plant(self) -> None:
        self._manager.async_remove_plant(self._subentry_id)
