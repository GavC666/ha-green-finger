# Changelog

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
