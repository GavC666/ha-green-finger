"""Tests for the pure schedule / state logic (no Home Assistant needed)."""
from __future__ import annotations

import importlib.util
import pathlib
from datetime import date

import pytest

_PATH = pathlib.Path(__file__).parents[1] / "custom_components" / "green_finger" / "logic.py"
_SPEC = importlib.util.spec_from_file_location("green_finger_logic", _PATH)
logic = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(logic)  # type: ignore[union-attr]


def test_three_season_watering_text():
    text = (
        "Water every 2-3 weeks during spring and summer. Reduce to every 4-6 weeks in autumn. "
        "In winter, water every 6-8 weeks."
    )
    assert logic.parse_schedule(text, "water", 14) == [
        [3, 1, 8, 31, 21], [9, 1, 11, 30, 42], [12, 1, 2, 29, 56],
    ]


def test_month_window_feeding():
    assert logic.parse_schedule("Fertilize every 4-6 weeks from April through August.", "feed", 30) == [
        [4, 1, 8, 31, 42],
    ]


def test_times_a_month_in_spring_and_autumn_only():
    text = "Fertilize 1-2 times a month in spring and autumn."
    assert logic.parse_schedule(text, "feed", 30) == [[3, 1, 5, 31, 15], [9, 1, 11, 30, 15]]


def test_reduce_in_winter_doubles_feeding_interval():
    text = "Fertilize 1-2 times a month in spring and summer; reduce in winter."
    assert logic.parse_schedule(text, "feed", 30) == [[3, 1, 8, 31, 15], [12, 1, 2, 29, 30]]


def test_do_not_feed_in_winter():
    text = "Feed monthly. Do not feed in winter."
    assert logic.parse_schedule(text, "feed", 30) == [[3, 1, 11, 30, 30]]


def test_simple_weekly():
    assert logic.parse_schedule("Water weekly.", "water", 14) == [[1, 1, 12, 31, 7]]


def test_fallback_to_base_when_no_interval():
    assert logic.parse_schedule("Keep the soil lightly moist.", "water", 9) == [[1, 1, 12, 31, 9]]


def test_season_range():
    text = "Fertilize monthly from spring to autumn."
    assert logic.parse_schedule(text, "feed", 30) == [[3, 1, 11, 30, 30]]


def test_southern_hemisphere_shifts_seasons():
    text = "Water every 7 days in spring and summer; every 14 days in autumn and winter."
    assert logic.parse_schedule(text, "water", 14, "south") == [[3, 1, 8, 31, 14], [9, 1, 2, 29, 7]]
    assert logic.parse_schedule(text, "water", 14, "north") == [[3, 1, 8, 31, 7], [9, 1, 2, 29, 14]]


def test_schedule_base_days():
    assert logic.schedule_base_days(70) == 5
    assert logic.schedule_base_days(55) == 7
    assert logic.schedule_base_days(30) == 14
    assert logic.schedule_base_days(None) == 14


def test_period_days_wraps_year_end_and_rest():
    periods = [[3, 1, 11, 30, 10], [12, 1, 2, 29, 28]]
    assert logic.period_days(periods, date(2026, 7, 4)) == 10
    assert logic.period_days(periods, date(2027, 1, 15)) == 28
    assert logic.period_days([[4, 1, 8, 31, 42]], date(2026, 10, 11)) == 0
    assert logic.period_label(periods, date(2027, 1, 15)) == "1 Dec - 29 Feb"


def test_format_and_parse_round_trip():
    periods = [[3, 1, 11, 30, 10], [12, 1, 2, 29, 0]]
    text = logic.format_periods(periods)
    assert text == "1 Mar - 30 Nov: every 10 days\n1 Dec - 29 Feb: rest"
    assert logic.parse_periods(text) == periods


@pytest.mark.parametrize("bad", ["every day", "1 Foo - 3 Mar: 5", "31 Feb - 3 Mar: 5", "1 Mar - 30 Nov"])
def test_parse_periods_rejects_bad_lines(bad):
    with pytest.raises(ValueError):
        logic.parse_periods(bad)


def test_parse_periods_accepts_loose_forms():
    assert logic.parse_periods("1 march to 30 november: 10\n1 dec - 29 feb: rest") == [
        [3, 1, 11, 30, 10], [12, 1, 2, 29, 0],
    ]


def test_zone_status_moisture():
    names = ["dry", "low", "ok", "high", "wet"]
    z = lambda v: logic.zone_status(v, 20, 60, 0, 100, 50, 3, names)  # noqa: E731
    assert [z(5), z(12), z(40), z(65), z(80)] == names
    assert z(None) is None


def _plant(**kw):
    base = {
        "id": "p1", "name": "Fig", "water": [[1, 1, 12, 31, 7]], "feed": [[3, 1, 11, 30, 30]],
        "last_watered": "2026-10-01", "last_fertilised": "2026-10-01",
    }
    base.update(kw)
    return base


def test_compute_ok_and_needs_water_and_feed():
    ok = logic.compute(_plant(last_watered="2026-10-09", last_fertilised="2026-10-09"), None, {}, date(2026, 10, 11))
    assert ok["state"] == "ok"
    assert ok["attributes"]["water_days_left"] == 5
    assert ok["attributes"]["feed_days_left"] == 28
    assert ok["attributes"]["green_finger"] is True

    water = logic.compute(_plant(last_watered="2026-10-01", last_fertilised="2026-10-09"), None, {}, date(2026, 10, 11))
    assert water["state"] == "needs_water"
    assert water["attributes"]["water_status"] == "overdue"

    both = logic.compute(_plant(last_fertilised="2026-09-01"), None, {}, date(2026, 10, 11))
    assert both["state"] == "needs_both"


def test_compute_rest_period_never_overdue():
    res = logic.compute(_plant(feed=[[4, 1, 8, 31, 42]], last_fertilised="2026-01-01"), None, {}, date(2026, 10, 11))
    assert res["attributes"]["feed_status"] == "rest"
    assert res["attributes"]["feed_days_left"] is None
    assert res["state"] != "needs_feed"


def test_compute_sensor_dry_triggers_water():
    plant = _plant(last_watered="2026-10-10", moisture_range=[20, 60])
    res = logic.compute(plant, None, {"moisture": "6", "temperature": "21.5", "battery": "88"}, date(2026, 10, 11))
    assert res["state"] == "needs_water"
    a = res["attributes"]
    assert (a["moisture"], a["temperature"], a["battery"]) == (6.0, 21.5, 88.0)
    assert a["moisture_status"] == "dry"
    assert a["temperature_status"] == "ok"


def test_english_names_language_fallback():
    sp = {"common_names": [
        {"language_code": "en", "name": "Money tree"}, {"language_code": "de", "name": "Glueckskastanie"},
    ]}
    assert logic.english_names(sp, "en") == ["Money tree"]
    assert logic.english_names(sp, "de") == ["Glueckskastanie"]
    assert logic.english_names(sp, "fr") == ["Money tree"]


def test_parse_npk_from_text_and_format():
    assert logic.parse_npk("Use a balanced 10-10-10 fertiliser monthly.") == [10.0, 10.0, 10.0]
    assert logic.parse_npk("NPK 7:9:5") == [7.0, 9.0, 5.0]
    assert logic.parse_npk("Feed monthly in summer") is None
    assert logic.format_npk([20, 10.5, 5]) == "20-10.5-5"
    assert logic.format_npk(None) is None


def test_soil_mix_round_trip_and_validation():
    mix = logic.parse_soil_mix("40% peat\nperlite: 30\n30 bark")
    assert mix == [
        {"name": "peat", "percent": 40}, {"name": "perlite", "percent": 30}, {"name": "bark", "percent": 30},
    ]
    assert logic.parse_soil_mix(logic.format_soil_mix(mix)) == mix
    with pytest.raises(ValueError):
        logic.parse_soil_mix("80% peat\n40% sand")
    with pytest.raises(ValueError):
        logic.parse_soil_mix("lots of grit")


def test_compute_exposes_location_picture_npk_and_soil():
    plant = _plant(
        picture="/api/image/serve/abc/512x512", location="South window", npk=[10, 5, 5],
        soil_mix=[{"name": "perlite", "percent": 30}], soil_notes="gritty",
    )
    sp = {"image_url": "https://example.test/x.jpg", "fertilization": "Use 20-20-20 monthly"}
    a = logic.compute(plant, sp, {}, date(2026, 10, 11), area="Living room")["attributes"]
    assert a["picture"] == "/api/image/serve/abc/512x512"
    assert a["species_picture"] == "https://example.test/x.jpg"
    assert a["user_picture"] is True
    assert a["area"] == "Living room" and a["location"] == "South window"
    assert a["fertiliser_npk"] == [10.0, 5.0, 5.0] and a["fertiliser_npk_label"] == "10-5-5"
    assert a["soil_mix"] == [{"name": "perlite", "percent": 30}]
    # without a custom value the NPK is taken from the species text
    b = logic.compute(_plant(), sp, {}, date(2026, 10, 11))["attributes"]
    assert b["fertiliser_npk"] == [20.0, 20.0, 20.0]
    assert b["picture"] == "https://example.test/x.jpg" and b["user_picture"] is False
