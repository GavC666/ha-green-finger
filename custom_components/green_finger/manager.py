"""Data manager for The Green Finger: plants (config subentries), species cache, services logic."""
from __future__ import annotations

import asyncio
import logging
import time
from types import MappingProxyType
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import logic
from .const import DOMAIN, SUBENTRY_PLANT
from .entity import find_device
from .gbif import async_common_name_genera
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
SEARCH_RESULT_LIMIT = 12
SEARCH_GENERA = 3
SEARCH_CACHE_SECONDS = 600
SEARCH_CACHE_MAX = 40
UNKNOWN_SPECIES_SECONDS = 6 * 3600
UNKNOWN_SPECIES_MAX = 200


def species_is_saved(record: dict[str, Any] | None) -> bool:
    """True when the OpenPlantbook record was downloaded completely (so it is never requested again)."""
    return bool(record) and ("fetched_at" in record or record.get("watering") is not None)


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
        if not (1 <= sm <= 12 and 1 <= em <= 12):
            continue
        if not (1 <= sd <= logic.LAST_DAY[sm - 1] and 1 <= ed <= logic.LAST_DAY[em - 1]):
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
    lines = [
        f"{logic.to_float(c['percent']):g}% {c['name']}"
        for c in value or []
        if isinstance(c, dict) and c.get("name") and logic.to_float(c.get("percent")) is not None
    ]
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
    if "auto_watered" in data:
        out["auto_watered"] = bool(data["auto_watered"])
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
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._search_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._inflight: dict[str, asyncio.Task] = {}
        self._unknown: dict[str, float] = {}  # species OpenPlantbook does not know (time of the "not found")
        self._dirty = False  # species data waiting to be written
        self.summary: Any = None  # the "plants needing care" sensor, once it exists

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
        self._dirty = True
        self._store.async_delay_save(self._species_data, 1)

    @callback
    def _species_data(self) -> dict[str, dict[str, Any]]:
        self._dirty = False
        return self.species

    async def async_flush(self) -> None:
        """Write species data that is still waiting (before a reload would drop it)."""
        if self._dirty:
            self._dirty = False
            await self._store.async_save(self.species)

    @callback
    def async_refresh_all(self) -> None:
        for ent in list(self.entities.values()):
            ent.refresh()

    @callback
    def async_update_summary(self) -> None:
        """Tell the "plants needing care" sensor that a plant changed."""
        if self.summary is not None:
            self.summary.recompute()

    @callback
    def async_refresh_changed(self) -> None:
        """Refresh only the plants whose stored data changed since the last call."""
        current = {
            sid: dict(sub.data) for sid, sub in self.entry.subentries.items() if sub.subentry_type == SUBENTRY_PLANT
        }
        for sid, data in current.items():
            if self._snapshots.get(sid) != data:
                ent = self.entities.get(sid)
                if ent is not None:
                    ent.refresh()
        self._snapshots = current

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

    def check_sensor_free(self, entity_id: str | None, own_subentry_id: str | None = None) -> None:
        """Raise if the soil sensor is already assigned to another plant."""
        if not entity_id:
            return
        for sid, sub in self.entry.subentries.items():
            if sid != own_subentry_id and sub.subentry_type == SUBENTRY_PLANT \
                    and sub.data.get("moisture_entity") == entity_id:
                raise _invalid("sensor_in_use", sensor=entity_id, plant=sub.title)

    # --------------------------------------------------------------- species
    async def async_get_species(
        self, pid: str, refresh: bool = False, raise_errors: bool = False,
    ) -> dict[str, Any] | None:
        """The saved record of a species. OpenPlantbook is asked only when nothing is saved or ``refresh`` is set.

        A failed request returns the saved record (or None) unless ``raise_errors`` is set.
        """
        pid = (pid or "").strip().lower()
        if not pid:
            return None
        cached = self.species.get(pid)
        if cached and not refresh and species_is_saved(cached):
            return cached
        if self.client is None:
            return cached
        missing_at = self._unknown.get(pid)
        if missing_at is not None and not refresh and time.monotonic() - missing_at < UNKNOWN_SPECIES_SECONDS:
            return cached  # asked recently and OpenPlantbook does not have it: do not ask again
        running = self._inflight.get(pid)
        if running is None:  # otherwise the same species is already being downloaded: share that request
            running = self.hass.async_create_task(self._download_species(pid))
            self._inflight[pid] = running
            running.add_done_callback(lambda task, key=pid: self._download_done(key, task))
        try:
            record = await asyncio.shield(running)
        except OpenPlantbookError as err:
            if raise_errors:
                raise
            _LOGGER.warning("OpenPlantbook lookup of %s failed: %s", pid, err)
            return cached
        return record or cached

    @callback
    def _download_done(self, pid: str, task: asyncio.Task) -> None:
        self._inflight.pop(pid, None)
        if not task.cancelled():
            task.exception()  # a failure was already handed to every caller that waited for it

    async def _download_species(self, pid: str) -> dict[str, Any] | None:
        assert self.client is not None
        raw = await self.client.async_detail(pid)
        if not raw:
            if len(self._unknown) >= UNKNOWN_SPECIES_MAX:
                self._unknown.pop(next(iter(self._unknown)))
            self._unknown[pid] = time.monotonic()
            return None
        self._unknown.pop(pid, None)
        data = {k: raw[k] for k in SPECIES_KEEP if k in raw}
        data.setdefault("pid", pid)
        data["fetched_at"] = dt_util.now().date().isoformat()
        self.species[data["pid"]] = data
        if data["pid"] != pid:
            self.species[pid] = data
        self._save_species()
        self.async_refresh_all()  # plants of this species pick up the new data
        return data

    def _result_row(self, hit: dict[str, Any], via: str | None = None) -> dict[str, Any]:
        """One search result; picture and ranges only when the species is already cached (no extra request)."""
        pid = hit.get("pid")
        cached = self.species.get(str(pid or "").lower()) or {}
        return {
            "pid": pid,
            "display": hit.get("display_pid") or cached.get("display_pid") or pid,
            "alias": hit.get("alias") or cached.get("alias"),
            "image_url": cached.get("image_url"),
            "common_names": logic.english_names(cached, self.language) if cached else [],
            "min_soil_moist": cached.get("min_soil_moist"),
            "max_soil_moist": cached.get("max_soil_moist"),
            "min_temp": cached.get("min_temp"),
            "max_temp": cached.get("max_temp"),
            "origin": cached.get("origin"),
            "via": via,
        }

    async def async_search(self, query: str) -> dict[str, Any]:
        """Search OpenPlantbook: one request for the names; details are fetched only for the chosen species.

        When nothing matches (OpenPlantbook mostly uses Latin names) the common name is looked up at GBIF and
        the best matching genera are searched instead.
        """
        query = (query or "").strip()
        if len(query) < 3:
            return {"results": [], "note": None}
        if self.client is None:
            raise _invalid("no_credentials")
        key = query.lower()
        cached = self._search_cache.get(key)
        if cached and time.monotonic() - cached[0] < SEARCH_CACHE_SECONDS:
            return cached[1]

        hits = await self.client.async_search(query)
        rows = [self._result_row(h) for h in hits if h.get("pid")]
        note = None
        if not rows:
            genera = await async_common_name_genera(async_get_clientsession(self.hass), query, SEARCH_GENERA)
            used: list[str] = []
            seen: set[str] = set()
            for genus in genera:
                for h in await self.client.async_search(genus):
                    pid = h.get("pid")
                    if pid and pid not in seen:
                        seen.add(pid)
                        rows.append(self._result_row(h, via=genus))
                        if genus not in used:
                            used.append(genus)
            if rows:
                note = (
                    f'"{query}" is a common name, so these are species of {", ".join(used)}, '
                    "found through GBIF (OpenPlantbook itself mostly uses Latin names)."
                )
            elif genera:
                note = f"The common name matches the genus {', '.join(genera)}, which OpenPlantbook does not list."
        result = {"results": rows[:SEARCH_RESULT_LIMIT], "note": note}
        if len(self._search_cache) >= SEARCH_CACHE_MAX:
            self._search_cache.pop(next(iter(self._search_cache)))
        self._search_cache[key] = (time.monotonic(), result)
        return result

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
        self.check_sensor_free(str(data.get("moisture_entity") or "").strip() or None)
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
        if "moisture_entity" in new:
            self.check_sensor_free(merged.get("moisture_entity"), subentry_id)
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
        data = {**dict(sub.data), key: d}
        data.pop("postpone_water" if kind == "water" else "postpone_feed", None)
        self.hass.config_entries.async_update_subentry(self.entry, sub, data=data)

    @callback
    def async_postpone(self, subentry_id: str, kind: str, days: int) -> None:
        """Push the next watering / feeding back by ``days`` (added up until it is recorded)."""
        sub = self._subentry(subentry_id)
        key = "postpone_water" if kind == "water" else "postpone_feed"
        total = max(0, min(int(sub.data.get(key) or 0) + int(days), 90))
        self.hass.config_entries.async_update_subentry(self.entry, sub, data={**dict(sub.data), key: total})

    async def async_fill_missing_species(self) -> None:
        """Download the species record of every plant that has none cached yet."""
        if self.client is None:
            return
        for sub in list(self.entry.subentries.values()):
            pid = str(sub.data.get("species") or "").strip().lower()
            if pid and not species_is_saved(self.species.get(pid)):
                try:
                    await self.async_get_species(pid)
                except Exception:  # noqa: BLE001 - a background download must never raise
                    _LOGGER.debug("Species download for %s failed", pid, exc_info=True)
        self.async_refresh_all()

    async def async_refresh_species(self, subentry_id: str | None = None) -> None:
        ids = [subentry_id] if subentry_id else [
            s for s, sub in self.entry.subentries.items() if sub.subentry_type == SUBENTRY_PLANT
        ]
        for sid in ids:
            pid = (self.plant(sid) or {}).get("species")
            if pid:
                await self.async_get_species(pid, refresh=True, raise_errors=True)
        self.async_refresh_all()
