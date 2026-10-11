import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(
  new URL('../../custom_components/green_finger/frontend/green-finger-card.js', import.meta.url), 'utf8');

const attrs = (over = {}) => ({
  green_finger: true, plant_name: 'Fig', common_name: null, display_name: 'Fig', species: 'ficus benjamina',
  species_name: 'Ficus benjamina', species_alias: null, common_names: [], picture: null, species_picture: null,
  user_picture: false, area: null, location: null, fertiliser_npk: null, fertiliser_npk_label: null,
  fertiliser_name: null, soil_mix: [], soil_notes: null, inside: true, last_watered: '2026-10-11',
  last_fertilised: '2026-10-11', water_interval: 7, feed_interval: 15, water_days_left: 5, feed_days_left: 12,
  water_status: 'ok', feed_status: 'ok', water_period: '', feed_period: '', water_schedule: [[1, 1, 12, 31, 7]],
  feed_schedule: [[3, 1, 11, 30, 15]], moisture_entity: null, moisture: null, temperature: null, battery: null,
  sensor_name: null, moisture_status: null, temperature_status: null, ideal_moisture: [20, 60],
  ideal_temperature: [15, 30], care: {}, notes: null, ...over,
});
const plant = (id, over) => ({ entity_id: id, state: 'ok', attributes: attrs(over), last_updated: id });
const sensor = (id, name) => ({
  entity_id: id, state: '40', attributes: { device_class: 'moisture', friendly_name: name }, last_updated: id,
});

function setup(states, config = {}) {
  const win = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  win.eval(SRC);
  const calls = { ws: [], service: [] };
  const hass = {
    states, areas: {}, entities: {}, devices: {},
    callService: async (...a) => { calls.service.push(a); },
    callWS: async (msg) => {
      calls.ws.push(msg);
      if (msg.service === 'get_species') {
        return { response: { species: { pid: 'ficus benjamina' }, suggestion: { name: 'Weeping fig', common_names: [] } } };
      }
      return { response: { results: [] } };
    },
  };
  const el = win.document.createElement(config.tag || 'green-finger-card');
  win.document.body.appendChild(el);
  el.setConfig(config.config || { title: 'Plants' });
  el.hass = hass;
  const click = (node) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true }));
  return { win, el, hass, calls, click, root: el.shadowRoot };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('choosing a search result works (clicks inside the dialog reach the card)', async () => {
  const { el, calls, click, root } = setup({ 'sensor.fig': plant('sensor.fig') });
  el._openForm('add');
  el._d.results = [{ pid: 'ficus benjamina', display: 'Ficus benjamina', common_names: [], alias: 'weeping fig' }];
  el._renderForm();
  click(root.querySelector('.res'));
  await tick();
  assert.equal(calls.ws.filter((m) => m.service === 'get_species').length, 1);
  assert.equal(el._d.picked, 'ficus benjamina');
  assert.match(root.querySelector('.res').className, /on/);
});

test('Save inside the dialog calls the add_plant service', async () => {
  const { el, calls, click, root } = setup({ 'sensor.fig': plant('sensor.fig') });
  el._openForm('add');
  el._d.name = 'New plant';
  el._renderForm();
  click(root.querySelector('[data-a=save]'));
  await tick();
  const call = calls.service.find((c) => c[1] === 'add_plant');
  assert.ok(call, 'add_plant was not called');
  assert.equal(call[2].name, 'New plant');
});

test('only the backdrop closes the dialog', () => {
  const { el, click, root } = setup({ 'sensor.fig': plant('sensor.fig') });
  el._openForm('add');
  click(root.querySelector('.dlg h2')); // inside the dialog
  assert.ok(root.querySelector('.dlg'), 'dialog closed by a click inside it');
  click(root.querySelector('.ov')); // the backdrop
  assert.equal(root.querySelector('.dlg'), null);
});

test('a sensor used by another plant is disabled, the own sensor is not', () => {
  const states = {
    'sensor.a': plant('sensor.a', { display_name: 'A', moisture_entity: 'sensor.s1' }),
    'sensor.b': plant('sensor.b', { display_name: 'B', moisture_entity: 'sensor.s2' }),
    'sensor.s1': sensor('sensor.s1', 'Sensor 1'),
    'sensor.s2': sensor('sensor.s2', 'Sensor 2'),
    'sensor.s3': sensor('sensor.s3', 'Sensor 3'),
  };
  const { el, root } = setup(states);
  el._openForm('edit', 'sensor.a');
  const opt = (v) => root.querySelector('select[data-f=moisture_entity] option[value="' + v + '"]');
  assert.equal(opt('sensor.s1').disabled, false); // its own sensor stays selectable
  assert.equal(opt('sensor.s2').disabled, true); // used by B
  assert.match(opt('sensor.s2').textContent, /used by B/);
  assert.equal(opt('sensor.s3').disabled, false);
});

test('picture can come from the camera or from a file', () => {
  const { el, root } = setup({ 'sensor.fig': plant('sensor.fig') });
  el._openForm('add');
  const cam = root.querySelector('#file-cam');
  const file = root.querySelector('#file');
  assert.equal(cam.getAttribute('capture'), 'environment');
  assert.equal(file.hasAttribute('capture'), false);
});

test('the list wraps into columns and can be fixed to a number of columns', () => {
  const states = { 'sensor.a': plant('sensor.a'), 'sensor.b': plant('sensor.b', { display_name: 'B' }) };
  const auto = setup(states, { config: { min_width: 300 } });
  assert.match(auto.root.getElementById('list').style.getPropertyValue('--gf-cols'), /auto-fill.*300px/);
  const fixed = setup(states, { config: { columns: 2 } });
  assert.match(fixed.root.getElementById('list').style.getPropertyValue('--gf-cols'), /repeat\(2/);
});

test('urgent plants can be listed first', () => {
  const states = {
    'sensor.a': { ...plant('sensor.a', { display_name: 'A' }), state: 'ok' },
    'sensor.b': { ...plant('sensor.b', { display_name: 'B' }), state: 'needs_water' },
  };
  const { root } = setup(states, { config: { sort: 'urgency' } });
  const names = [...root.querySelectorAll('.plant .nm')].map((n) => n.textContent);
  assert.deepEqual(names, ['B', 'A']);
});

test('the one-plant card shows only its plant, without header or filters', () => {
  const states = { 'sensor.a': plant('sensor.a', { display_name: 'A' }), 'sensor.b': plant('sensor.b', { display_name: 'B' }) };
  const { root } = setup(states, { tag: 'green-finger-plant-card', config: { entity: 'sensor.b' } });
  assert.equal(root.querySelectorAll('.plant').length, 1);
  assert.match(root.querySelector('.plant .nm').textContent, /B/);
  assert.equal(root.querySelector('.chips'), null);
  assert.equal(root.querySelector('[data-a=add]'), null);
});
