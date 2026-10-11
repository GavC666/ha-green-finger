"""Species search: one request per search, common-name fallback, readable errors."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ServiceValidationError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.green_finger.const import DOMAIN
from custom_components.green_finger.openplantbook import OpenPlantbookRateLimit


def _hit(pid: str, display: str | None = None) -> dict:
    return {"pid": pid, "display_pid": display or pid.title(), "alias": pid}


class FakeClient:
    """Counts the requests the integration makes."""

    def __init__(self, hits: dict) -> None:
        self.hits = hits
        self.search_calls: list[str] = []
        self.detail_calls: list[str] = []

    async def async_validate(self) -> None:
        return None

    async def async_search(self, text: str) -> list[dict]:
        self.search_calls.append(text.lower())
        result = self.hits.get(text.lower(), [])
        if isinstance(result, Exception):
            raise result
        return result

    async def async_detail(self, pid: str) -> dict:
        self.detail_calls.append(pid)
        return {"pid": pid, "display_pid": pid.title(), "watering": "Water weekly."}


async def _setup(hass: HomeAssistant, fake: FakeClient) -> None:
    entry = MockConfigEntry(domain=DOMAIN, data={"client_id": "a", "client_secret": "b"})
    entry.add_to_hass(hass)
    with patch("custom_components.green_finger.OpenPlantbookClient", lambda *a, **k: fake):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()


async def _search(hass: HomeAssistant, query: str) -> dict:
    return await hass.services.async_call(
        DOMAIN, "search_species", {"query": query}, blocking=True, return_response=True,
    )


async def test_search_makes_one_request_and_no_detail_requests(hass: HomeAssistant) -> None:
    fake = FakeClient({"ficus": [_hit("ficus benjamina"), _hit("ficus elastica")]})
    await _setup(hass, fake)
    result = await _search(hass, "ficus")
    assert [r["pid"] for r in result["results"]] == ["ficus benjamina", "ficus elastica"]
    assert result["note"] is None
    assert fake.search_calls == ["ficus"]
    assert fake.detail_calls == []


async def test_same_search_is_served_from_the_cache(hass: HomeAssistant) -> None:
    fake = FakeClient({"ficus": [_hit("ficus benjamina")]})
    await _setup(hass, fake)
    await _search(hass, "ficus")
    await _search(hass, "Ficus")
    assert fake.search_calls == ["ficus"]


async def test_common_name_falls_back_to_gbif_genera(hass: HomeAssistant) -> None:
    fake = FakeClient({
        "tagetes": [_hit("tagetes patula")],
        "calendula": [_hit("calendula officinalis")],
    })
    await _setup(hass, fake)
    with patch(
        "custom_components.green_finger.manager.async_common_name_genera",
        AsyncMock(return_value=["Tagetes", "Calendula"]),
    ):
        result = await _search(hass, "marigold")
    assert [(r["pid"], r["via"]) for r in result["results"]] == [
        ("tagetes patula", "Tagetes"), ("calendula officinalis", "Calendula"),
    ]
    assert "marigold" in result["note"] and "GBIF" in result["note"]
    assert fake.search_calls == ["marigold", "tagetes", "calendula"]
    assert fake.detail_calls == []


async def test_no_match_anywhere(hass: HomeAssistant) -> None:
    fake = FakeClient({})
    await _setup(hass, fake)
    with patch("custom_components.green_finger.manager.async_common_name_genera", AsyncMock(return_value=[])):
        result = await _search(hass, "zzzzzz")
    assert result == {"results": [], "note": None}


async def test_rate_limit_gives_a_readable_error(hass: HomeAssistant) -> None:
    fake = FakeClient({"ficus": OpenPlantbookRateLimit(42)})
    await _setup(hass, fake)
    with pytest.raises(ServiceValidationError) as err:
        await _search(hass, "ficus")
    assert err.value.translation_key == "rate_limited"
    assert err.value.translation_placeholders == {"seconds": "42"}
