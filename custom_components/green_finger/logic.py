"""Pure logic for The Green Finger (no Home Assistant imports, unit-testable).

Schedules are lists of periods ``[start_month, start_day, end_month, end_day, days]``.
``days == 0`` means "rest" (no watering / feeding). Outside every period is rest too.
A period may wrap the year end (e.g. 12.1 -> 2.29).
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta
from typing import Any

MONTHS = [
    "january", "february", "march", "april", "may", "june", "july",
    "august", "september", "october", "november", "december",
]
MONTH_ABBR = [m[:3].capitalize() for m in MONTHS]
LAST_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
SEASONS = ["spring", "summer", "autumn", "winter"]

# Month windows (start month, end month) of each season per hemisphere.
SEASON_MONTHS = {
    "north": [(3, 5), (6, 8), (9, 11), (12, 2)],
    "south": [(9, 11), (12, 2), (3, 5), (6, 8)],
}
MAX_PERIODS = 6

_MP = "|".join(MONTHS)
_RE_TIMES = re.compile(r"(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*times?\s*(?:a|per|/|each)?\s*(month|week)")
_RE_EVERY = re.compile(r"(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*(day|week|month)")
_RE_WINDOW = re.compile(rf"({_MP})\s*(?:through|thru|to|until|till|-|–)\s*({_MP})")
_RE_SRANGE = re.compile(
    r"(spring|summer|autumn|winter)\s*(?:to|through|thru|until|till|-|–)\s*(spring|summer|autumn|winter)"
)
_RE_REDUCE = re.compile(r"reduce|less|fewer|sparing|little|rarely|minimal")
_RE_STOP = re.compile(r"do not|don.t|no feed|avoid|withhold|stop|never|not fertili|not feed")
_RE_LINE = re.compile(
    r"^\s*(\d{1,2})\s+([A-Za-z]{3,})\s*(?:-|–|to)\s*(\d{1,2})\s+([A-Za-z]{3,})\s*:\s*"
    r"(?:every\s+)?(\d+|rest)\s*(?:days?)?\s*$",
    re.IGNORECASE,
)


def _clause_interval(c: str) -> int:
    m = _RE_TIMES.search(c)
    if m:
        times = int(m.group(2) or m.group(1)) or 1
        per = 30 if m.group(3) == "month" else 7
        return max(round(per / times), 1)
    m = _RE_EVERY.search(c)
    if m:
        hi = int(m.group(2) or m.group(1))
        unit = {"week": 7, "month": 30}.get(m.group(3), 1)
        return hi * unit
    if re.search(r"monthly|once a month|every month", c):
        return 30
    if re.search(r"weekly|once a week|every week", c):
        return 7
    if re.search(r"fortnight|every other week|twice a month", c):
        return 14
    return 0


def _span(m1: int, m2: int) -> list[int]:
    """Start/end month -> [start_month, 1, end_month, last_day] pieces."""
    return [m1, 1, m2, LAST_DAY[m2 - 1]]


def parse_schedule(text: str | None, kind: str, base: int, hemisphere: str = "north") -> list[list[int]]:
    """Turn OpenPlantbook care text into schedule periods.

    ``kind`` is "water" or "feed"; ``base`` is the fallback interval in days.
    The upper end of a range is used ("every 2 to 3 weeks" -> 21 days).
    """
    hemi = hemisphere if hemisphere in SEASON_MONTHS else "north"
    season_months = SEASON_MONTHS[hemi]
    t = (text or "").lower().replace("fall", "autumn")
    seasons = [0, 0, 0, 0]
    anyval = 0
    windows: list[list[int]] = []
    for c in re.split(r"[;\n\r•]|\. ", t):
        iv = _clause_interval(c)
        if iv <= 0:
            continue
        mw = _RE_WINDOW.search(c)
        if mw:
            windows.append([MONTHS.index(mw.group(1)) + 1, MONTHS.index(mw.group(2)) + 1, iv])
            continue
        flags = [s in c for s in SEASONS]
        rg = _RE_SRANGE.search(c)
        if rg:
            a0, b0 = SEASONS.index(rg.group(1)), SEASONS.index(rg.group(2))
            for step in range(4):
                k = (a0 + step) % 4
                if (k - a0) % 4 <= (b0 - a0) % 4:
                    flags[k] = True
        if any(flags):
            for k in range(4):
                if flags[k]:
                    seasons[k] = iv
        else:
            anyval = iv

    red = bool(_RE_REDUCE.search(t))
    stop = bool(_RE_STOP.search(t))
    out: list[list[int]] = []
    w0, w1 = season_months[3]  # winter window
    cold = [*_span(w0, w1)]
    # the rest of the year around the winter window
    warm_start = w1 % 12 + 1
    warm_end = (w0 - 2) % 12 + 1
    warm = _span(warm_start, warm_end)
    if windows:
        for m1, m2, iv in windows:
            out.append([*_span(m1, m2), iv])
    elif sum(seasons) == 0:
        b = anyval if anyval > 0 else base
        if "winter" in t and kind == "feed" and stop:
            out = [[*warm, b]]
        elif "winter" in t and red:
            out = [[*warm, b], [*cold, b * 2]]
        else:
            out = [[1, 1, 12, 31, b]]
    else:
        gr = seasons[1] or seasons[0] or seasons[2] or seasons[3]
        if kind == "water":
            vals = [seasons[0] or gr, gr, seasons[2] or gr, seasons[3] or (gr * 2 if red else gr)]
        else:
            winter = seasons[3] or ((gr * 2) if (red and "winter" in t and not stop) else 0)
            vals = [seasons[0], seasons[1], seasons[2], winter]
        seq = [[*_span(*season_months[k]), vals[k]] for k in range(4)]
        seq.sort(key=lambda p: p[0])
        for s in seq:
            if s[4] <= 0:
                continue
            if out and out[-1][4] == s[4] and out[-1][2] + 1 == s[0]:
                out[-1] = [out[-1][0], out[-1][1], s[2], s[3], s[4]]
            else:
                out.append(s)
    return out[:MAX_PERIODS]


def schedule_base_days(max_soil_moist: Any) -> int:
    """Fallback watering interval from the species' maximum soil moisture."""
    try:
        m = float(max_soil_moist)
    except (TypeError, ValueError):
        m = 50.0
    return 5 if m > 60 else (7 if m > 50 else 14)


def _in_period(p: list[int], today: date) -> bool:
    t = today.month * 100 + today.day
    s = int(p[0]) * 100 + int(p[1])
    e = int(p[2]) * 100 + int(p[3])
    return (s <= t <= e) if s <= e else (t >= s or t <= e)


def period_days(periods: list[list[int]] | None, today: date) -> int:
    """Days between actions for the period covering today (0 = rest)."""
    for p in periods or []:
        try:
            if _in_period(p, today):
                return max(int(p[4]), 0)
        except (TypeError, ValueError, IndexError):
            continue
    return 0


def period_label(periods: list[list[int]] | None, today: date) -> str:
    """Human label for the current period, e.g. '1 Mar - 30 Nov'."""
    for p in periods or []:
        try:
            if _in_period(p, today):
                return f"{p[1]} {MONTH_ABBR[p[0] - 1]} - {p[3]} {MONTH_ABBR[p[2] - 1]}"
        except (TypeError, ValueError, IndexError):
            continue
    return ""


def format_periods(periods: list[list[int]] | None) -> str:
    """Periods -> one line each: '1 Mar - 30 Nov: every 10 days' / '...: rest'."""
    lines = []
    for p in periods or []:
        days = "rest" if int(p[4]) == 0 else f"every {int(p[4])} days"
        lines.append(f"{p[1]} {MONTH_ABBR[p[0] - 1]} - {p[3]} {MONTH_ABBR[p[2] - 1]}: {days}")
    return "\n".join(lines)


def parse_periods(text: str | None) -> list[list[int]]:
    """Inverse of :func:`format_periods`. Raises ValueError naming the bad line."""
    out: list[list[int]] = []
    for raw in (text or "").splitlines():
        if not raw.strip():
            continue
        m = _RE_LINE.match(raw)
        if not m:
            raise ValueError(raw.strip())
        d1, mon1, d2, mon2, days = m.groups()
        try:
            m1 = [x[:3] for x in MONTHS].index(mon1[:3].lower()) + 1
            m2 = [x[:3] for x in MONTHS].index(mon2[:3].lower()) + 1
        except ValueError as err:
            raise ValueError(raw.strip()) from err
        if not (1 <= int(d1) <= LAST_DAY[m1 - 1] and 1 <= int(d2) <= LAST_DAY[m2 - 1]):
            raise ValueError(raw.strip())
        out.append([m1, int(d1), m2, int(d2), 0 if days.lower() == "rest" else min(int(days), 365)])
    if len(out) > MAX_PERIODS:
        raise ValueError(f"at most {MAX_PERIODS} periods")
    return out


MAX_SOIL_COMPONENTS = 8
_RE_NPK = re.compile(r"\b(\d{1,2}(?:\.\d)?)\s*[-:/]\s*(\d{1,2}(?:\.\d)?)\s*[-:/]\s*(\d{1,2}(?:\.\d)?)\b")
_RE_SOIL_A = re.compile(r"^\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*[x:]?\s*(.+?)\s*$")
_RE_SOIL_B = re.compile(r"^\s*(.+?)\s*[:=]\s*(\d{1,3}(?:\.\d+)?)\s*%?\s*$")


def parse_npk(text: str | None) -> list[float] | None:
    """Find an N-P-K ratio such as '10-10-10' in free text (care notes)."""
    m = _RE_NPK.search(text or "")
    if not m:
        return None
    vals = [float(g) for g in m.groups()]
    return vals if all(0 <= v <= 60 for v in vals) else None


def format_npk(npk: list[Any] | None) -> str | None:
    if not npk or len(npk) != 3:
        return None
    try:
        return "-".join(f"{float(v):g}" for v in npk)
    except (TypeError, ValueError):
        return None


def parse_soil_mix(text: str | None) -> list[dict[str, Any]]:
    """Parse lines like '40% peat' / 'perlite: 30' into [{'name','percent'}]. Raises ValueError."""
    out: list[dict[str, Any]] = []
    for raw in (text or "").splitlines():
        if not raw.strip():
            continue
        m = _RE_SOIL_A.match(raw)
        if m:
            pct, name = float(m.group(1)), m.group(2)
        else:
            m = _RE_SOIL_B.match(raw)
            if not m:
                raise ValueError(raw.strip())
            name, pct = m.group(1), float(m.group(2))
        if not 0 < pct <= 100 or not name.strip():
            raise ValueError(raw.strip())
        out.append({"name": name.strip(), "percent": int(pct) if pct == int(pct) else pct})
    if len(out) > MAX_SOIL_COMPONENTS:
        raise ValueError(f"at most {MAX_SOIL_COMPONENTS} components")
    if sum(c["percent"] for c in out) > 100.5:
        raise ValueError("the parts add up to more than 100%")
    return out


def format_soil_mix(mix: list[dict[str, Any]] | None) -> str:
    return "\n".join(f"{c.get('percent'):g}% {c.get('name')}" for c in (mix or []) if c.get("name"))


def zone_status(val: float | None, zlo: float, zhi: float, vmin: float, vmax: float,
                cnt: int, min_mg: int, names: list[str]) -> str | None:
    """Zoned status word for a reading (same maths as the card's LED gauges)."""
    if val is None:
        return None
    step = (vmax - vmin) / cnt
    lo_i = max(0, math.ceil((zlo - vmin) / step - 0.5))
    hi_i = min(cnt - 1, math.floor((zhi - vmin) / step - 0.5))
    mg_l = max(min_mg, round((zhi - zlo) * 0.3 / step))
    a_bel = min(mg_l, max(0, lo_i - 1))
    a_abo = min(mg_l, max(0, cnt - 2 - hi_i))
    t_lo = vmin + step * (lo_i - a_bel)
    t_hi = vmin + step * (hi_i + a_abo + 1)
    if val < t_lo:
        return names[0]
    if val < zlo:
        return names[1]
    if val <= zhi:
        return names[2]
    if val <= t_hi:
        return names[3]
    return names[4]


def parse_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def to_float(value: Any) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def english_names(species: dict[str, Any] | None, language: str = "en") -> list[str]:
    """Common names in the user's language, falling back to English."""
    cn = (species or {}).get("common_names") or []
    lang = (language or "en")[:2].lower()
    names = [c.get("name") for c in cn if c.get("language_code") == lang and c.get("name")]
    if not names and lang != "en":
        names = [c.get("name") for c in cn if c.get("language_code") == "en" and c.get("name")]
    return names


def compute(plant: dict[str, Any], species: dict[str, Any] | None, readings: dict[str, Any],
            today: date, language: str = "en", area: str | None = None) -> dict[str, Any]:
    """Derive the state and attributes of one plant.

    ``area`` is the Home Assistant area of the plant's device (looked up by the entity).
    """
    sp = species or {}
    water = plant.get("water") or []
    feed = plant.get("feed") or []
    lw = parse_date(plant.get("last_watered"))
    lf = parse_date(plant.get("last_fertilised"))

    w_int = period_days(water, today)
    f_int = period_days(feed, today)
    w_left = (w_int - (today - lw).days) if (lw and w_int > 0) else None
    f_left = (f_int - (today - lf).days) if (lf and f_int > 0) else None

    def status(left: int | None, interval: int) -> str:
        if interval <= 0:
            return "rest"
        if left is None:
            return "unknown"
        if left < 0:
            return "overdue"
        if left <= 1:
            return "due"
        return "ok"

    m_rng = plant.get("moisture_range") or [sp.get("min_soil_moist", 20), sp.get("max_soil_moist", 60)]
    t_rng = plant.get("temperature_range") or [sp.get("min_temp", 15), sp.get("max_temp", 30)]
    m_lo, m_hi = to_float(m_rng[0]), to_float(m_rng[1])
    t_lo, t_hi = to_float(t_rng[0]), to_float(t_rng[1])
    m_lo = 20.0 if m_lo is None else m_lo
    m_hi = 60.0 if m_hi is None else m_hi
    t_lo = 15.0 if t_lo is None else t_lo
    t_hi = 30.0 if t_hi is None else t_hi

    moisture = to_float(readings.get("moisture"))
    temperature = to_float(readings.get("temperature"))
    battery = to_float(readings.get("battery"))
    m_status = zone_status(moisture, m_lo, m_hi, 0, 100, 50, 3, ["dry", "low", "ok", "high", "wet"])
    t_status = zone_status(temperature, t_lo, t_hi, 0, 50, 50, 2, ["cold", "cool", "ok", "warm", "hot"])

    w_status = status(w_left, w_int)
    f_status = status(f_left, f_int)
    needs_water = w_status in ("overdue", "due") or m_status in ("dry", "low")
    needs_feed = f_status in ("overdue", "due")
    state = "needs_both" if needs_water and needs_feed else (
        "needs_water" if needs_water else ("needs_feed" if needs_feed else "ok"))

    def nxt(last: date | None, interval: int) -> str | None:
        if not last or interval <= 0:
            return None
        return (last + timedelta(days=interval)).isoformat()

    care = {k: sp.get(k) for k in (
        "watering", "fertilization", "sunlight", "soil", "pruning", "origin", "category",
        "min_light_lux", "max_light_lux", "min_env_humid", "max_env_humid", "min_soil_ec", "max_soil_ec",
    ) if sp.get(k) not in (None, "")}

    npk = plant.get("npk")
    if not npk:
        npk = parse_npk(sp.get("fertilization"))
    mix = plant.get("soil_mix") or []

    attrs = {
        "green_finger": True,
        "plant_name": plant.get("name"),
        "common_name": plant.get("common_name") or None,
        "display_name": plant.get("common_name") or plant.get("name"),
        "species": plant.get("species") or None,
        "species_name": sp.get("display_pid") or plant.get("species") or None,
        "species_alias": sp.get("alias") or None,
        "common_names": english_names(sp, language),
        "picture": plant.get("picture") or sp.get("image_url") or None,
        "species_picture": sp.get("image_url") or None,
        "user_picture": bool(plant.get("picture")),
        "area": area,
        "location": plant.get("location") or None,
        "fertiliser_npk": [float(v) for v in npk] if npk else None,
        "fertiliser_npk_label": format_npk(npk),
        "fertiliser_name": plant.get("fertiliser_name") or None,
        "soil_mix": mix,
        "soil_notes": plant.get("soil_notes") or None,
        "inside": bool(plant.get("inside", True)),
        "last_watered": plant.get("last_watered"),
        "last_fertilised": plant.get("last_fertilised"),
        "water_interval": w_int,
        "feed_interval": f_int,
        "water_days_left": w_left,
        "feed_days_left": f_left,
        "water_status": w_status,
        "feed_status": f_status,
        "next_water": nxt(lw, w_int),
        "next_feed": nxt(lf, f_int),
        "water_period": period_label(water, today),
        "feed_period": period_label(feed, today),
        "water_schedule": water,
        "feed_schedule": feed,
        "moisture_entity": plant.get("moisture_entity") or None,
        "moisture": moisture,
        "temperature": temperature,
        "battery": battery,
        "sensor_name": readings.get("sensor_name"),
        "moisture_status": m_status,
        "temperature_status": t_status,
        "ideal_moisture": [m_lo, m_hi],
        "ideal_temperature": [t_lo, t_hi],
        "care": care,
        "notes": plant.get("notes") or None,
    }
    return {"state": state, "attributes": attrs}
