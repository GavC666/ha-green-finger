"""The Green Finger: one entity per plant with schedules, sensors and care tips."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import Event, HomeAssistant, ServiceCall, SupportsResponse, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.event import async_track_time_change
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import CONF_CLIENT_ID, CONF_CLIENT_SECRET, DOMAIN, FRONTEND_URL
from .manager import GreenFingerManager
from .openplantbook import (
    OpenPlantbookAuthError,
    OpenPlantbookClient,
    OpenPlantbookConnectionError,
    OpenPlantbookError,
    OpenPlantbookRateLimit,
)
from .schemas import UPDATE_SCHEMA

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR, Platform.BUTTON]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type GreenFingerConfigEntry = ConfigEntry[GreenFingerManager]


def _manager(hass: HomeAssistant) -> GreenFingerManager:
    for entry in hass.config_entries.async_entries(DOMAIN):
        if getattr(entry, "runtime_data", None) is not None:
            return entry.runtime_data
    raise ServiceValidationError(translation_domain=DOMAIN, translation_key="not_loaded")


def _lookup_error(err: OpenPlantbookError) -> ServiceValidationError:
    """The readable service error for a failed OpenPlantbook request."""
    if isinstance(err, OpenPlantbookRateLimit):
        return ServiceValidationError(
            translation_domain=DOMAIN, translation_key="rate_limited",
            translation_placeholders={"seconds": str(err.retry_after)},
        )
    if isinstance(err, OpenPlantbookAuthError):
        return ServiceValidationError(translation_domain=DOMAIN, translation_key="invalid_auth")
    if isinstance(err, OpenPlantbookConnectionError):
        return ServiceValidationError(translation_domain=DOMAIN, translation_key="cannot_connect")
    return ServiceValidationError(
        translation_domain=DOMAIN, translation_key="lookup_failed",
        translation_placeholders={"error": str(err) or type(err).__name__},
    )


async def _async_register_resource(hass: HomeAssistant, url: str) -> bool:
    """Register the card as a Lovelace resource (storage mode), kept at the current version.

    Returns False when the resources cannot be managed (YAML mode) so the caller can fall back.
    """
    resources = getattr(hass.data.get("lovelace"), "resources", None)
    if resources is None or not hasattr(resources, "async_create_item"):
        return False
    try:
        if not getattr(resources, "loaded", True):
            await resources.async_load()
            resources.loaded = True
        for item in resources.async_items():
            if str(item.get("url", "")).split("?")[0] == FRONTEND_URL:
                if item["url"] != url:
                    await resources.async_update_item(item["id"], {"res_type": "module", "url": url})
                return True
        await resources.async_create_item({"res_type": "module", "url": url})
    except Exception:  # noqa: BLE001 - never block setup because of a dashboard resource
        _LOGGER.debug("Could not register the Lovelace resource for the card", exc_info=True)
        return False
    return True


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register the card and the integration-level services."""
    integration = await async_get_integration(hass, DOMAIN)
    card = Path(__file__).parent / "frontend" / "green-finger-card.js"
    if card.exists():
        await hass.http.async_register_static_paths([StaticPathConfig(FRONTEND_URL, str(card), False)])
        url = f"{FRONTEND_URL}?v={integration.version}"
        # one loading route: the dashboard resource; fall back to a global module only when
        # the resources are managed in YAML and cannot be edited from here
        if not await _async_register_resource(hass, url):
            add_extra_js_url(hass, url)

    async def search_species(call: ServiceCall) -> dict[str, Any]:
        try:
            return await _manager(hass).async_search(call.data["query"])
        except OpenPlantbookError as err:
            raise _lookup_error(err) from err

    async def get_species(call: ServiceCall) -> dict[str, Any]:
        manager = _manager(hass)
        try:
            sp = await manager.async_get_species(
                call.data["species"], bool(call.data.get("refresh")), raise_errors=True,
            )
        except OpenPlantbookError as err:
            raise _lookup_error(err) from err
        return {"species": sp, "suggestion": manager.suggest(sp)}

    async def add_plant(call: ServiceCall) -> dict[str, Any]:
        return {"plant_id": await _manager(hass).async_add_plant(dict(call.data))}

    async def refresh_species(call: ServiceCall) -> None:
        try:
            await _manager(hass).async_refresh_species(call.data.get("plant_id"))
        except OpenPlantbookError as err:
            raise _lookup_error(err) from err

    hass.services.async_register(
        DOMAIN, "search_species", search_species,
        vol.Schema({vol.Required("query"): cv.string}), supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, "get_species", get_species,
        vol.Schema({vol.Required("species"): cv.string, vol.Optional("refresh", default=False): cv.boolean}),
        supports_response=SupportsResponse.ONLY,
    )
    hass.services.async_register(
        DOMAIN, "add_plant", add_plant,
        vol.Schema({vol.Required("name"): cv.string, **UPDATE_SCHEMA}, extra=vol.REMOVE_EXTRA),
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register(
        DOMAIN, "refresh_species", refresh_species,
        vol.Schema({vol.Optional("plant_id"): cv.string}),
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: GreenFingerConfigEntry) -> bool:
    client = None
    client_id = entry.data.get(CONF_CLIENT_ID)
    client_secret = entry.data.get(CONF_CLIENT_SECRET)
    if client_id and client_secret:
        client = OpenPlantbookClient(async_get_clientsession(hass), client_id, client_secret)

    manager = GreenFingerManager(hass, entry, client)
    await manager.async_load()
    manager.known_subentries = set(entry.subentries)
    manager.known_data = dict(entry.data)
    manager.async_refresh_changed()  # take the first snapshot
    entry.runtime_data = manager

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    @callback
    def _entity_registry_updated(event: Event) -> None:
        entity_id = event.data.get("entity_id")
        for ent in list(manager.entities.values()):
            ent.registry_changed(entity_id=entity_id)

    @callback
    def _device_registry_updated(event: Event) -> None:
        device_id = event.data.get("device_id")
        for ent in list(manager.entities.values()):
            ent.registry_changed(device_id=device_id)

    entry.async_on_unload(hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, _entity_registry_updated))
    entry.async_on_unload(hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, _device_registry_updated))
    # the days left change at midnight: one timer for every plant
    entry.async_on_unload(
        async_track_time_change(hass, lambda _now: manager.async_refresh_all(), hour=0, minute=1, second=0)
    )
    if client is not None:
        entry.async_create_background_task(hass, manager.async_fill_missing_species(), "green_finger_species")
    return True


async def _async_update_listener(hass: HomeAssistant, entry: GreenFingerConfigEntry) -> None:
    """Reload when plants are added/removed or the credentials change; otherwise recompute."""
    manager = entry.runtime_data
    if set(entry.subentries) != manager.known_subentries or dict(entry.data) != manager.known_data:
        hass.config_entries.async_schedule_reload(entry.entry_id)
        return
    manager.async_refresh_changed()


async def async_unload_entry(hass: HomeAssistant, entry: GreenFingerConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.async_flush()  # species downloaded a moment ago must survive the reload
    return unloaded
