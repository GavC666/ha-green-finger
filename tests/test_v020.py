"""Postpone, automatic watering, saved species data and the reconfigure flow."""
from __future__ import annotations

import asyncio
from datetime import timedelta
from unittest.mock import patch

from homeassistant.config_entries import ConfigSubentryData
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.green_finger.const import DOMAIN, SUBENTRY_PLANT
from custom_components.green_finger.manager import species_is_saved


def _day(offset: int = 0) -> str:
    return (dt_util.now().date() + timedelta(days=offset)).isoformat()


def _plant(name: str, **extra) -> dict:
    data = {
        "name": name, "inside": True, "last_watered": _day(-3), "last_fertilised": _day(-3),
        "water": [[1, 1, 12, 31, 7]], "feed": [[1, 1, 12, 31, 30]],
    }
    data.update(extra)
    return data


def _entry(plants: dict[str, dict], **kwargs) -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        data=kwargs.get("data", {}),
        subentries_data=[
            ConfigSubentryData(data=d, subentry_type=SUBENTRY_PLANT, title=d["name"], unique_id=None, subentry_id=sid)
            for sid, d in plants.items()
        ],
    )


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_postpone_adds_days_until_the_next_watering(hass: HomeAssistant) -> None:
    entry = _entry({"a": _plant("Fig")})
    await _setup(hass, entry)
    assert hass.states.get("sensor.fig").attributes["water_days_left"] == 4

    await hass.services.async_call(
        DOMAIN, "postpone", {"entity_id": "sensor.fig", "kind": "water", "days": 3}, blocking=True,
    )
    await hass.async_block_till_done()
    attrs = hass.states.get("sensor.fig").attributes
    assert attrs["water_days_left"] == 7
    assert attrs["water_postponed_days"] == 3
    assert attrs["feed_postponed_days"] == 0

    await hass.services.async_call(DOMAIN, "water", {"entity_id": "sensor.fig"}, blocking=True)
    await hass.async_block_till_done()
    attrs = hass.states.get("sensor.fig").attributes
    assert attrs["water_postponed_days"] == 0
    assert attrs["water_days_left"] == 7  # a fresh watering: the whole interval again


async def test_auto_watered_marks_the_plant_when_the_soil_gets_much_wetter(hass: HomeAssistant) -> None:
    hass.states.async_set("sensor.soil_1", "20", {"device_class": "moisture"})
    hass.states.async_set("sensor.soil_2", "20", {"device_class": "moisture"})
    entry = _entry({
        "a": _plant("Fig", moisture_entity="sensor.soil_1", auto_watered=True),
        "b": _plant("Cactus", moisture_entity="sensor.soil_2"),  # not opted in
    })
    await _setup(hass, entry)

    hass.states.async_set("sensor.soil_1", "24", {"device_class": "moisture"})  # small change: ignored
    hass.states.async_set("sensor.soil_2", "50", {"device_class": "moisture"})
    await hass.async_block_till_done()
    assert entry.subentries["a"].data["last_watered"] == _day(-3)
    assert entry.subentries["b"].data["last_watered"] == _day(-3)

    hass.states.async_set("sensor.soil_1", "45", {"device_class": "moisture"})  # +21 points
    await hass.async_block_till_done()
    assert entry.subentries["a"].data["last_watered"] == _day(0)
    assert entry.subentries["b"].data["last_watered"] == _day(-3)


def test_species_is_saved_rules() -> None:
    assert not species_is_saved(None)
    assert not species_is_saved({"pid": "x"})  # nothing downloaded
    assert species_is_saved({"pid": "x", "watering": "weekly"})
    assert species_is_saved({"pid": "x", "fetched_at": "2026-10-12"})  # downloaded, simply has no care text


class _CountingClient:
    def __init__(self, record: dict | None, delay: float = 0.0) -> None:
        self.record = record
        self.delay = delay
        self.detail_calls = 0

    async def async_validate(self) -> None:
        return None

    async def async_search(self, text: str) -> list[dict]:
        return []

    async def async_detail(self, pid: str) -> dict | None:
        self.detail_calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        return self.record


async def _manager(hass: HomeAssistant, client: _CountingClient):
    entry = _entry({}, data={"client_id": "a", "client_secret": "b"})
    with patch("custom_components.green_finger.OpenPlantbookClient", lambda *a, **k: client):
        await _setup(hass, entry)
    return entry.runtime_data


async def test_species_is_downloaded_once_and_concurrent_requests_are_shared(hass: HomeAssistant) -> None:
    client = _CountingClient({"pid": "ficus benjamina", "display_pid": "Ficus benjamina", "watering": None}, delay=0.05)
    manager = await _manager(hass, client)
    first, second = await asyncio.gather(
        manager.async_get_species("ficus benjamina"), manager.async_get_species("ficus benjamina"),
    )
    assert first is second
    assert client.detail_calls == 1
    await manager.async_get_species("ficus benjamina")  # saved (has fetched_at) although it has no care text
    assert client.detail_calls == 1
    await manager.async_get_species("ficus benjamina", refresh=True)  # only on request
    assert client.detail_calls == 2


async def test_unknown_species_is_not_asked_for_again(hass: HomeAssistant) -> None:
    client = _CountingClient(None)
    manager = await _manager(hass, client)
    assert await manager.async_get_species("not a plant") is None
    assert await manager.async_get_species("not a plant") is None
    assert client.detail_calls == 1


async def test_reconfigure_keeps_a_postponed_watering(hass: HomeAssistant) -> None:
    entry = _entry({"a": _plant("Fig", postpone_water=3)})
    await _setup(hass, entry)
    result = await hass.config_entries.subentries.async_init(
        (entry.entry_id, SUBENTRY_PLANT), context={"source": "reconfigure", "subentry_id": "a"},
    )
    assert result["step_id"] == "plant"
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"],
        {
            "name": "Fig", "inside": True, "auto_watered": True,
            "more": {"location": "Hall"}, "ranges": {}, "nutrition": {},
        },
    )
    assert result["step_id"] == "schedule"
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"], {"water_schedule": "1 Jan - 31 Dec: every 7 days", "feed_schedule": ""},
    )
    assert result["type"] == "abort"
    await hass.async_block_till_done()
    data = entry.subentries["a"].data
    assert data["postpone_water"] == 3
    assert data["auto_watered"] is True
    assert data["location"] == "Hall"
