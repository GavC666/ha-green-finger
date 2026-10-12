import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(
  new URL('../../custom_components/green_finger/frontend/green-finger-card.js', import.meta.url), 'utf8');

// a small deterministic random generator, so a failure can be reproduced
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const attrs = (over = {}) => ({
  green_finger: true, plant_id: 'p', plant_name: 'Fig', common_name: null, display_name: 'Fig', species: 'ficus benjamina',
  species_name: 'Ficus benjamina', species_alias: null, common_names: [], picture: null, species_picture: null,
  user_picture: false, area: null, location: null, fertiliser_npk: null, fertiliser_npk_label: null,
  fertiliser_name: null, soil_mix: [], soil_notes: null, inside: true, last_watered: '2026-10-11',
  last_fertilised: '2026-10-11', water_interval: 7, feed_interval: 15, water_days_left: 5, feed_days_left: 12,
  water_status: 'ok', feed_status: 'ok', water_period: '', feed_period: '', water_schedule: [[1, 1, 12, 31, 7]],
  feed_schedule: [[3, 1, 11, 30, 15]], moisture_entity: null, moisture: null, temperature: null, battery: null,
  sensor_name: null, moisture_status: null, temperature_status: null, ideal_moisture: [20, 60],
  ideal_temperature: [15, 30], notes: null, next_water: null, next_feed: null, water_postponed_days: 0,
  feed_postponed_days: 0, auto_watered: false, species_saved_on: null, ...over,
});

test('random use never leaves the card broken', async () => {
  const win = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  win.eval(SRC);
  const errors = [];
  win.console.error = (...a) => errors.push(a.map(String).join(' '));
  const r = rng(20261012);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const statusWords = ['ok', 'due', 'overdue', 'rest', 'unknown'];
  const make = (i) => ({
    entity_id: 'sensor.p' + i,
    state: pick(['ok', 'needs_water', 'needs_feed', 'needs_both']),
    last_updated: String(r()),
    attributes: attrs({
      display_name: 'Plant ' + i, plant_name: 'Plant ' + i, water_status: pick(statusWords), feed_status: pick(statusWords),
      water_days_left: pick([null, -3, 0, 1, 5, 40]), feed_days_left: pick([null, -1, 2, 30]),
      water_interval: pick([0, 3, 14, 60]), feed_interval: pick([0, 7, 30]),
      moisture: pick([null, 5, 40, 95]), temperature: pick([null, 2, 21, 45]), battery: pick([null, 8, 55, 100]),
      moisture_status: pick([null, 'dry', 'low', 'ok', 'high', 'wet']), species: pick([null, 'ficus benjamina', 'x y']),
      picture: pick([null, 'https://img.test/a.jpg']), notes: pick([null, 'a\nb']), water_postponed_days: pick([0, 3]),
      moisture_entity: pick([null, 'sensor.soil' + i]),
    }),
  });
  let states = {};
  for (let i = 0; i < 6; i += 1) { const s = make(i); states[s.entity_id] = s; }
  const hass = {
    states, areas: { a1: { area_id: 'a1', name: 'Hall' } }, entities: {}, devices: {},
    callService: async () => {},
    callWS: async (msg) => {
      if (r() < 0.15) throw new Error('boom');
      if (msg.service === 'search_species') return { response: { results: [{ pid: 'x y', display: 'X y', common_names: [] }], note: null } };
      if (msg.service === 'get_species') {
        return { response: { species: pick([null, { pid: 'x y', display_pid: 'X y', watering: 'w', fetched_at: '2026-10-12' }]),
          suggestion: { name: 'X', common_names: ['X'], water: [[1, 1, 12, 31, 5]] } } };
      }
      return { response: {} };
    },
  };
  const list = win.document.createElement('green-finger-card');
  const one = win.document.createElement('green-finger-plant-card');
  win.document.body.append(list, one);
  list.setConfig({ title: 'Plants', size: pick(['large', 'compact']) });
  one.setConfig({ entity: 'sensor.p1', size: 'compact' });
  list.hass = hass; one.hass = hass;
  const click = (n) => n && n.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true }));
  const selectors = [
    '[data-a=fw]', '[data-a=ff]', '[data-a=size]', '[data-a=add]', '[data-a=info]', '[data-a=edit]', '[data-a=water]',
    '[data-a=feed]', '[data-a=tab][data-t=opb]', '[data-a=tab][data-t=mine]', '[data-a=opbrefresh]', '[data-a=pp]',
    '[data-a=editinfo]', '[data-a=save]', '[data-a=fill]', '.res', '[data-a=togglelist]', '[data-a=inside]',
    '[data-a=addper]', '[data-a=delper]', '[data-a=nopic]', '[data-a=delask]', '[data-a=delno]', '[data-a=close]',
    '[data-a=camstop]', 'summary',
  ];
  for (let step = 0; step < 600; step += 1) {
    const card = r() < 0.7 ? list : one;
    const roll = r();
    if (roll < 0.62) {
      const nodes = [...card.shadowRoot.querySelectorAll(pick(selectors))];
      click(nodes.length ? pick(nodes) : null);
    } else if (roll < 0.8) {
      // a plant changes, appears or goes away
      const i = Math.floor(r() * 8);
      const next = { ...states };
      if (r() < 0.2) delete next['sensor.p' + i]; else next['sensor.p' + i] = make(i);
      states = next;
      const entities = r() < 0.5 ? {} : Object.fromEntries(Object.keys(states).map((k) => [k, { platform: 'green_finger' }]));
      list.hass = { ...hass, states, entities }; one.hass = { ...hass, states, entities };
    } else if (roll < 0.9) {
      const q = card.shadowRoot.getElementById('q');
      if (q) { q.value = pick(['mon', 'ficus', 'zz']); q.dispatchEvent(new win.Event('input', { bubbles: true, composed: true })); }
      const f = card.shadowRoot.querySelector('[data-f]');
      if (f && f.tagName !== 'SELECT') { f.value = pick(['a', '12', '']); f.dispatchEvent(new win.Event('change', { bubbles: true, composed: true })); }
    } else {
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  await new Promise((res) => setTimeout(res, 20));
  for (const card of [list, one]) {
    assert.doesNotMatch(card.shadowRoot.textContent, /could not render/);
  }
  assert.deepEqual(errors, [], 'errors were logged: ' + errors.slice(0, 3).join(' | '));
});
