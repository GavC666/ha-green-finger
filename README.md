<p align="center">
  <img src="https://raw.githubusercontent.com/GavC666/ha-green-finger/main/custom_components/green_finger/brand/logo@2x.png" width="170" alt="The Green Finger logo">
</p>

# The Green Finger

**Look after every plant from Home Assistant.** Each plant gets a card that shows when it was last
watered, when it needs water or feeding next, and what its soil sensor says. One tap records "I watered it".

<p align="center">
  <img src="https://raw.githubusercontent.com/GavC666/ha-green-finger/main/docs/img/overview.png" alt="Large plant cards with gauges on a computer screen">
</p>

> **Early development - a personal project, shared as it is.** Issues and discussions are switched off,
> there is no support, and things may change. Please back up before you update.

## Contents

1. [What it does](#what-it-does)
2. [What you need](#what-you-need)
3. [Install](#install)
4. [Get your free OpenPlantbook key](#get-your-free-openplantbook-key)
5. [Set up in Home Assistant](#set-up-in-home-assistant)
6. [Put the plants on a dashboard](#put-the-plants-on-a-dashboard)
7. [Add your first plant](#add-your-first-plant)
8. [Using it every day](#using-it-every-day)
9. [Get a message when a plant needs care](#get-a-message-when-a-plant-needs-care)
10. [Good to know](#good-to-know)
11. [Update, remove, back up](#update-remove-back-up)
12. [Troubleshooting](#troubleshooting)
13. [For tinkerers](#for-tinkerers)

## What it does

- **A card for every plant** with the last watering, the days left until the next watering and
  feeding, and live soil moisture, temperature and battery when you have a soil sensor.
- **Finds your plant for you.** Search by name, pick the species and the picture, ideal conditions, care
  tips and a watering and feeding plan are filled in from [OpenPlantbook](https://open.plantbook.io).
- **Two sizes.** *Large* with gauges, or *compact* with one slim row per plant.
- **Works on a phone, a tablet and a computer.**
- **Optional:** mark a plant as watered automatically when its soil sensor shows it was watered.

## What you need

| | |
|---|---|
| **Home Assistant 2025.7 or newer** | with [HACS](https://hacs.xyz) installed |
| **A free OpenPlantbook account** | to look species up by name (optional - you can type everything in yourself) |
| **A soil moisture sensor** | one per plant, optional - without it the plant follows its watering plan |

## Install

1. In Home Assistant open **HACS**.
2. Press the **three dots** at the top right and choose **Custom repositories**.
3. Paste `https://github.com/GavC666/ha-green-finger`, set the type to **Integration** and press **Add**.
4. Search for **The Green Finger** in HACS, open it and press **Download**.
5. **Restart Home Assistant** (*Settings > System*, power button at the top right > *Restart Home Assistant*).

<details>
<summary>Without HACS (manual install)</summary>

1. Download this page as a ZIP (green **Code** button > *Download ZIP*) and unzip it.
2. Copy the folder `custom_components/green_finger` into the `custom_components` folder of your Home
   Assistant (create it if it is not there).
3. Restart Home Assistant.
</details>

## Get your free OpenPlantbook key

OpenPlantbook is a free community database of plants. You need a **client ID** and a **secret** from it
so the integration may look species up. (Skip this if you want to enter every plant by hand.)

1. Go to <https://open.plantbook.io/register/> and create an account, or sign in with Google or GitHub.
   Confirm your e-mail address if it asks you to.
2. Log in and open <https://open.plantbook.io/apikey/show/> (the **API key** page).
3. If no key is shown yet, press the button to create one.
4. Copy the **Client ID** and the **Secret**. Keep the secret to yourself.

## Set up in Home Assistant

1. Open *Settings > Devices & services* and press **Add integration**.
2. Search for **The Green Finger** and select it.
3. Paste the **Client ID** and the **Secret** (or leave both empty) and press **Submit**.

That is all. You can change the key later with the three dots on the integration > **Reconfigure**.

## Put the plants on a dashboard

1. Open the dashboard you want, press the pencil (**Edit**) and then **Add card**.
2. Search for **The Green Finger** and pick it.
3. Give it a title and choose the **Card size**: *Large* or *Compact*. Press **Save**.

If the card says *Custom element doesn't exist*, reload the page (`Ctrl+F5`, or pull down on a phone).

There are two cards:

| Card | Use it for |
|---|---|
| **The Green Finger** | all your plants in one card, with the *Add plant* button and filters |
| **The Green Finger - one plant** | a single plant that you can place and resize anywhere on a dashboard |

## Add your first plant

Press **Add plant** on the card.

<p align="center">
  <img src="https://raw.githubusercontent.com/GavC666/ha-green-finger/main/docs/img/add.png" alt="Adding a plant on a phone" width="760">
</p>

1. **Find the species** (optional). Type a name such as *monstera* or *marigold* and pick it from the
   list. The name, picture, watering plan, feeding plan and ideal ranges fill in by themselves.
2. **The plant.** Give it a name, choose the room and the spot in the room, and say whether it lives
   inside or outside. Add a photo with **Take photo** or **Choose file**.
3. **Soil sensor** (optional). Pick the soil moisture sensor that belongs to this plant. A sensor can
   belong to one plant only.
4. Open the sections underneath if you want to change something - they are all optional:

   | Section | What is in it |
   |---|---|
   | **Care schedule** | when you last watered and fed it, and how often it needs water and feeding through the year |
   | **Ideal ranges** | the soil moisture and temperature the plant likes (these colour the gauges) |
   | **Fertiliser and soil** | the N-P-K numbers, the fertiliser you use and what the soil is made of |
   | **Notes** | anything you want to remember |

5. Press **Save**. The plant appears on the card straight away.

Change a plant later with its **cog** button (large cards) or from the information window (compact cards).
The **Delete this plant** button is at the bottom of that window and asks you to confirm.

## Using it every day

### The buttons

| Button | What it does |
|---|---|
| Watering can | "I watered it today" - starts the watering count again |
| Sack | "I fed it today" |
| **i** | Opens the information window (see below). On a compact card you can also tap the plant's row. |
| Cog (large cards) | Change the plant |

### Large or compact

<p align="center">
  <img src="https://raw.githubusercontent.com/GavC666/ha-green-finger/main/docs/img/sizes.png" alt="The large card next to the compact card on a phone" width="760">
</p>

- **Large** shows gauges: how many days are left, and where the soil moisture and temperature sit
  between too dry or cold (red), a little off (amber) and just right (green).
- **Compact** shows the same facts as one slim row per plant - days until watering and feeding,
  moisture, temperature and battery - and takes a fraction of the room.

Choose the size in the card settings, or press the small switch next to the filters to change it at
once. The switch remembers your choice on that phone, tablet or computer.

### The information window

Press **i** to see everything about a plant. Choose what you want to look at:

<p align="center">
  <img src="https://raw.githubusercontent.com/GavC666/ha-green-finger/main/docs/img/info.png" alt="The information window: My plant and OpenPlantbook" width="760">
</p>

- **My plant** is everything you and the card know: the care plan and next dates, the live sensor values,
  where the plant lives, fertiliser and soil, your notes and the full schedules.
- **OpenPlantbook** is what the plant database says about the species: ideal conditions and care tips.
  It is **saved in Home Assistant the first time**, so opening it again costs nothing.
  Press **Refresh** only if you want the newest information.

### Not today? Postpone

In **My plant** there are *Postpone watering* and *Postpone feeding* buttons (**+1 day**, **+3 days**,
**+1 week**). The next date moves back; press them again to add more. Recording the next watering or feeding
sets it right again.

### Filters

**Needs water** and **Needs feeding** at the top of the card show only the plants that need it. A plant
needs water when its timer is due or when its soil sensor reads dry.

### Marked as watered automatically (optional)

When you pick a soil sensor, a switch appears: **Mark as watered automatically when the soil gets much
wetter**. With it on, a jump of 10 points or more in the soil moisture is recorded as a watering today.
It is off until you switch it on.

## Get a message when a plant needs care

The integration adds one more sensor, **Plants needing care**, under *The Green Finger*. Its value is how
many plants need water or feeding right now, and it lists their names. It is handy for a badge on a
dashboard, and for a message on your phone each morning:

```yaml
alias: Plants need care
triggers:
  - trigger: time
    at: "08:00:00"
conditions:
  - condition: numeric_state
    entity_id: sensor.the_green_finger_plants_needing_care
    above: 0
actions:
  - action: notify.notify        # replace with your own notify service
    data:
      message: >-
        Plants that need care:
        {{ state_attr('sensor.the_green_finger_plants_needing_care', 'plants') | join(', ') }}
```

(Create it in *Settings > Automations & scenes > Create automation > three dots > Edit in YAML*.)
The sensor can be switched off like any other entity if you do not want it.

## Good to know

- **The camera.** *Take photo* shows a live camera only when Home Assistant is opened through an `https://`
  address (your Nabu Casa link, for example). On plain `http://` addresses, such as
  `http://homeassistant.local:8123`, the browser does not allow it and the phone's own photo chooser
  opens instead. *Choose file* works everywhere.
- **OpenPlantbook limits.** The free account allows a limited number of requests. The integration is
  careful: a search is one request, a species is downloaded once and then kept, and after a "too many
  requests" answer it waits as long as it was asked to. Everything already saved keeps working.
  The limit belongs to your client ID, so anything else that uses the same key shares it.
- **Where things are kept.** Your plants are part of Home Assistant's own settings and are in every
  backup. The species data downloaded from OpenPlantbook is kept in Home Assistant's storage. Photos
  you add are kept by Home Assistant's *Image upload*, which is part of the standard setup.
- **Privacy.** OpenPlantbook receives the text you search for and the species you open, with your client
  ID. If a name finds nothing, the text is also sent to [GBIF](https://www.gbif.org), a public
  biodiversity database, to find the Latin name. Nothing else leaves your Home Assistant.
- **Thanks.** Species data comes from [OpenPlantbook](https://open.plantbook.io). Please follow their
  terms. This project is not connected to OpenPlantbook.

## Update, remove, back up

- **Update:** HACS shows an update when a new version is published. Press **Update**, then restart
  Home Assistant and reload your browser page.
- **Remove a plant:** open it on the card, press the cog (or **Edit plant**) and **Delete this plant**.
- **Remove the integration:** *Settings > Devices & services > The Green Finger > three dots > Delete*,
  then remove it in HACS.
- **Back up:** nothing extra to do. Plants are part of every normal Home Assistant backup.

## Troubleshooting

| What you see | What to try |
|---|---|
| The card says *Custom element doesn't exist* | Reload the page (`Ctrl+F5`). Make sure Home Assistant was restarted after installing. |
| Searching says the key was rejected | Copy the client ID and secret again from <https://open.plantbook.io/apikey/show/> and use **Reconfigure** on the integration. |
| Searching says it is limiting requests | Wait the time the message gives. Plants you already added keep working. |
| A search finds nothing | Try the Latin name, or a shorter name. OpenPlantbook may not list the plant; you can still add it by hand. |
| A sensor is greyed out in the list | It belongs to another plant. A sensor can belong to one plant only. |
| No temperature or battery shown | The soil sensor's device needs enabled temperature and battery sensors. |
| *Needs water* but the timer looks fine | The soil sensor reads dry or low. Check the *Ideal ranges* of the plant. |
| Take photo opens a photo chooser | Home Assistant is opened over `http://`. See [Good to know](#good-to-know). |

For more detail: *Settings > System > Logs* (search for `green_finger`). The integration page also has a
**Download diagnostics** entry; your key is removed from it.

## For tinkerers

<details>
<summary>Schedules in text form</summary>

A schedule is a list of periods, one per line:

```text
1 Mar - 30 Nov: every 10 days
1 Dec - 29 Feb: rest
```

- `every N days` or just `N`; `rest` means a pause.
- Dates are day and month (the year is ignored), so a period repeats every year, and it may run over the
  new year (`1 Dec - 29 Feb`). Use `29 Feb` as the last day of February.
- Outside every period the plant rests: nothing is due and nothing is overdue.
- Up to six periods each for watering and feeding.
- The plan suggested for a species is read from its care text ("every 2-3 weeks in spring and summer",
  "1-2 times a month", "reduce in winter" ...); the upper end of a range is used. Check it once.
</details>

<details>
<summary>Entities</summary>

For a plant called *Weeping Fig*:

| Entity | What |
|---|---|
| `sensor.weeping_fig` | State `ok`, `needs_water`, `needs_feed` or `needs_both`; the details are attributes |
| `button.weeping_fig_water` | Mark as watered today |
| `button.weeping_fig_fertilise` | Mark as fed today |
| `sensor.the_green_finger_plants_needing_care` | Number of plants needing water or feeding, with their names |

Each plant is a device, so it can be given an area from its device page.
</details>

<details>
<summary>Attributes of a plant sensor</summary>

| Attribute | Meaning |
|---|---|
| `water_days_left`, `feed_days_left` | Days until due (negative = overdue, empty = resting) |
| `water_status`, `feed_status` | `ok`, `due`, `overdue`, `rest`, `unknown` |
| `water_interval`, `feed_interval` | Days between actions now (0 = resting) |
| `next_water`, `next_feed`, `last_watered`, `last_fertilised` | Dates |
| `water_postponed_days`, `feed_postponed_days` | Days added with *Postpone* |
| `water_period`, `feed_period` | The period in force, such as `1 Mar - 30 Nov` |
| `water_schedule`, `feed_schedule` | `[start month, start day, end month, end day, days]` |
| `moisture`, `temperature`, `battery`, `sensor_name`, `moisture_entity` | From the soil sensor |
| `moisture_status`, `temperature_status` | `dry` `low` `ok` `high` `wet`, `cold` `cool` `ok` `warm` `hot` |
| `ideal_moisture`, `ideal_temperature` | `[min, max]` |
| `fertiliser_npk`, `fertiliser_npk_label`, `fertiliser_name` | For example `[10, 10, 10]` and `10-10-10` |
| `soil_mix`, `soil_notes`, `notes` | Soil parts, soil notes, your notes |
| `area`, `location`, `inside` | Where it lives |
| `display_name`, `plant_name`, `common_name`, `species`, `species_name`, `species_alias`, `common_names` | Names |
| `species_saved_on` | The day its OpenPlantbook data was saved |
| `picture`, `species_picture`, `user_picture` | The picture in use, the species picture, whether yours is used |
| `auto_watered` | Whether *Mark as watered automatically* is on |
| `plant_id` | The plant's ID |

The attributes are not written to the Home Assistant history database; only the state is.
</details>

<details>
<summary>Actions (services)</summary>

Try them in *Developer tools > Actions*; every field is described there.

| Action | Target | What it does |
|---|---|---|
| `green_finger.water` | plant sensor | Record a watering (optional `date`) |
| `green_finger.fertilise` | plant sensor | Record a feeding (optional `date`) |
| `green_finger.postpone` | plant sensor | Move the next watering or feeding back (`kind`: `water` / `feed`, `days`) |
| `green_finger.update_plant` | plant sensor | Change any detail; only the fields you send change |
| `green_finger.remove_plant` | plant sensor | Delete the plant |
| `green_finger.add_plant` | - | Create a plant (the plan defaults from `species`) |
| `green_finger.search_species` | - | Search OpenPlantbook (returns the matches) |
| `green_finger.get_species` | - | The saved species record and the suggested plan (`refresh: true` asks OpenPlantbook again) |
| `green_finger.refresh_species` | - | Download the species data again |

Add a plant from a script:

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
</details>

<details>
<summary>Card options in YAML</summary>

```yaml
type: custom:green-finger-card
title: Plants
size: compact        # large (default) or compact
columns: 2           # a fixed number of columns; leave out for automatic
min_width: 380       # automatic columns: the narrowest a plant may get, in px
sort: urgency        # name (default) or urgency = needs water / feeding first
```

```yaml
type: custom:green-finger-plant-card
entity: sensor.weeping_fig
size: large          # or compact
```
</details>

<details>
<summary>Development</summary>

```bash
pip install -r requirements_test.txt   # Python 3.14, as current Home Assistant needs
pytest                                  # integration tests (Linux or macOS)
cd tests/js && npm install && npm test  # card tests
```

`tests/test_logic.py` (schedule logic) runs on any Python 3. `docs/demo/index.html` shows the card with
made-up plants, without Home Assistant (`?scene=list-large&theme=dark`; see the comment at the top of the file).
</details>

## Licence

MIT
