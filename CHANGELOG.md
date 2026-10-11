# Changelog

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
