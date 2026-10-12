"""A soil sensor can belong to one plant only."""
from __future__ import annotations

import pytest
from homeassistant.config_entries import ConfigSubentryData
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.green_finger.const import DOMAIN, SUBENTRY_PLANT


def _plant(name: str, sensor: str | None = None) -> dict:
    data = {"name": name, "inside": True, "last_watered": "2026-10-01", "last_fertilised": "2026-10-01",
            "water": [[1, 1, 12, 31, 7]], "feed": []}
    if sensor:
        data["moisture_entity"] = sensor
    return data


def _entry(plants: dict[str, dict]) -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        data={},
        subentries_data=[
            ConfigSubentryData(data=d, subentry_type=SUBENTRY_PLANT, title=d["name"], unique_id=None, subentry_id=sid)
            for sid, d in plants.items()
        ],
    )


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_add_plant_rejects_a_sensor_in_use(hass: HomeAssistant) -> None:
    await _setup(hass, _entry({"a": _plant("Fig", "sensor.soil_1")}))
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "add_plant", {"name": "Cactus", "moisture_entity": "sensor.soil_1"}, blocking=True,
        )
    # a different sensor is fine
    await hass.services.async_call(
        DOMAIN, "add_plant", {"name": "Cactus", "moisture_entity": "sensor.soil_2"}, blocking=True,
    )


async def test_update_plant_rejects_a_sensor_in_use_but_keeps_its_own(hass: HomeAssistant) -> None:
    entry = _entry({"a": _plant("Fig", "sensor.soil_1"), "b": _plant("Cactus", "sensor.soil_2")})
    await _setup(hass, entry)
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(
            DOMAIN, "update_plant", {"entity_id": "sensor.cactus", "moisture_entity": "sensor.soil_1"}, blocking=True,
        )
    # re-saving the plant with its own sensor is allowed
    await hass.services.async_call(
        DOMAIN, "update_plant", {"entity_id": "sensor.cactus", "moisture_entity": "sensor.soil_2", "notes": "x"},
        blocking=True,
    )
    await hass.async_block_till_done()
    assert entry.subentries["b"].data["notes"] == "x"


async def test_subentry_form_reports_a_sensor_in_use(hass: HomeAssistant) -> None:
    entry = _entry({"a": _plant("Fig", "sensor.soil_1")})
    await _setup(hass, entry)
    result = await hass.config_entries.subentries.async_init((entry.entry_id, SUBENTRY_PLANT), context={"source": "user"})
    assert result["step_id"] == "plant"
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"],
        {"name": "Cactus", "inside": True, "moisture_entity": "sensor.soil_1", "more": {}, "ranges": {}, "nutrition": {}},
    )
    assert result["type"] == "form"
    assert result["step_id"] == "plant"
    assert result["errors"] == {"base": "sensor_in_use"}
    assert result["description_placeholders"]["plant"] == "Fig"
