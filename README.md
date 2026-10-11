# The Green Finger

A Home Assistant integration that gives **every plant its own entity** - with watering and
feeding schedules, days left, live soil sensor readings, care tips, ideal fertiliser mix, soil mix,
location and pictures - plus a dashboard card to look after them all.

> Status: early development (0.1.0). Not yet in the HACS default list.

## Features

- **One entity per plant** (`sensor.<plant>`): state is `ok`, `needs_water`, `needs_feed` or
  `needs_both`; everything else is an attribute you can use in templates and automations.
- **Species lookup** from [OpenPlantbook](https://open.plantbook.io): search by name, get the picture,
  ideal soil moisture / temperature, care texts, and a suggested watering and feeding schedule.
- **Detailed schedules**: up to six watering and six feeding periods with any start / end date and
  interval, rest periods, and periods that wrap the year end (for example 1 Dec - 29 Feb).
  Southern hemisphere seasons are handled from your Home Assistant location.
- **Soil sensors**: assign a soil moisture sensor; temperature and battery are found on the same
  device. Live gauges with green / amber / red zones from the ideal ranges, and a dry plant is
  reported as needing water even before its timer is due.
- **Fertiliser and soil**: ideal N-P-K ratio (taken from the care text when it names one) and a
  soil mix made of any parts you like, such as `40% peat`, `30% perlite`, `30% bark`.
- **Location and pictures**: put each plant in a Home Assistant area plus a free-text spot, and use
  your own picture instead of the species one.
- **Native UI**: plants are config subentries - add, edit and delete them from
  *Settings > Devices & services > The Green Finger*, or from the card.
- **Buttons and services** to mark a plant watered or fertilised (also usable from automations).
- A bundled dashboard card, `custom:green-finger-card`, registered automatically.

## Installation

### HACS (custom repository)

1. HACS > three-dot menu > **Custom repositories**.
2. Add `https://github.com/GavC666/ha-green-finger` with category **Integration**.
3. Download **The Green Finger**, then restart Home Assistant.
4. *Settings > Devices & services > Add integration > The Green Finger*.

### Manual

Copy `custom_components/green_finger` into your `config/custom_components` folder and restart.

## Setup

1. Create a free account at [open.plantbook.io](https://open.plantbook.io) and add an API client in
   your profile. Paste the **client ID** and **secret** when you add the integration. Both can be
   left empty if you prefer to enter plants by hand; you can add them later from the integration's
   *Reconfigure* menu.
2. Add plants with **Add plant** on the integration page, or with the card.

## The card

Add a card (any dashboard, in the UI editor under *Custom: The Green Finger*, or in YAML):

```yaml
type: custom:green-finger-card
title: Plants          # optional
icon: mdi:sprout       # optional
```

It lists every plant with vertical LED gauges (watering, fertilising, moisture, temperature),
battery and sensor name, quick *watered* / *fertilised* buttons, a care & tips pop-up, filters for
plants that need water or feeding, and add / edit forms with species search, period editors, own
picture upload (uses Home Assistant's `image_upload`), N-P-K, soil mix and location.

## Entity attributes

| Attribute | Meaning |
|---|---|
| `water_days_left`, `feed_days_left` | Days until due (negative = overdue, `null` = rest period) |
| `water_status`, `feed_status` | `ok`, `due`, `overdue`, `rest`, `unknown` |
| `next_water`, `next_feed` | Dates |
| `water_schedule`, `feed_schedule` | Periods `[start_month, start_day, end_month, end_day, days]` |
| `moisture`, `temperature`, `battery`, `sensor_name` | From the assigned sensor |
| `moisture_status`, `temperature_status` | Zone words such as `dry`, `ok`, `high` |
| `ideal_moisture`, `ideal_temperature` | `[min, max]` |
| `fertiliser_npk`, `fertiliser_npk_label`, `fertiliser_name` | Ideal fertiliser |
| `soil_mix`, `soil_notes` | Soil mix parts and notes |
| `area`, `location`, `inside` | Where the plant lives |
| `picture`, `species_picture`, `user_picture` | Picture in use |
| `care` | OpenPlantbook care texts (watering, fertilization, sunlight, soil, pruning, origin ...) |

## Services

`green_finger.water`, `green_finger.fertilise` (target a plant entity, optional `date`),
`green_finger.update_plant`, `green_finger.remove_plant`, `green_finger.add_plant`,
`green_finger.search_species`, `green_finger.get_species`, `green_finger.refresh_species`.
See the *Developer tools > Actions* page for the fields.

### Example: notify when a plant needs water

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

## Development

```bash
pip install -r requirements_test.txt   # needs Python 3.14 for current Home Assistant
pytest
```

`tests/test_logic.py` covers the pure schedule logic and runs on any Python 3.

## Credits and data

Species data comes from [OpenPlantbook](https://open.plantbook.io) - please follow their terms and
attribution rules. This project is not affiliated with OpenPlantbook.

## License

MIT
