"""Data manager for The Green Finger: plants (config subentries), species cache, services logic."""
from __future__ import annotations

import asyncio
import logging
from types import MappingProxyType
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import logic
from .const import DOMAIN, SUBENTRY_PLANT
from .entity import find_device
from .openplantbook import OpenPlantbookClient, OpenPlantbookError

_LOGGER = logging.getLogger(__name__)
STORAGE_VERSION = 1
SPECIES_KEEP = (
    "pid", "display_pid", "alias", "category", "origin", "image_url", "common_names",
    "watering", "fertilization", "sunlight", "soil", "pruning",
    "min_soil_moist", "max_soil_moist", "min_temp", "max_temp", "min_temp_survival",
    "min_env_humid", "max_env_humid", "min_light_lux", "max_light_lux",
    "min_light_mmol", "max_light_mmol", "min_soil_ec", "max_soil_ec", "min_dli", "max_dli",
)
SEARCH_DETAIL_LIMIT = 8


def _invalid(key: str, **placeholders: str) -> ServiceValidationError:
    return ServiceValidationError(translation_domain=DOMAIN, translation_key=key, translation_placeholders=placeholders)


def clean_periods(value: Any) -> list[list[int]]:
    """Accept a list of [sm, sd, em, ed, days] or the text form; return validated periods."""
    if isinstance(value, str):
        try:
            return logic.parse_periods(value)
        except ValueError as err:
            raise _invalid("invalid_schedule", line=str(err)) from err
    out: list[list[int]] = []
    for p in value or []:
        try:
            sm, sd, em, ed, days = (int(float(x)) for x in list(p)[:5])
        except (TypeError, ValueError):
            continue
        if not (1 <= sm <= 12 and 1 <= em <= 12 and 1 <= sd <= logic.LAST_DAY[sm - 1] and 1 <= ed <= logic.LAST_DAY[em - 1]):
            continue
        out.append([sm, sd, em, ed, max(0, min(days, 365))])
    return out[: logic.MAX_PERIODS]


def clean_range(value: Any) -> list[float] | None:
    try:
        lo, hi = (float(x) for x in list(value)[:2])
    except (TypeError, ValueError):
        return None
    return [lo, hi] if lo <= hi else [hi, lo]


def clean_date(value: Any) -> str | None:
    d = logic.parse_date(value)
    return d.isoformat() if d else None


def clean_soil_mix(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            return logic.parse_soil_mix(value)
        except ValueError as err:
            raise _invalid("invalid_soil_mix", line=str(err)) from err
    lines = []
    for c in value or []:
        if isinstance(c, dict) and c.get("name") and logic.to_float(c.get("percent")) is not None:
            lines.append(f"{logic.to_float(c['percent']):g}% {c['name']}")
    return clean_soil_mix("\n".join(lines)) if lines else []


def clean_npk(value: Any) -> list[float] | None:
    try:
        vals = [float(x) for x in list(value)[:3]]
    except (TypeError, ValueError):
        return None
    return vals if len(vals) == 3 and all(0 <= v <= 100 for v in vals) else None


def clean_plant_data(data: dict[str, Any]) -> dict[str, Any]:
    """Validate/normalise the keys present in ``data`` (partial updates are fine)."""
    out: dict[str, Any] = {}
    text_keys = (
        "name", "common_name", "species", "moisture_entity", "location", "area",
        "picture", "fertiliser_name", "soil_notes", "notes",
    )
    for key in text_keys:
        if key in data:
            val = data[key]
            val = str(val).strip() if val is not None else ""
            out[key] = val or None
    if out.get("species"):
        out["species"] = out["species"].lower()
    if "name" in out and not out["name"]:
        raise _invalid("name_required")
    if "inside" in data:
        out["inside"] = bool(data["inside"])
    for key in ("last_watered", "last_fertilised"):
        if key in data:
            d = clean_date(data[key])
            if d:
                out[key] = d
    if "water" in data:
        out["water"] = clean_periods(data["water"])
    if "feed" in data:
        out["feed"] = clean_periods(data["feed"])
    for key in ("moisture_range", "temperature_range"):
        if key in data:
            out[key] = clean_range(data[key])
    if "npk" in data:
        out["npk"] = clean_npk(data["npk"])
    if "soil_mix" in data:
        out["soil_mix"] = clean_soil_mix(data["soil_mix"])
    return out


class GreenFingerManager:
    """Owns the OpenPlantbook client, the species cache and plant create/update/delete."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: OpenPlantbookClient | None) -> None:
        self.hass = hass
        self.entry = entry
        self.client = client
        self._store: Store = Store(hass, STORAGE_VERSION, f"{DOMAIN}.species")
        self.species: dict[str, dict[str, Any]] = {}
        self.entities: dict[str, Any] = {}
        self.known_subentries: set[str] = set()
        self.known_data: dict[str, Any] = {}

    # ---------------------------------------------------------------- basics
    @property
    def hemisphere(self) -> str:
        return "south" if (self.hass.config.latitude or 0) < 0 else "north"

    @property
    def language(self) -> str:
        return self.hass.config.language or "en"

    async def async_load(self) -> None:
        self.species = (await self._store.async_load()) or {}

    @callback
    def _save_species(self) -> None:
        self._store.async_delay_save(lambda: self.species, 1)

    @callback
    def async_refresh_all(self) -> None:
        for ent in list(self.entities.values()):
            ent.refresh()

    def plant(self, subentry_id: str) -> dict[str, Any] | None:
        sub = self.entry.subentries.get(subentry_id)
        if not sub or sub.subentry_type != SUBENTRY_PLANT:
            return None
        return {**dict(sub.data), "id": subentry_id}

    def _subentry(self, subentry_id: str) -> ConfigSubentry:
        sub = self.entry.subentries.get(subentry_id)
        if not sub or sub.subentry_type != SUBENTRY_PLANT:
            raise _invalid("unknown_plant", plant=subentry_id)
        return sub

    # --------------------------------------------------------------- species
    async def async_get_species(self, pid: str, refresh: bool = False) -> dict[str, Any] | None:
        pid = (pid or "").strip().lower()
        if not pid:
            return None
        cached = self.species.get(pid)
        if cached and not refresh and cached.get("watering") is not None:
            return cached
        if self.client is None:
            return cached
        try:
            raw = await self.client.async_detail(pid)
        except OpenPlantbookError as err:
            _LOGGER.warning("OpenPlantbook lookup of %s failed: %s", pid, err)
            return cached
        if not raw:
            return cached
        data = {k: raw[k] for k in SPECIES_KEEP if k in raw}
        data.setdefault("pid", pid)
        self.species[data["pid"]] = data
        if data["pid"] != pid:
            self.species[pid] = data
        self._save_species()
        return data

    async def async_search(self, query: str) -> list[dict[str, Any]]:
        """Search OpenPlantbook and attach picture / ranges for the top hits."""
        query = (query or "").strip()
        if len(query) < 3:
            return []
        if self.client is None:
            raise _invalid("no_credentials")
        hits = await self.client.async_search(query)
        pids = [h["pid"] for h in hits[:SEARCH_DETAIL_LIMIT] if h.get("pid")]
        details = await asyncio.gather(*(self.async_get_species(p) for p in pids), return_exceptions=True)
        results = []
        for hit in hits[:SEARCH_DETAIL_LIMIT]:
            pid = hit.get("pid")
            if not pid:
                continue
            det = details[pids.index(pid)] if pid in pids else None
            d = det if isinstance(det, dict) else {}
            results.append({
                "pid": pid,
                "display": hit.get("display_pid") or d.get("display_pid") or pid,
                "alias": hit.get("alias") or d.get("alias"),
                "image_url": d.get("image_url"),
                "common_names": logic.english_names(d, self.language),
                "min_soil_moist": d.get("min_soil_moist"),
                "max_soil_moist": d.get("max_soil_moist"),
                "min_temp": d.get("min_temp"),
                "max_temp": d.get("max_temp"),
                "origin": d.get("origin"),
            })
        return results

    def suggest(self, species: dict[str, Any] | None) -> dict[str, Any]:
        """Defaults for a new plant of this species."""
        sp = species or {}
        base = logic.schedule_base_days(sp.get("max_soil_moist"))
        alias = (sp.get("alias") or "").strip()
        return {
            "water": logic.parse_schedule(sp.get("watering"), "water", base, self.hemisphere),
            "feed": logic.parse_schedule(sp.get("fertilization"), "feed", 30, self.hemisphere),
            "moisture_range": [sp.get("min_soil_moist", 20), sp.get("max_soil_moist", 60)],
            "temperature_range": [sp.get("min_temp", 15), sp.get("max_temp", 30)],
            "npk": logic.parse_npk(sp.get("fertilization")),
            "name": (alias[:1].upper() + alias[1:]) if alias else (sp.get("display_pid") or ""),
            "common_names": logic.english_names(sp, self.language),
            "picture": sp.get("image_url"),
        }

    # ----------------------------------------------------------- plant CRUD
    def default_plant(self) -> dict[str, Any]:
        today = dt_util.now().date().isoformat()
        return {
            "name": "", "common_name": None, "species": None, "inside": True,
            "last_watered": today, "last_fertilised": today,
            "water": [[1, 1, 12, 31, 14]], "feed": [[3, 1, 11, 30, 30]],
            "moisture_entity": None, "moisture_range": None, "temperature_range": None,
        }

    async def async_add_plant(self, data: dict[str, Any]) -> str:
        data = dict(data)
        if not str(data.get("name") or "").strip():
            raise _invalid("name_required")
        plant = self.default_plant()
        pid = str(data.get("species") or "").strip().lower()
        if pid:
            sp = await self.async_get_species(pid)
            plant["species"] = (sp or {}).get("pid") or pid
            sug = self.suggest(sp)
            plant["water"] = sug["water"] or plant["water"]
            plant["feed"] = sug["feed"] or plant["feed"]
        plant.update(clean_plant_data({k: v for k, v in data.items() if k != "species"}))
        plant = {k: v for k, v in plant.items() if v is not None or k in ("species",)}
        title = plant.get("common_name") or plant["name"]
        sub = ConfigSubentry(data=MappingProxyType(plant), subentry_type=SUBENTRY_PLANT, title=title, unique_id=None)
        if not self.hass.config_entries.async_add_subentry(self.entry, sub):
            raise HomeAssistantError("Could not add the plant")
        return sub.subentry_id

    async def async_update_plant(self, subentry_id: str, data: dict[str, Any]) -> None:
        sub = self._subentry(subentry_id)
        merged = dict(sub.data)
        new = dict(data)
        if new.get("species") and str(new["species"]).strip().lower() != (merged.get("species") or ""):
            await self.async_get_species(str(new["species"]))
        merged.update(clean_plant_data(new))
        merged = {k: v for k, v in merged.items() if v is not None or k == "species"}
        title = merged.get("common_name") or merged.get("name") or sub.title
        self.hass.config_entries.async_update_subentry(self.entry, sub, data=merged, title=title)
        if "area" in new:
            self.apply_area(subentry_id, merged.get("area"))

    @callback
    def apply_area(self, subentry_id: str, area_id: str | None) -> None:
        reg = dr.async_get(self.hass)
        device = find_device(self.hass, self.entry.entry_id, subentry_id)
        if device:
            reg.async_update_device(device.id, area_id=area_id or None)

    @callback
    def async_remove_plant(self, subentry_id: str) -> None:
        self._subentry(subentry_id)
        self.hass.config_entries.async_remove_subentry(self.entry, subentry_id)

    @callback
    def async_mark(self, subentry_id: str, kind: str, when: Any = None) -> None:
        sub = self._subentry(subentry_id)
        d = clean_date(when) or dt_util.now().date().isoformat()
        key = "last_watered" if kind == "water" else "last_fertilised"
        self.hass.config_entries.async_update_subentry(self.entry, sub, data={**dict(sub.data), key: d})

    async def async_fill_missing_species(self) -> None:
        """Download the species record of every plant that has none cached yet."""
        if self.client is None:
            return
        for sub in list(self.entry.subentries.values()):
            pid = str(sub.data.get("species") or "").strip().lower()
            if pid and (self.species.get(pid) or {}).get("watering") is None:
                await self.async_get_species(pid)
        self.async_refresh_all()

    async def async_refresh_species(self, subentry_id: str | None = None) -> None:
        ids = [subentry_id] if subentry_id else [
            s for s, sub in self.entry.subentries.items() if sub.subentry_type == SUBENTRY_PLANT
        ]
        for sid in ids:
            pid = (self.plant(sid) or {}).get("species")
            if pid:
                await self.async_get_species(pid, refresh=True)
        self.async_refresh_all()
