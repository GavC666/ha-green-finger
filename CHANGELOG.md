# Changelog

## 0.2.1
- Fix: the daily recalculation at 00:01 (days left, due dates) was run by Home Assistant in a worker thread and
  refused with a thread-safety error, so plants only updated when a sensor reported. It now runs in the event
  loop. (The error was visible in the Home Assistant log since the first releases.)

## 0.2.0

### New
- **Two card sizes.** *Large* (as before) and *Compact*: one slim row per plant with no gauges - days until
  watering and feeding, moisture, temperature and battery as small coloured chips. Choose it in the card
  settings (`size: compact`) or with the switch next to the filters (remembered on each device). Both the
  list card and the one-plant card have it.
- **Information window with two tabs.** *My plant* shows everything the card knows - care plan and next
  dates, live sensor values, place, fertiliser and soil, your notes and the schedules. *OpenPlantbook* shows
  the saved species record: ideal conditions and care tips, the day it was saved and a **Refresh** button.
- **OpenPlantbook data is saved once** in Home Assistant's storage and read from there; OpenPlantbook is
  asked again only when nothing is saved yet or when you press Refresh. A failed refresh (rate limit,
  rejected key, no connection) is now reported instead of being ignored. New attribute `species_saved_on`.
- **Postpone** watering or feeding by 1 day, 3 days or a week (action `green_finger.postpone`); recording
  the next watering or feeding resets it.
- **Mark as watered automatically** (optional, per plant): a jump of 10 points or more in the assigned soil
  sensor records a watering today.
- **Plants needing care** sensor: how many plants need water or feeding, with their names - for badges and
  notifications.
- The form to change a plant can search for a species too; picking one keeps your name, schedule and ranges
  until you press *Fill from OpenPlantbook data*.

### Changed
- Add / edit form: the essentials first (species search, name, room, spot, sensor), then collapsible sections
  with a one-line summary (*Care schedule*, *Ideal ranges*, *Fertiliser and soil*, *Notes*). Save and Cancel
  stay in view, the window keeps its scroll position, mistakes are shown in the form instead of a browser
  pop-up, and *Delete this plant* moved into the edit window with a confirmation step.
- The plant form of the integration page (*Settings > Devices & services*) has the same order: essentials,
  then collapsed *More details*, *Ideal ranges* and *Fertiliser and soil* sections.
- The buttons on a large card are now watered, fed, information and edit; compact cards open the information
  window when the row is tapped.
- README rewritten for non-technical readers, with pictures.
- The integration is classed as `calculated` (it does not poll anything).

### Removed
- The `care` attribute (the OpenPlantbook care texts) is gone from the plant sensor: it duplicated saved data
  in every state update. The texts are in the information window and in the response of
  `green_finger.get_species`.

### Efficiency and fixes
- Plant attributes are no longer written to the history database - only the state is. Less disk and less work.
- One shared midnight timer instead of one per plant; sensor, device and registry lookups are cached and only
  redone when something relevant changes; changes to one plant no longer recompute the others.
- The card finds its plants when the entity registry changes instead of scanning every entity on every
  update, and redraws only the plants that changed.
- A species being downloaded is shared by everything that asks for it; one that OpenPlantbook does not know
  is not asked for again for six hours; downloaded data is written to disk before a reload.
- Answers that are not JSON, and a "forbidden" answer, are handled and reported readably.
- A plant name made only of spaces is refused with a message instead of an error.
- Overdue gauges of different plants no longer share animation names.

## 0.1.5
- OpenPlantbook rate limit: after a "too many requests" answer nothing more is sent until the wait the
  API asked for is over, and the message says how long to wait.
- README: the in-page camera needs https; OpenPlantbook request limits explained.

## 0.1.4
- Search: one request per search (details are fetched only for the species you pick), so OpenPlantbook is
  not rate limited; results are cached for ten minutes.
- Search: common names such as "marigold" work - when OpenPlantbook has no match the matching genera are
  found through GBIF and searched; a note says so.
- Add form: a spinner while searching and loading; after choosing, the list collapses into a single row
  you can open again; the button reads "Fill from OpenPlantbook data".
- Take photo opens an in-page camera where the browser allows it (https), otherwise the device picker.
- Readable messages for rate limit, bad credentials and connection problems.

## 0.1.3
- Fix: clicks inside the add / edit / care pop-ups did nothing (choosing a species, Save, add period ...).
- A soil sensor can belong to one plant only: it is greyed out for other plants and rejected by the forms and services.
- Own picture: take a photo with the device camera or choose an existing file.
- Layout: the plants list wraps into columns (`columns`, `min_width`, `sort` options) and every plant can also
  be placed on its own with `custom:green-finger-plant-card`, so it can be moved around the dashboard.

## 0.1.2
- Card: handle Home Assistant setting `hass` before the element is upgraded (page loaded before the card).
- Card: show a readable message instead of a bare error box if it cannot render; register the card only once.
- Integration: a single loading route (dashboard resource); the global module is only a fallback for YAML-mode resources.
- Docs: reload the browser page after installing or updating.

## 0.1.1
- Fix pictures whose URL contains an encoded space (the card encoded them twice).
- Download missing species data in the background at start-up; register the card as a dashboard resource.

## 0.1.0 - unreleased
- First version: one sensor per plant, water / fertilise buttons, plants as config subentries.
- OpenPlantbook species search with pictures, care tips, ideal ranges and suggested schedules.
- Detailed watering and feeding periods (any dates, up to six each), rest periods, wrap-around year end.
- Soil moisture sensor assignment with live moisture, temperature and battery.
- Ideal N-P-K fertiliser mix, soil mix, location (HA area + free text), own pictures.
- Bundled dashboard card `custom:green-finger-card`.
