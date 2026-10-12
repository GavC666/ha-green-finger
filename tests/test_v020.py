"""Postpone, automatic watering, saved species data and the reconfigure flow."""
from __future__ import annotations

import asyncio
from datetime import timedelta
from unittest.mock import patch

import pytest
from homeassistant.config_entries import ConfigSubentryData
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.green_finger.const import DOMAIN, SUBENTRY_PLANT
from custom_components.green_finger.manager import species_is_saved
from custom_components.green_finger.openplantbook import OpenPlantbookRateLimit


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


async def test_a_failed_refresh_is_reported_and_keeps_the_saved_data(hass: HomeAssistant) -> None:
    client = _CountingClient({"pid": "ficus benjamina", "display_pid": "Ficus benjamina", "watering": "weekly"})
    manager = await _manager(hass, client)
    await manager.async_get_species("ficus benjamina")  # saved

    async def limited(pid: str) -> dict:
        raise OpenPlantbookRateLimit(42)

    client.async_detail = limited
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(
            DOMAIN, "get_species", {"species": "ficus benjamina", "refresh": True}, blocking=True, return_response=True,
        )
    assert err.value.translation_key == "rate_limited"
    assert err.value.translation_placeholders == {"seconds": "42"}
    # the saved record is still served, without any request
    result = await hass.services.async_call(
        DOMAIN, "get_species", {"species": "ficus benjamina"}, blocking=True, return_response=True,
    )
    assert result["species"]["display_pid"] == "Ficus benjamina"


async def test_a_download_updates_the_plants_of_that_species(hass: HomeAssistant) -> None:
    client = _CountingClient({"pid": "ficus benjamina", "display_pid": "Ficus benjamina", "watering": "weekly"})
    entry = _entry(
        {"a": _plant("Fig", species="ficus benjamina")}, data={"client_id": "a", "client_secret": "b"},
    )
    with patch("custom_components.green_finger.OpenPlantbookClient", lambda *a, **k: client):
        await _setup(hass, entry)
        await hass.async_block_till_done(wait_background_tasks=True)
    assert hass.states.get("sensor.fig").attributes["species_name"] == "Ficus benjamina"
    assert client.detail_calls == 1

    client.record = {"pid": "ficus benjamina", "display_pid": "Ficus benjamina 'Danielle'", "watering": "weekly"}
    await hass.services.async_call(
        DOMAIN, "get_species", {"species": "ficus benjamina", "refresh": True}, blocking=True, return_response=True,
    )
    await hass.async_block_till_done()
    assert hass.states.get("sensor.fig").attributes["species_name"] == "Ficus benjamina 'Danielle'"
    assert client.detail_calls == 2


def _summary_entity_id(hass: HomeAssistant, entry: MockConfigEntry) -> str:
    from homeassistant.helpers import entity_registry as er

    entity_id = er.async_get(hass).async_get_entity_id("sensor", DOMAIN, f"{entry.entry_id}_needing_care")
    assert entity_id is not None, "the summary sensor was not created"
    return entity_id


async def test_the_summary_sensor_names_the_plants_that_need_care(hass: HomeAssistant) -> None:
    entry = _entry({
        "a": _plant("Fig", last_watered=_day(-20)),
        "b": _plant("Cactus"),
        "c": _plant("Palm", last_fertilised=_day(-60)),
    })
    await _setup(hass, entry)
    entity_id = _summary_entity_id(hass, entry)
    state = hass.states.get(entity_id)
    assert state.state == "2"
    assert state.attributes["needing_water"] == ["Fig"]
    assert state.attributes["needing_feeding"] == ["Palm"]
    assert state.attributes["plants"] == ["Fig", "Palm"]

    await hass.services.async_call(DOMAIN, "water", {"entity_id": "sensor.fig"}, blocking=True)
    await hass.async_block_till_done()
    state = hass.states.get(entity_id)
    assert state.state == "1"
    assert state.attributes["plants"] == ["Palm"]


async def test_no_plant_attribute_is_recorded(hass: HomeAssistant) -> None:
    from custom_components.green_finger import logic
    from custom_components.green_finger.sensor import GreenFingerSensor

    assert set(logic.ATTRIBUTE_NAMES) <= set(GreenFingerSensor._unrecorded_attributes)


async def test_the_midnight_refresh_is_one_timer_for_all_plants(hass: HomeAssistant) -> None:
    entry = _entry({"a": _plant("Fig"), "b": _plant("Cactus")})
    await _setup(hass, entry)
    manager = entry.runtime_data
    with patch.object(manager, "async_refresh_all") as refresh:
        from homeassistant.util import dt as dt_util
        from pytest_homeassistant_custom_component.common import async_fire_time_changed

        now = dt_util.now()
        midnight = (now + timedelta(days=1)).replace(hour=0, minute=1, second=1, microsecond=0)
        async_fire_time_changed(hass, midnight)
        await hass.async_block_till_done()
    assert refresh.call_count == 1


async def test_the_plant_form_refuses_a_name_of_spaces(hass: HomeAssistant) -> None:
    entry = _entry({})
    await _setup(hass, entry)
    result = await hass.config_entries.subentries.async_init(
        (entry.entry_id, SUBENTRY_PLANT), context={"source": "user"},
    )
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"], {"name": "   ", "inside": True, "more": {}, "ranges": {}, "nutrition": {}},
    )
    assert result["type"] == "form"
    assert result["errors"] == {"base": "name_required"}


async def test_species_waiting_to_be_written_is_flushed_when_the_entry_unloads(
    hass: HomeAssistant, hass_storage: dict,
) -> None:
    client = _CountingClient({"pid": "ficus benjamina", "display_pid": "Ficus benjamina", "watering": "weekly"})
    entry = _entry({}, data={"client_id": "a", "client_secret": "b"})
    with patch("custom_components.green_finger.OpenPlantbookClient", lambda *a, **k: client):
        await _setup(hass, entry)
        manager = entry.runtime_data
        await manager.async_get_species("ficus benjamina")
        assert "green_finger.species" not in hass_storage  # still waiting: it is written after a second
        assert await hass.config_entries.async_unload(entry.entry_id)
    assert "ficus benjamina" in hass_storage["green_finger.species"]["data"]
    assert manager._dirty is False
