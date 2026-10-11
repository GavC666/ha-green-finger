# The Green Finger

A Home Assistant integration that gives **every plant its own entity** - with watering and
feeding schedules, days left, live soil sensor readings, care tips, ideal fertiliser mix, soil mix,
location and pictures - plus a dashboard card to look after them all.

> **Early development - personal project, no support.** This is an unfinished 0.1.0 shared as-is.
> Issues and discussions are switched off for now and it may change or break without notice.
> It has had limited testing and is not in the HACS default list.

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Get your OpenPlantbook API credentials](#get-your-openplantbook-api-credentials)
- [Set up the integration](#set-up-the-integration)
- [Add your plants](#add-your-plants)
- [Assign a soil sensor](#assign-a-soil-sensor)
- [Schedules explained](#schedules-explained)
- [The dashboard card](#the-dashboard-card)
- [Entities and attributes](#entities-and-attributes)
- [Services and automations](#services-and-automations)
- [Updating, removing, backing up](#updating-removing-backing-up)
- [Troubleshooting](#troubleshooting)
- [Privacy and data](#privacy-and-data)
- [Development](#development)

## Features

- **One entity per plant** (`sensor.<plant>`): the state is `ok`, `needs_water`, `needs_feed` or
  `needs_both`; everything else is an attribute you can use in templates and automations.
- **Species lookup** from [OpenPlantbook](https://open.plantbook.io): search by name, get the picture,
  ideal soil moisture and temperature, care texts and a suggested watering and feeding schedule.
- **Detailed schedules**: up to six watering and six feeding periods with any start and end date and
  interval, rest periods, and periods that wrap the year end (for example 1 Dec - 29 Feb).
  Southern hemisphere seasons are handled from your Home Assistant location.
- **Soil sensors**: assign a soil moisture sensor; temperature and battery are found on the same
  device. Live gauges with green / amber / red zones from the ideal ranges. A dry plant is
  reported as needing water even before its timer is due.
- **Fertiliser and soil**: ideal N-P-K ratio (taken from the care text when it names one) and a
  soil mix made of any parts you like, such as `40% peat`, `30% perlite`, `30% bark`.
- **Location and pictures**: put each plant in a Home Assistant area plus a free-text spot, and use
  your own picture instead of the species one.
- **Native UI**: plants are config subentries - add, edit and delete them from
  *Settings > Devices & services > The Green Finger*, or from the card.
- **Buttons and services** to mark a plant watered or fertilised, also usable from automations.
- A bundled dashboard card, `custom:green-finger-card`, registered automatically.

## Requirements

- Home Assistant **2025.7** or newer.
- A free [OpenPlantbook](https://open.plantbook.io) account for species search (optional - you can
  enter plants by hand without it).
- Optional: a soil moisture sensor per plant (any entity with device class *moisture*).
- Optional: Home Assistant's `image_upload` integration for uploading your own pictures (it is part of
  the default Home Assistant setup).

## Installation

### With HACS (custom repository)

1. Install [HACS](https://hacs.xyz) if you have not already.
2. In HACS open the three-dot menu (top right) and choose **Custom repositories**.
3. Paste `https://github.com/GavC666/ha-green-finger`, set the type to **Integration** and press **Add**.
4. Find **The Green Finger** in HACS, open it and press **Download**.
5. **Restart Home Assistant** (*Settings > System > Restart*).

### Manually

1. Download this repository (green *Code* button > *Download ZIP*) and unzip it.
2. Copy the folder `custom_components/green_finger` into the `custom_components` folder of your
   Home Assistant configuration (create `custom_components` if it does not exist), so you end up with
   `config/custom_components/green_finger/manifest.json`.
3. **Restart Home Assistant.**

## Get your OpenPlantbook API credentials

OpenPlantbook is a free community database of plant species. The integration uses it to search
species and download pictures, ideal ranges and care texts. You need a **client ID** and a
**client secret**:

1. Go to <https://open.plantbook.io/register/> and create an account (or press the *Google* /
   *GitHub* button on the [login page](https://open.plantbook.io/login/) to sign in with those).
   Confirm your e-mail address if asked.
2. Log in and open <https://open.plantbook.io/apikey/show/> (the **API key** page; it is also in the
   site menu after you log in).
3. If the page shows no key yet, press the button to generate one.
4. Copy the **Client ID** and the **Secret** shown there. Keep the secret private.

Notes:

- Free accounts have a daily request limit. A search fetches the details of the top results (so the
  picture and ranges can be shown), and everything fetched is cached in Home Assistant, so searching
  the same plants again costs nothing.
- Credentials are optional. Without them you add plants by hand and every field still works; you
  just do not get the species search, picture and suggested schedules.

## Set up the integration

1. *Settings > Devices & services > **Add integration***, search for **The Green Finger** and select it.
2. Paste the OpenPlantbook **Client ID** and **Secret** (or leave both empty to work without species
   lookup). The credentials are checked against OpenPlantbook straight away.
3. Press **Submit**. The integration is created with no plants yet.

You can change or remove the credentials later: *Settings > Devices & services > The Green Finger >
three-dot menu > Reconfigure*.

## Add your plants

There are two equivalent ways; both create the same plants.

### From the integration page

1. *Settings > Devices & services > The Green Finger*.
2. Press **Add plant** (next to *Plant*).
3. **Find the species** - type the Latin name (OpenPlantbook mostly uses Latin names, for example
   `monstera deliciosa`) and submit; leave it empty to enter everything by hand. Pick the species
   from the list; the name, schedules, ranges and N-P-K are prefilled from it.
4. **Plant details** - check the name and common name, choose the room (a Home Assistant area), the
   spot in the room, when you last watered and fertilised, the moisture sensor and the ideal ranges.
   Open *Fertiliser and soil mix* for N-P-K, fertiliser product, soil mix and soil notes.
5. **Schedule** - one period per line, see [Schedules explained](#schedules-explained). Submit.

To change a plant later, open it on the integration page and press the cog next to the plant >
**Reconfigure**.

### From the dashboard card

Press **Add plant** on the card and fill the form in. It offers the same fields, plus uploading your
own picture. See [The dashboard card](#the-dashboard-card).

## Assign a soil sensor

Choose the soil moisture sensor in the plant's details (*Soil moisture sensor*). Once assigned:

- the card shows live moisture, temperature and battery, with the sensor's name;
- the **ideal moisture** and **ideal temperature** ranges (prefilled from the species, editable)
  control the green zone of the gauges, with an amber margin and red beyond;
- if the soil reads *dry* or *low* the plant is reported as `needs_water` even if its timer is not
  due, and the watering timer continues to run so you still see the days left.

Temperature and battery are looked up from the other sensors on the same device as the moisture
sensor, so use a sensor that belongs to a device (as Zigbee, Bluetooth and Wi-Fi sensors do).

## Schedules explained

A schedule is a list of periods. Each period has a start date, an end date and a number of days
between actions. In the config flow and the services one period is one line:

```text
1 Mar - 30 Nov: every 10 days
1 Dec - 29 Feb: every 28 days
```

- `every N days` or just `N` both work; use `rest` for a pause (`1 Dec - 29 Feb: rest`).
- Dates are day and month; the year is ignored, so a period repeats every year.
- A period may wrap the year end (`1 Dec - 29 Feb`).
- Outside every period the plant is at rest: no due date, never overdue.
- Up to six periods each for watering and feeding. Use `29 Feb` as the last day of February.
- The suggested schedule from OpenPlantbook is read from its care text (spring / summer / autumn /
  winter, month ranges such as "April through August", "every 2-3 weeks", "1-2 times a month",
  "reduce in winter"). The upper end of a range is used. It is a suggestion - always check it.

## The dashboard card

The card is bundled with the integration and registered automatically (no manual resource needed).
After installing, **reload the browser page** (hard refresh, `Ctrl+F5`) so the new card is loaded.

Add it to a dashboard:

1. Edit the dashboard > **Add card** > search for *The Green Finger* (under custom cards), or
   choose **Manual** and paste:

   ```yaml
   type: custom:green-finger-card
   title: Plants          # optional
   icon: mdi:sprout       # optional
   ```

2. Save. Every plant of the integration appears automatically.

What the card gives you:

- a card per plant with vertical LED gauges for watering, fertilising, soil moisture and temperature;
- battery level and sensor name in the top right, the plant picture with a status ring;
- quick buttons: *watered*, *fertilised*, *care & tips*, *edit* (cog) and *delete*;
- the care pop-up with ideal ranges, N-P-K, soil mix, schedules, OpenPlantbook care tips and your notes;
- filters **Only plants needing water** and **Only plants needing fertiliser**;
- **Add plant** and edit forms with species search, period editors, sensor, room, own picture upload,
  N-P-K, soil mix and notes.

## Entities and attributes

For a plant called *Weeping Fig* you get:

| Entity | Purpose |
|---|---|
| `sensor.weeping_fig` | State `ok` / `needs_water` / `needs_feed` / `needs_both` plus all attributes below |
| `button.weeping_fig_water` | Marks the plant watered today |
| `button.weeping_fig_fertilise` | Marks the plant fertilised today |

Each plant is also a device, so you can give it an area from the device page.

| Attribute | Meaning |
|---|---|
| `water_days_left`, `feed_days_left` | Days until due (negative = overdue, `null` = rest period) |
| `water_status`, `feed_status` | `ok`, `due`, `overdue`, `rest`, `unknown` |
| `water_interval`, `feed_interval` | Current interval in days (0 = rest) |
| `next_water`, `next_feed` | Dates |
| `last_watered`, `last_fertilised` | Dates |
| `water_period`, `feed_period` | Label of the current period, such as `1 Mar - 30 Nov` |
| `water_schedule`, `feed_schedule` | Periods `[start_month, start_day, end_month, end_day, days]` |
| `moisture`, `temperature`, `battery`, `sensor_name`, `moisture_entity` | From the assigned sensor |
| `moisture_status`, `temperature_status` | Zone words such as `dry`, `low`, `ok`, `high`, `wet`, `cold`, `hot` |
| `ideal_moisture`, `ideal_temperature` | `[min, max]` |
| `fertiliser_npk`, `fertiliser_npk_label`, `fertiliser_name` | Ideal fertiliser, for example `[10, 10, 10]` and `10-10-10` |
| `soil_mix`, `soil_notes` | Soil mix parts and notes |
| `area`, `location`, `inside` | Where the plant lives |
| `display_name`, `plant_name`, `common_name`, `species`, `species_name`, `species_alias`, `common_names` | Names |
| `picture`, `species_picture`, `user_picture` | Picture in use, the species one, and whether yours is used |
| `care` | OpenPlantbook care texts (watering, fertilization, sunlight, soil, pruning, origin ...) |
| `notes`, `plant_id` | Your notes, and the plant's ID for services |

## Services and automations

Use *Developer tools > Actions* to try them; all fields are described there.

| Action | Target | What it does |
|---|---|---|
| `green_finger.water` | a plant sensor | Record watering (optional `date`) |
| `green_finger.fertilise` | a plant sensor | Record fertilising (optional `date`) |
| `green_finger.update_plant` | a plant sensor | Change any detail; only the fields you send change |
| `green_finger.remove_plant` | a plant sensor | Delete the plant |
| `green_finger.add_plant` | - | Create a plant (schedules default from `species`) |
| `green_finger.search_species` | - | Search OpenPlantbook, returns matches (response) |
| `green_finger.get_species` | - | Species record and suggested schedule (response) |
| `green_finger.refresh_species` | - | Download species data again |

### Examples

Notify when a plant needs water:

```yaml
automation:
  - alias: Plant needs water
    triggers:
      - trigger: state
        entity_id: sensor.weeping_fig
        to: needs_water
    actions:
      - action: notify.mobile_app_phone
        data:
          message: "{{ trigger.to_state.attributes.display_name }} needs water"
```

Mark a plant watered when its moisture jumps (for example after you water it):

```yaml
automation:
  - alias: Weeping fig watered
    triggers:
      - trigger: numeric_state
        entity_id: sensor.soil_moisture_sensor_3_soil_moisture
        above: 40
    conditions:
      - condition: state
        entity_id: sensor.weeping_fig
        state: needs_water
    actions:
      - action: green_finger.water
        target:
          entity_id: sensor.weeping_fig
```

Add a plant from a script with your own schedule:

```yaml
action: green_finger.add_plant
data:
  name: Aloe
  inside: true
  water: |
    1 Mar - 30 Nov: every 14 days
    1 Dec - 29 Feb: rest
  npk: [5, 10, 10]
  soil_mix: |
    50% sand
    50% peat
```

## Updating, removing, backing up

- **Update (HACS):** HACS shows an update when a new release is published; press *Update* and restart
  Home Assistant. **Manual:** replace the `green_finger` folder and restart.
- **Remove a plant:** the card's delete button, or *Settings > Devices & services > The Green
  Finger*, the plant's cog > **Delete**.
- **Remove the integration:** *Settings > Devices & services > The Green Finger > three-dot menu >
  Delete*, then remove the folder (HACS: *Remove*).
- **Backups:** plants are stored in Home Assistant's config entries (included in every normal
  backup); downloaded species data is cached in `.storage/green_finger.species`. Pictures you upload
  are stored by Home Assistant's image upload and are also in backups.

## Troubleshooting

| Problem | What to try |
|---|---|
| The card shows *Custom element doesn't exist* | Hard refresh the browser (`Ctrl+F5`); make sure the integration is set up and Home Assistant was restarted after installing |
| Species search says *invalid authentication* | Re-copy the client ID and secret from <https://open.plantbook.io/apikey/show/>, then *Reconfigure* the integration |
| Search finds nothing | Use the Latin name (`ficus benjamina`, not "weeping fig"); try fewer letters |
| *Rate limiting* error | The daily OpenPlantbook limit was reached; wait and retry. Already searched species are cached |
| No picture upload on the card | Home Assistant's `image_upload` integration must be enabled (it is in `default_config`) |
| Temperature / battery missing | The moisture sensor's device must also have temperature / battery sensors that are enabled |
| Plant reads *needs water* with a green timer | The assigned soil sensor reads dry or low - check the ideal moisture range |
| Entity ID differs from the examples | IDs follow the plant name; check *Settings > Devices & services > Entities* |

Useful logs: *Settings > System > Logs*, search for `green_finger`. Diagnostics can be downloaded
from the integration page (credentials are redacted).

## Privacy and data

- OpenPlantbook receives only the search text and the species ID you look up, together with your
  client ID.
- Everything else (your plants, dates, schedules, sensors) stays in your Home Assistant.

## Development

```bash
pip install -r requirements_test.txt   # needs Python 3.14 for current Home Assistant
pytest
```

`tests/test_logic.py` covers the pure schedule logic and runs on any Python 3. The integration tests
in `tests/test_integration.py` need `pytest-homeassistant-custom-component`.

## Credits and data

Species data comes from [OpenPlantbook](https://open.plantbook.io) - please follow their terms and
attribution rules. This project is not affiliated with OpenPlantbook.

## License

MIT
