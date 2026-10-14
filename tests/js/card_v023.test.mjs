import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(
  new URL('../../custom_components/green_finger/frontend/green-finger-card.js', import.meta.url), 'utf8');

const attrs = (name) => ({
  green_finger: true, plant_id: name, plant_name: name, display_name: name, species_name: null, picture: null,
  area: null, location: null, water_interval: 7, feed_interval: 30, water_days_left: 5, feed_days_left: 12,
  last_watered: '2026-10-08', last_fertilised: '2026-09-20', ideal_moisture: [20, 60], ideal_temperature: [15, 30],
});
const plant = (id, name) => ({ entity_id: id, state: 'ok', attributes: attrs(name), last_updated: id });
// the summary sensor of the integration: same platform, a sensor, but not a plant
const summary = () => ({
  entity_id: 'sensor.the_green_finger_plants_needing_care', state: '0', last_updated: 's',
  attributes: { needing_water: [], needing_feeding: [], plants: [], friendly_name: 'The Green Finger Plants needing care' },
});

function mount(states, entities, config = { title: 'Plants' }) {
  const win = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  win.eval(SRC);
  const hass = {
    states, areas: {}, entities, devices: {}, callService: async () => {}, callWS: async () => ({ response: {} }),
  };
  const el = win.document.createElement('green-finger-card');
  win.document.body.appendChild(el);
  el.setConfig(config);
  el.hass = hass;
  return el.shadowRoot;
}

test('the list shows plants only, not the summary sensor of the integration', () => {
  const states = { 'sensor.fig': plant('sensor.fig', 'Fig'), 'sensor.the_green_finger_plants_needing_care': summary() };
  const entities = {
    'sensor.fig': { platform: 'green_finger' },
    'sensor.the_green_finger_plants_needing_care': { platform: 'green_finger' },
    'sensor.other': { platform: 'mqtt' },
  };
  const root = mount(states, entities);
  const rows = root.querySelectorAll('#list .plant');
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Fig/);
});

test('a plant that has no state yet is not shown, and does not break the list', () => {
  const states = { 'sensor.fig': plant('sensor.fig', 'Fig') };
  const entities = { 'sensor.fig': { platform: 'green_finger' }, 'sensor.new': { platform: 'green_finger' } };
  const root = mount(states, entities);
  assert.equal(root.querySelectorAll('#list .plant').length, 1);
});

test('large card: schedule under the name, notes above the buttons, no last-watered dates', () => {
  const st = plant('sensor.fig', 'Fig');
  st.attributes.notes = 'Turn the pot <b>a quarter</b>';
  st.attributes.water_interval = 7; st.attributes.feed_interval = 30;
  const root = mount({ 'sensor.fig': st }, { 'sensor.fig': { platform: 'green_finger' } });
  const row = root.querySelector('#list .plant');
  const infos = [...row.querySelectorAll('.head .info')].map((n) => n.textContent.trim());
  assert.ok(infos.includes('Water every 7 days'));
  assert.ok(infos.includes('Feed every 30 days'));
  assert.ok(!/last|Watered/.test(row.textContent.replace(/Watered today/g, '')));
  const notes = row.querySelector('.notes');
  assert.equal(notes.textContent, 'Turn the pot <b>a quarter</b>');
  assert.equal(notes.nextElementSibling.className, 'acts');
});
