"""Integration tests: setup, entities, services and the config / subentry flows."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import ConfigEntryState, ConfigSubentryData
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.green_finger.const import DOMAIN, SUBENTRY_PLANT

PLANT = {
    "name": "Weeping Fig",
    "species": "ficus benjamina",
    "inside": True,
    "last_watered": "2026-10-01",
    "last_fertilised": "2026-10-01",
    "water": [[1, 1, 12, 31, 7]],
    "feed": [[3, 1, 11, 30, 15]],
    "npk": [10, 10, 10],
    "soil_mix": [{"name": "perlite", "percent": 30}],
    "location": "Hallway",
}


def _entry(plants: dict[str, dict] | None = None) -> MockConfigEntry:
    plants = plants if plants is not None else {"fig1": PLANT}
    return MockConfigEntry(
        domain=DOMAIN,
        data={},
        subentries_data=[
            ConfigSubentryData(data=data, subentry_type=SUBENTRY_PLANT, title=data["name"], unique_id=None, subentry_id=sid)
            for sid, data in plants.items()
        ],
    )


async def _setup(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()


async def test_plant_entity_and_attributes(hass: HomeAssistant) -> None:
    await _setup(hass, _entry())
    state = hass.states.get("sensor.weeping_fig")
    assert state is not None
    assert state.state in ("ok", "needs_water", "needs_feed", "needs_both")
    attrs = state.attributes
    assert attrs["green_finger"] is True
    assert attrs["fertiliser_npk_label"] == "10-10-10"
    assert attrs["soil_mix"] == [{"name": "perlite", "percent": 30}]
    assert attrs["location"] == "Hallway"
    assert hass.states.get("button.weeping_fig_water") is not None


async def test_water_service_updates_last_watered(hass: HomeAssistant) -> None:
    entry = _entry()
    await _setup(hass, entry)
    await hass.services.async_call(
        DOMAIN, "water", {"entity_id": "sensor.weeping_fig", "date": "2026-10-10"}, blocking=True,
    )
    await hass.async_block_till_done()
    assert hass.states.get("sensor.weeping_fig").attributes["last_watered"] == "2026-10-10"
    assert entry.subentries["fig1"].data["last_watered"] == "2026-10-10"


async def test_add_and_remove_plant_services(hass: HomeAssistant) -> None:
    entry = _entry({})
    await _setup(hass, entry)
    resp = await hass.services.async_call(
        DOMAIN, "add_plant",
        {"name": "Cactus", "water": "1 Mar - 30 Nov: every 14 days\n1 Dec - 29 Feb: rest", "npk": [5, 10, 10]},
        blocking=True, return_response=True,
    )
    await hass.async_block_till_done()
    assert resp["plant_id"] in entry.subentries
    state = hass.states.get("sensor.cactus")
    assert state is not None
    assert state.attributes["water_schedule"] == [[3, 1, 11, 30, 14], [12, 1, 2, 29, 0]]

    await hass.services.async_call(DOMAIN, "remove_plant", {"entity_id": "sensor.cactus"}, blocking=True)
    await hass.async_block_till_done()
    assert resp["plant_id"] not in entry.subentries
    assert er.async_get(hass).async_get("sensor.cactus") is None


async def test_search_requires_credentials(hass: HomeAssistant) -> None:
    await _setup(hass, _entry())
    from homeassistant.exceptions import ServiceValidationError
    import pytest

    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "search_species", {"query": "ficus"}, blocking=True, return_response=True)


async def test_config_flow_without_credentials(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert result["type"] == "form"
    result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
    assert result["type"] == "create_entry"
    assert result["data"] == {"client_id": "", "client_secret": ""}


async def test_config_flow_rejects_bad_credentials(hass: HomeAssistant) -> None:
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    with patch(
        "custom_components.green_finger.config_flow._validate_credentials", AsyncMock(return_value="invalid_auth"),
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"client_id": "abc", "client_secret": "def"},
        )
    assert result["type"] == "form"
    assert result["errors"] == {"base": "invalid_auth"}


async def test_plant_subentry_flow_manual(hass: HomeAssistant) -> None:
    entry = _entry({})
    await _setup(hass, entry)
    result = await hass.config_entries.subentries.async_init((entry.entry_id, SUBENTRY_PLANT), context={"source": "user"})
    assert result["step_id"] == "plant"  # no credentials: straight to the details
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"],
        {
            "name": "Aloe", "inside": True, "last_watered": "2026-10-01", "last_fertilised": "2026-10-01",
            "sensor": {}, "nutrition": {"npk_n": 5, "npk_p": 5, "npk_k": 5, "soil_mix": "50% sand\n50% peat"},
        },
    )
    assert result["step_id"] == "schedule"
    result = await hass.config_entries.subentries.async_configure(
        result["flow_id"],
        {"water_schedule": "1 Mar - 30 Nov: every 14 days", "feed_schedule": ""},
    )
    assert result["type"] == "create_entry"
    await hass.async_block_till_done()
    sub = next(s for s in entry.subentries.values() if s.title == "Aloe")
    assert sub.data["npk"] == [5.0, 5.0, 5.0]
    assert sub.data["soil_mix"] == [{"name": "sand", "percent": 50}, {"name": "peat", "percent": 50}]
    assert hass.states.get("sensor.aloe") is not None



class FakeClient:
    """Stands in for the OpenPlantbook client."""

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def async_validate(self) -> None:
        return None

    async def async_search(self, text: str) -> list[dict]:
        return [{"pid": "ficus benjamina", "display_pid": "Ficus benjamina", "alias": "weeping fig"}]

    async def async_detail(self, pid: str) -> dict:
        return {
            "pid": pid, "display_pid": "Ficus benjamina", "alias": "weeping fig",
            "image_url": "https://img.test/fig.jpg", "watering": "Water weekly.",
            "fertilization": "Feed monthly with a 10-10-10 fertiliser.",
            "min_soil_moist": 20, "max_soil_moist": 60, "min_temp": 8, "max_temp": 32,
            "common_names": [{"name": "Weeping Fig", "language_code": "en"}],
        }


async def test_missing_species_data_is_downloaded_on_setup(hass: HomeAssistant) -> None:
    entry = _entry()
    entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(entry, data={"client_id": "a", "client_secret": "b"})
    with patch("custom_components.green_finger.OpenPlantbookClient", FakeClient):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    attrs = hass.states.get("sensor.weeping_fig").attributes
    assert attrs["picture"] == "https://img.test/fig.jpg"
    assert attrs["species_name"] == "Ficus benjamina"
    assert attrs["common_names"] == ["Weeping Fig"]


async def test_plant_subentry_flow_with_species_search(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={"client_id": "a", "client_secret": "b"})
    with patch("custom_components.green_finger.OpenPlantbookClient", FakeClient):
        await _setup(hass, entry)
        result = await hass.config_entries.subentries.async_init(
            (entry.entry_id, SUBENTRY_PLANT), context={"source": "user"},
        )
        assert result["step_id"] == "user"
        result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"query": "ficus"})
        assert result["step_id"] == "pick"
        result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"species": "ficus benjamina"})
        assert result["step_id"] == "plant"
        result = await hass.config_entries.subentries.async_configure(
            result["flow_id"],
            {"name": "Hallway Fig", "inside": True, "sensor": {}, "nutrition": {}},
        )
        assert result["step_id"] == "schedule"
        result = await hass.config_entries.subentries.async_configure(
            result["flow_id"], {"water_schedule": "1 Jan - 31 Dec: every 7 days", "feed_schedule": ""},
        )
        assert result["type"] == "create_entry"
        await hass.async_block_till_done()
    sub = next(s for s in entry.subentries.values() if s.title == "Hallway Fig")
    assert sub.data["species"] == "ficus benjamina"
    assert sub.data["water"] == [[1, 1, 12, 31, 7]]
    attrs = hass.states.get("sensor.hallway_fig").attributes
    assert attrs["picture"] == "https://img.test/fig.jpg"
    assert attrs["fertiliser_npk"] == [10.0, 10.0, 10.0]


async def test_reconfigure_credentials_reloads_entry(hass: HomeAssistant) -> None:
    entry = _entry()
    await _setup(hass, entry)
    result = await entry.start_reconfigure_flow(hass)
    assert result["step_id"] == "reconfigure"
    with (
        patch("custom_components.green_finger.config_flow._validate_credentials", AsyncMock(return_value=None)),
        patch("custom_components.green_finger.OpenPlantbookClient", FakeClient),
    ):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"client_id": "abc", "client_secret": "def"},
        )
        assert result["type"] == "abort"
        assert result["reason"] == "reconfigure_successful"
        await hass.async_block_till_done()
    assert entry.data == {"client_id": "abc", "client_secret": "def"}
    assert entry.state is ConfigEntryState.LOADED
    assert hass.states.get("sensor.weeping_fig") is not None


async def test_card_is_registered_as_lovelace_resource(hass: HomeAssistant) -> None:
    await _setup(hass, _entry())
    resources = hass.data["lovelace"].resources
    urls = [item["url"] for item in resources.async_items()]
    assert any(u.startswith("/green_finger/green-finger-card.js") for u in urls)
