import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(
  new URL('../../custom_components/green_finger/frontend/green-finger-card.js', import.meta.url), 'utf8');

const ATTRS = {
  green_finger: true, plant_name: "ET's Fingers", common_name: 'Trumpet Jade', display_name: 'Trumpet Jade',
  species: "crassula ovata 'gollum'", species_name: "Crassula Ovata 'Gollum'", species_alias: 'crassula',
  common_names: ["ET's Fingers"], picture: 'https://img.test/a%20b.jpg', species_picture: null,
  user_picture: false, area: null, location: null, fertiliser_npk: null, fertiliser_npk_label: null,
  fertiliser_name: null, soil_mix: [], soil_notes: null, inside: true, last_watered: '2026-10-11',
  last_fertilised: '2026-10-11', water_interval: 10, feed_interval: 0, water_days_left: 10,
  feed_days_left: null, water_status: 'ok', feed_status: 'rest', water_period: '1 Mar - 30 Nov',
  feed_period: '', water_schedule: [[3, 1, 11, 30, 10]], feed_schedule: [], moisture_entity: 'sensor.s1',
  moisture: 40, temperature: 20, battery: 90, sensor_name: 'Sensor 1', moisture_status: 'ok',
  temperature_status: 'ok', ideal_moisture: [20, 60], ideal_temperature: [15, 30], care: {}, notes: null,
};

const makeHass = () => ({
  states: {
    'sensor.trumpet_jade': {
      entity_id: 'sensor.trumpet_jade', state: 'ok', attributes: ATTRS, last_updated: '2026-10-11T10:00:00',
    },
    'sensor.unrelated': { entity_id: 'sensor.unrelated', state: '5', attributes: {}, last_updated: 'x' },
  },
  areas: {}, entities: {}, devices: {}, callService() {}, callWS: async () => ({}),
});

const newWindow = () => new JSDOM('<!doctype html><body></body>', {
  runScripts: 'outside-only', url: 'http://localhost/',
}).window;

test('renders a card for every plant entity', () => {
  const win = newWindow();
  win.eval(SRC);
  const el = win.document.createElement('green-finger-card');
  el.setConfig({ title: 'Plants' });
  el.hass = makeHass();
  assert.equal(el.shadowRoot.querySelectorAll('.plant').length, 1);
  assert.match(el.shadowRoot.textContent, /Trumpet Jade/);
});

test('picture URLs are not encoded a second time', () => {
  const win = newWindow();
  win.eval(SRC);
  const el = win.document.createElement('green-finger-card');
  el.setConfig({});
  el.hass = makeHass();
  const img = el.shadowRoot.querySelector('.plant img');
  assert.equal(img.getAttribute('src'), 'https://img.test/a%20b.jpg');
});

test('hass set before the element was upgraded is kept', () => {
  const win = newWindow();
  const el = win.document.createElement('green-finger-card'); // not defined yet: plain element
  el.hass = makeHass();
  win.document.body.appendChild(el);
  win.eval(SRC); // defines the element and upgrades the one above
  el.setConfig({});
  assert.equal(el.shadowRoot.querySelectorAll('.plant').length, 1);
});

test('a render problem shows a readable message instead of throwing', () => {
  const win = newWindow();
  win.eval(SRC);
  const el = win.document.createElement('green-finger-card');
  el.setConfig({});
  el.hass = { states: null };
  assert.match(el.shadowRoot.textContent, /could not render/);
});

test('loading the script twice registers the card once', () => {
  const win = newWindow();
  win.eval(SRC);
  win.eval(SRC);
  const cards = win.customCards.filter((c) => c.type === 'green-finger-card');
  assert.equal(cards.length, 1);
});
