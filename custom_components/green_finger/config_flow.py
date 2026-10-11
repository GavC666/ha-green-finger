"""Config flow: OpenPlantbook credentials (optional) and the plant subentry flow."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryFlow,
    SubentryFlowResult,
)
from homeassistant.core import callback
from homeassistant.data_entry_flow import section
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import selector
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import logic
from .const import CONF_CLIENT_ID, CONF_CLIENT_SECRET, DOMAIN, SUBENTRY_PLANT
from .entity import find_device
from .manager import GreenFingerManager, clean_plant_data
from .openplantbook import (
    OpenPlantbookAuthError,
    OpenPlantbookClient,
    OpenPlantbookConnectionError,
    OpenPlantbookError,
    OpenPlantbookRateLimit,
)

_LOGGER = logging.getLogger(__name__)
NONE_OF_THESE = "__none__"

_TEXT = selector.TextSelector()
_MULTILINE = selector.TextSelector(selector.TextSelectorConfig(multiline=True))


def _percent(unit: str = "%") -> selector.NumberSelector:
    config: dict[str, Any] = {"min": 0, "max": 100, "step": 1, "mode": selector.NumberSelectorMode.BOX}
    if unit:
        config["unit_of_measurement"] = unit
    return selector.NumberSelector(selector.NumberSelectorConfig(**config))


def _suggest(key: str, value: Any, required: bool = False) -> vol.Marker:
    cls = vol.Required if required else vol.Optional
    if value in (None, "", []):
        return cls(key)
    return cls(key, description={"suggested_value": value})


async def _validate_credentials(hass, client_id: str, client_secret: str) -> str | None:
    client = OpenPlantbookClient(async_get_clientsession(hass), client_id, client_secret)
    try:
        await client.async_validate()
    except OpenPlantbookAuthError:
        return "invalid_auth"
    except OpenPlantbookRateLimit:
        return "rate_limited"
    except OpenPlantbookConnectionError:
        return "cannot_connect"
    except OpenPlantbookError:
        return "cannot_connect"
    return None


class GreenFingerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up The Green Finger (one instance)."""

    VERSION = 1

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        return {SUBENTRY_PLANT: PlantSubentryFlow}

    async def _credentials_step(
        self, step_id: str, user_input: dict[str, Any] | None, defaults: dict[str, Any]
    ) -> tuple[dict[str, Any] | None, ConfigFlowResult | None]:
        errors: dict[str, str] = {}
        if user_input is not None:
            cid = (user_input.get(CONF_CLIENT_ID) or "").strip()
            sec = (user_input.get(CONF_CLIENT_SECRET) or "").strip()
            if bool(cid) != bool(sec):
                errors["base"] = "both_required"
            elif cid:
                err = await _validate_credentials(self.hass, cid, sec)
                if err:
                    errors["base"] = err
            if not errors:
                return {CONF_CLIENT_ID: cid, CONF_CLIENT_SECRET: sec}, None
        schema = vol.Schema({
            _suggest(CONF_CLIENT_ID, (user_input or defaults).get(CONF_CLIENT_ID)): _TEXT,
            vol.Optional(CONF_CLIENT_SECRET): selector.TextSelector(
                selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
        })
        return None, self.async_show_form(
            step_id=step_id, data_schema=schema, errors=errors,
            description_placeholders={"url": "https://open.plantbook.io"},
        )

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        data, form = await self._credentials_step("user", user_input, {})
        if data is None:
            return form  # type: ignore[return-value]
        return self.async_create_entry(title="The Green Finger", data=data)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._get_reconfigure_entry()
        data, form = await self._credentials_step("reconfigure", user_input, dict(entry.data))
        if data is None:
            return form  # type: ignore[return-value]
        return self.async_update_reload_and_abort(entry, data_updates=data)


class PlantSubentryFlow(ConfigSubentryFlow):
    """Add or edit one plant."""

    def __init__(self) -> None:
        self._values: dict[str, Any] = {}
        self._results: list[dict[str, Any]] = []
        self._species: dict[str, Any] | None = None
        self._suggestion: dict[str, Any] = {}
        self._reconfigure = False

    @property
    def manager(self) -> GreenFingerManager:
        return self._get_entry().runtime_data

    # ---------------------------------------------------------------- add
    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        mgr = self.manager
        if mgr.client is None:
            self._values = mgr.default_plant()
            return await self.async_step_plant()
        errors: dict[str, str] = {}
        if user_input is not None:
            query = (user_input.get("query") or "").strip()
            if not query:
                self._values = mgr.default_plant()
                return await self.async_step_plant()
            try:
                self._results = await mgr.async_search(query)
            except OpenPlantbookAuthError:
                errors["base"] = "invalid_auth"
            except OpenPlantbookRateLimit:
                errors["base"] = "rate_limited"
            except (OpenPlantbookError, ServiceValidationError):
                errors["base"] = "cannot_connect"
            else:
                if self._results:
                    return await self.async_step_pick()
                errors["base"] = "no_results"
        return self.async_show_form(
            step_id="user", data_schema=vol.Schema({vol.Optional("query"): _TEXT}), errors=errors,
        )

    async def async_step_pick(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        mgr = self.manager
        if user_input is not None:
            pid = user_input["species"]
            self._values = mgr.default_plant()
            if pid != NONE_OF_THESE:
                sp = await mgr.async_get_species(pid)
                sug = mgr.suggest(sp)
                self._species, self._suggestion = sp, sug
                self._values.update({
                    "species": (sp or {}).get("pid") or pid,
                    "name": sug["name"],
                    "water": sug["water"] or self._values["water"],
                    "feed": sug["feed"] or self._values["feed"],
                    "moisture_range": sug["moisture_range"],
                    "temperature_range": sug["temperature_range"],
                    "npk": sug["npk"],
                })
            return await self.async_step_plant()
        options = []
        for r in self._results:
            label = r["display"]
            if r.get("common_names"):
                label += f" ({', '.join(r['common_names'][:2])})"
            options.append(selector.SelectOptionDict(value=r["pid"], label=label))
        options.append(selector.SelectOptionDict(value=NONE_OF_THESE, label="None of these - enter the details myself"))
        schema = vol.Schema({vol.Required("species"): selector.SelectSelector(
            selector.SelectSelectorConfig(options=options, mode=selector.SelectSelectorMode.LIST))})
        return self.async_show_form(step_id="pick", data_schema=schema)

    # ------------------------------------------------------------ reconfigure
    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        sub = self._get_reconfigure_subentry()
        self._reconfigure = True
        self._values = {**self.manager.default_plant(), **dict(sub.data)}
        device = find_device(self.hass, self._get_entry().entry_id, sub.subentry_id)
        if device and device.area_id:
            self._values["area"] = device.area_id
        self._species = self.manager.species.get(self._values.get("species") or "")
        self._suggestion = self.manager.suggest(self._species) if self._species else {}
        return await self.async_step_plant()

    # --------------------------------------------------------------- details
    def _plant_schema(self) -> vol.Schema:
        v = self._values
        names = self._suggestion.get("common_names") or logic.english_names(self._species, self.manager.language)
        common = (
            selector.SelectSelector(selector.SelectSelectorConfig(
                options=names, custom_value=True, mode=selector.SelectSelectorMode.DROPDOWN))
            if names else _TEXT
        )
        mr = v.get("moisture_range") or [None, None]
        tr = v.get("temperature_range") or [None, None]
        npk = v.get("npk") or [None, None, None]
        sensor = vol.Schema({
            _suggest("moisture_entity", v.get("moisture_entity")): selector.EntitySelector(
                selector.EntitySelectorConfig(domain="sensor", device_class="moisture")),
            _suggest("moisture_min", mr[0]): _percent("%"),
            _suggest("moisture_max", mr[1]): _percent("%"),
            _suggest("temperature_min", tr[0]): _percent("°C"),
            _suggest("temperature_max", tr[1]): _percent("°C"),
        })
        nutrition = vol.Schema({
            _suggest("npk_n", npk[0]): _percent(""),
            _suggest("npk_p", npk[1]): _percent(""),
            _suggest("npk_k", npk[2]): _percent(""),
            _suggest("fertiliser_name", v.get("fertiliser_name")): _TEXT,
            _suggest("soil_mix", logic.format_soil_mix(v.get("soil_mix"))): _MULTILINE,
            _suggest("soil_notes", v.get("soil_notes")): _TEXT,
        })
        return vol.Schema({
            _suggest("name", v.get("name"), required=True): _TEXT,
            _suggest("common_name", v.get("common_name")): common,
            _suggest("species", v.get("species")): _TEXT,
            vol.Optional("inside", default=bool(v.get("inside", True))): selector.BooleanSelector(),
            _suggest("area", v.get("area")): selector.AreaSelector(),
            _suggest("location", v.get("location")): _TEXT,
            _suggest("picture", v.get("picture")): _TEXT,
            _suggest("last_watered", v.get("last_watered")): selector.DateSelector(),
            _suggest("last_fertilised", v.get("last_fertilised")): selector.DateSelector(),
            vol.Required("sensor"): section(sensor, {"collapsed": False}),
            vol.Required("nutrition"): section(nutrition, {"collapsed": True}),
            _suggest("notes", v.get("notes")): _MULTILINE,
        })

    async def async_step_plant(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        placeholders = {"line": ""}
        if user_input is not None:
            flat = {k: val for k, val in user_input.items() if k not in ("sensor", "nutrition")}
            flat.update(user_input.get("sensor") or {})
            flat.update(user_input.get("nutrition") or {})
            for k in ("name", "common_name", "species", "area", "location", "picture", "moisture_entity",
                      "fertiliser_name", "soil_notes", "notes", "last_watered", "last_fertilised"):
                if k in flat or k in ("moisture_entity", "common_name", "area"):
                    self._values[k] = flat.get(k)
            self._values["inside"] = bool(flat.get("inside", True))
            lo, hi = flat.get("moisture_min"), flat.get("moisture_max")
            self._values["moisture_range"] = [lo, hi] if lo is not None and hi is not None else None
            lo, hi = flat.get("temperature_min"), flat.get("temperature_max")
            self._values["temperature_range"] = [lo, hi] if lo is not None and hi is not None else None
            n, p, k = flat.get("npk_n"), flat.get("npk_p"), flat.get("npk_k")
            self._values["npk"] = [n, p, k] if None not in (n, p, k) else None
            try:
                self._values["soil_mix"] = logic.parse_soil_mix(flat.get("soil_mix"))
            except ValueError as err:
                errors["base"] = "invalid_soil_mix"
                placeholders["line"] = str(err)
            species = (self._values.get("species") or "").strip().lower()
            if not errors and species and species != (self._species or {}).get("pid"):
                self._species = await self.manager.async_get_species(species)
                self._values["species"] = species
            if not errors:
                return await self.async_step_schedule()
        return self.async_show_form(
            step_id="plant", data_schema=self._plant_schema(), errors=errors, description_placeholders=placeholders,
        )

    async def async_step_schedule(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        placeholders = {"line": "", "example": "1 Mar - 30 Nov: every 10 days"}
        if user_input is not None:
            try:
                water = logic.parse_periods(user_input.get("water_schedule"))
                feed = logic.parse_periods(user_input.get("feed_schedule"))
            except ValueError as err:
                errors["base"] = "invalid_schedule"
                placeholders["line"] = str(err)
            else:
                self._values["water"], self._values["feed"] = water, feed
                return self._finish()
            self._values["water_text"] = user_input.get("water_schedule")
            self._values["feed_text"] = user_input.get("feed_schedule")
        schema = vol.Schema({
            _suggest("water_schedule", self._values.get("water_text")
                     or logic.format_periods(self._values.get("water"))): _MULTILINE,
            _suggest("feed_schedule", self._values.get("feed_text")
                     or logic.format_periods(self._values.get("feed"))): _MULTILINE,
        })
        return self.async_show_form(
            step_id="schedule", data_schema=schema, errors=errors, description_placeholders=placeholders,
        )

    @callback
    def _finish(self) -> SubentryFlowResult:
        values = {k: v for k, v in self._values.items() if k not in ("water_text", "feed_text")}
        data = clean_plant_data(values)
        data = {k: v for k, v in data.items() if v is not None or k == "species"}
        title = data.get("common_name") or data.get("name") or "Plant"
        if self._reconfigure:
            entry, sub = self._get_entry(), self._get_reconfigure_subentry()
            self.manager.apply_area(sub.subentry_id, data.get("area"))
            return self.async_update_and_abort(entry, sub, title=title, data=data)
        return self.async_create_entry(title=title, data=data)
