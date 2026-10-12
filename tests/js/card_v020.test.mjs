import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(
  new URL('../../custom_components/green_finger/frontend/green-finger-card.js', import.meta.url), 'utf8');

const attrs = (over = {}) => ({
  green_finger: true, plant_id: 'p1', plant_name: 'Fig', common_name: null, display_name: 'Fig',
  species: 'ficus benjamina', species_name: 'Ficus benjamina', species_alias: 'weeping fig',
  common_names: ['Weeping fig'], picture: null, species_picture: null, user_picture: false, area: 'Hall',
  location: 'window sill', fertiliser_npk: [10, 5, 10], fertiliser_npk_label: '10-5-10', fertiliser_name: 'Green',
  soil_mix: [{ name: 'perlite', percent: 30 }], soil_notes: 'drains well', inside: true, last_watered: '2026-10-08',
  last_fertilised: '2026-09-20', water_interval: 7, feed_interval: 30, water_days_left: 5, feed_days_left: 12,
  water_status: 'ok', feed_status: 'ok', next_water: '2026-10-15', next_feed: '2026-10-20',
  water_postponed_days: 0, feed_postponed_days: 0, auto_watered: false, water_period: '1 Jan - 31 Dec',
  feed_period: '1 Mar - 30 Nov', water_schedule: [[1, 1, 12, 31, 7]], feed_schedule: [[3, 1, 11, 30, 30]],
  moisture_entity: null, moisture: null, temperature: null, battery: null, sensor_name: null,
  moisture_status: null, temperature_status: null, ideal_moisture: [20, 60], ideal_temperature: [15, 30],
  notes: 'Turn the pot a quarter each week.', ...over,
});
const plant = (id, over, state = 'ok') => ({ entity_id: id, state, attributes: attrs(over), last_updated: id });
const moistureSensor = (id, name) => ({
  entity_id: id, state: '40', attributes: { device_class: 'moisture', friendly_name: name }, last_updated: id,
});

const RECORD = {
  pid: 'ficus benjamina', display_pid: 'Ficus benjamina', alias: 'weeping fig', category: 'Moraceae', origin: 'Asia',
  image_url: 'https://img.test/f.jpg', watering: 'Water weekly in summer.', fertilization: 'Feed monthly.',
  sunlight: 'Bright light.', min_soil_moist: 20, max_soil_moist: 60, min_temp: 15, max_temp: 30,
  fetched_at: '2026-10-12',
};

function mount(win, states, config = {}, extra = {}) {
  const calls = { ws: [], service: [] };
  const hass = {
    states, areas: {}, entities: extra.entities || {}, devices: {},
    callService: async (...a) => { calls.service.push(a); },
    callWS: async (msg) => {
      calls.ws.push(msg);
      if (extra.ws) return extra.ws(msg);
      if (msg.service === 'get_species') {
        return {
          response: {
            species: RECORD,
            suggestion: { name: 'Weeping fig', common_names: ['Weeping fig'], water: [[1, 1, 12, 31, 9]], feed: [[3, 1, 11, 30, 21]] },
          },
        };
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
const setup = (states, config, extra) => {
  const win = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  win.eval(SRC);
  return mount(win, states, config, extra);
};
const tick = () => new Promise((r) => setTimeout(r, 0));
// objects made inside the jsdom window have another Object prototype; compare plain copies
const plain = (v) => JSON.parse(JSON.stringify(v));
const two = () => ({
  'sensor.a': plant('sensor.a', { display_name: 'A', picture: 'https://img.test/a.jpg' }),
  'sensor.b': plant('sensor.b', { display_name: 'B', moisture: 45, moisture_status: 'ok', temperature: 21, temperature_status: 'ok', battery: 80 }),
});

/* ------------------------------------------------------------------ sizes */
test('large cards have gauges, compact cards are slim rows without gauges', () => {
  const large = setup(two());
  assert.ok(large.root.querySelectorAll('.plant svg').length > 0, 'large cards need gauges');
  assert.equal(large.root.querySelectorAll('.plant.c').length, 0);

  const compact = setup(two(), { config: { size: 'compact' } });
  assert.equal(compact.root.querySelectorAll('.plant.c').length, 2);
  assert.equal(compact.root.querySelectorAll('.plant svg').length, 0, 'compact cards must not draw gauges');
  const row = compact.root.querySelectorAll('.plant.c')[1];
  assert.match(row.querySelector('.nm').textContent, /B/);
  assert.match(row.querySelector('.sts').textContent, /5d/); // water in 5 days
  assert.match(row.querySelector('.sts').textContent, /45%/); // moisture
  assert.match(row.querySelector('.sts').textContent, /80%/); // battery
});

test('the size button switches the cards and is remembered on the device', () => {
  const win = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  win.eval(SRC);
  const first = mount(win, two());
  first.click(first.root.querySelector('[data-a=size]'));
  assert.equal(first.root.querySelectorAll('.plant.c').length, 2);
  const again = mount(win, two()); // a second card with the same title reads the choice
  assert.equal(again.root.querySelectorAll('.plant.c').length, 2);
  again.click(again.root.querySelector('[data-a=size]'));
  assert.equal(again.root.querySelectorAll('.plant.c').length, 0);
});

test('the one-plant card honours the size setting', () => {
  const { root } = setup(two(), { tag: 'green-finger-plant-card', config: { entity: 'sensor.b', size: 'compact' } });
  assert.equal(root.querySelectorAll('.plant.c').length, 1);
  assert.equal(root.querySelector('[data-a=size]'), null);
});

test('compact: tapping the row opens the information, the buttons act', () => {
  const { click, root, calls } = setup(two(), { config: { size: 'compact' } });
  click(root.querySelector('.plant.c .nm'));
  assert.ok(root.querySelector('.dlg .tabs'), 'information pop-up did not open');
  click(root.querySelector('[data-a=close]'));
  click(root.querySelector('.plant.c [data-a=water]'));
  click(root.querySelector('.plant.c [data-a=feed]'));
  assert.deepEqual(calls.service.map((c) => c[1]), ['water', 'fertilise']);
});

/* ------------------------------------------------------------ information */
test('information pop-up: my plant by default, with notes; the card has no delete button', () => {
  const { click, root } = setup(two());
  assert.equal(root.querySelector('[data-a=del]'), null);
  click(root.querySelector('.plant [data-a=info]'));
  const text = root.querySelector('.db').textContent;
  assert.match(text, /Turn the pot a quarter each week/);
  assert.match(text, /10-5-10/);
  assert.match(text, /30% perlite/);
  assert.match(text, /Watering schedule/);
});

test('the OpenPlantbook tab shows the saved data and only refreshes on request', async () => {
  const { click, root, calls } = setup(two());
  click(root.querySelector('.plant [data-a=info]'));
  click(root.querySelector('[data-a=tab][data-t=opb]'));
  await tick();
  const gets = () => calls.ws.filter((m) => m.service === 'get_species');
  assert.equal(gets().length, 1);
  assert.equal(gets()[0].service_data.refresh, false);
  const text = root.querySelector('.db').textContent;
  assert.match(text, /Water weekly in summer/);
  assert.match(text, /Saved on 12 Oct 2026/);
  click(root.querySelector('[data-a=tab][data-t=mine]'));
  click(root.querySelector('[data-a=tab][data-t=opb]'));
  await tick();
  assert.equal(gets().length, 1, 'switching tabs must not ask again');
  click(root.querySelector('[data-a=opbrefresh]'));
  await tick();
  assert.equal(gets().length, 2);
  assert.equal(gets()[1].service_data.refresh, true);
});

test('a refused refresh is shown in the pop-up and the saved data stays', async () => {
  let n = 0;
  const { click, root } = setup(two(), {}, {
    ws: async (msg) => {
      if (msg.service !== 'get_species') return { response: {} };
      n += 1;
      if (n === 1) return { response: { species: RECORD, suggestion: {} } };
      throw new Error('OpenPlantbook is limiting requests. Try again in 42 seconds.');
    },
  });
  click(root.querySelector('.plant [data-a=info]'));
  click(root.querySelector('[data-a=tab][data-t=opb]'));
  await tick();
  click(root.querySelector('[data-a=opbrefresh]'));
  await tick();
  assert.match(root.querySelector('.err').textContent, /limiting requests/);
  assert.match(root.querySelector('.db').textContent, /Water weekly in summer/);
});

test('a plant without a species says how to link one', () => {
  const states = { 'sensor.x': plant('sensor.x', { species: null, species_name: null }) };
  const { click, root, calls } = setup(states);
  click(root.querySelector('.plant [data-a=info]'));
  click(root.querySelector('[data-a=tab][data-t=opb]'));
  assert.match(root.querySelector('.db').textContent, /not linked to an OpenPlantbook species/);
  assert.equal(calls.ws.length, 0);
});

test('postpone buttons call the postpone service for the plant', () => {
  const { click, root, calls } = setup(two());
  click(root.querySelector('.plant [data-a=info]'));
  click(root.querySelector('[data-a=pp][data-k=water][data-n="3"]'));
  const call = calls.service.find((c) => c[1] === 'postpone');
  assert.deepEqual(plain(call[2]), { kind: 'water', days: 3 });
  assert.deepEqual(plain(call[3]), { entity_id: 'sensor.a' });
});

test('the pop-up follows the plant when its state changes', () => {
  const states = two();
  const { el, click, root, hass } = setup(states);
  click(root.querySelector('.plant [data-a=info]'));
  assert.doesNotMatch(root.querySelector('.db').textContent, /Postponed by 3 days/);
  el.hass = { ...hass, states: { ...states, 'sensor.a': plant('sensor.a', { display_name: 'A', water_postponed_days: 3 }) } };
  assert.match(root.querySelector('.db').textContent, /Postponed by 3 days/);
});

test('Escape closes a dialog', () => {
  const { win, click, root } = setup(two());
  click(root.querySelector('.plant [data-a=info]'));
  assert.ok(root.querySelector('.dlg'));
  win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(root.querySelector('.dlg'), null);
});

/* ---------------------------------------------------------------- forms */
test('delete lives in the edit dialog behind a confirmation', async () => {
  const { el, click, root, calls } = setup(two());
  el._openForm('edit', 'sensor.a');
  assert.equal(root.querySelector('[data-a=delyes]'), null);
  click(root.querySelector('[data-a=delask]'));
  assert.equal(calls.service.length, 0, 'asking must not delete');
  click(root.querySelector('[data-a=delno]'));
  assert.ok(root.querySelector('[data-a=delask]'));
  click(root.querySelector('[data-a=delask]'));
  click(root.querySelector('[data-a=delyes]'));
  await tick();
  const call = calls.service.find((c) => c[1] === 'remove_plant');
  assert.deepEqual(plain(call[3]), { entity_id: 'sensor.a' });
  assert.equal(root.querySelector('.dlg'), null);
});

test('the "mark as watered automatically" switch needs a sensor and is saved', async () => {
  const states = { ...two(), 'sensor.s1': moistureSensor('sensor.s1', 'Soil 1') };
  const { el, click, root, calls } = setup(states);
  el._openForm('add');
  assert.equal(root.querySelector('[data-f=auto_watered]'), null);
  el._d.name = 'Basil';
  el._d.moisture_entity = 'sensor.s1';
  el._renderForm();
  const box = root.querySelector('[data-f=auto_watered]');
  assert.ok(box, 'switch missing');
  box.checked = true;
  box.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true, composed: true }));
  click(root.querySelector('[data-a=save]'));
  await tick();
  const call = calls.service.find((c) => c[1] === 'add_plant');
  assert.equal(call[2].auto_watered, true);
  assert.equal(call[2].moisture_entity, 'sensor.s1');
});

test('a plant without a name gets a message in the form, not a browser alert', () => {
  const { el, click, root } = setup(two());
  el._openForm('add');
  click(root.querySelector('[data-a=save]'));
  assert.match(root.querySelector('.err').textContent, /Give the plant a name/);
});

test('the sections of the form stay open when the form is redrawn', () => {
  const { el, root } = setup(two());
  el._openForm('add');
  const care = () => root.querySelector('details[data-sec=care]');
  assert.equal(care().open, false, 'the form should start compact');
  el._d.open.care = true;
  el._renderForm();
  assert.equal(care().open, true);
  assert.match(care().querySelector('summary small').textContent, /every 14 d\b/);
});

test('typed text survives a redraw', () => {
  const { el, click, root } = setup(two());
  el._openForm('add');
  const name = root.querySelector('[data-f=name]');
  name.value = 'Basil';
  name.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true, composed: true }));
  click(root.querySelector('[data-a=inside][data-v="0"]')); // redraws the form
  assert.equal(root.querySelector('[data-f=name]').value, 'Basil');
});

test('changing the species of an existing plant keeps its name and schedules until Fill is used', async () => {
  const { el, click, root } = setup(two());
  el._openForm('edit', 'sensor.a');
  assert.equal(el._d.name, 'Fig');
  el._d.results = [{ pid: 'ficus benjamina', display: 'Ficus benjamina', common_names: [], alias: 'weeping fig' }];
  el._d.listOpen = true;
  el._renderForm();
  click(root.querySelector('.res'));
  await tick();
  assert.equal(el._d.name, 'Fig');
  assert.deepEqual(plain(el._d.water), [[1, 1, 12, 31, 7]]);
  click(root.querySelector('[data-a=fill]'));
  await tick();
  assert.deepEqual(plain(el._d.water), [[1, 1, 12, 31, 9]]);
  assert.equal(el._d.name, 'Fig', 'the name the user chose must stay');
});

test('a new plant takes the species name unless the user typed their own', async () => {
  const { el, click, root } = setup(two());
  el._openForm('add');
  el._d.results = [{ pid: 'ficus benjamina', display: 'Ficus benjamina', common_names: [], alias: 'weeping fig' }];
  el._d.listOpen = true;
  el._renderForm();
  click(root.querySelector('.res'));
  await tick();
  assert.equal(el._d.name, 'Weeping fig');
  assert.deepEqual(plain(el._d.water), [[1, 1, 12, 31, 9]]);
});

/* ------------------------------------------------------------ efficiency */
test('a state change redraws only the plant that changed', () => {
  const states = two();
  const { el, root, hass } = setup(states);
  const before = [...root.querySelectorAll('.plant')];
  assert.equal(before.length, 2);
  el.hass = { ...hass, states: { ...states, 'sensor.a': plant('sensor.a', { display_name: 'A', water_days_left: 2 }) } };
  const after = [...root.querySelectorAll('.plant')];
  assert.notEqual(after[0], before[0], 'the changed plant must be redrawn');
  assert.equal(after[1], before[1], 'the other plant must not be touched');
});

test('plants are looked up again only when the entity registry changes', () => {
  const states = two();
  let scans = 0;
  const entities = new Proxy({
    'sensor.a': { platform: 'green_finger' }, 'sensor.b': { platform: 'green_finger' }, 'sensor.other': { platform: 'mqtt' },
  }, { ownKeys(t) { scans += 1; return Reflect.ownKeys(t); } });
  const { el, hass, root } = setup(states, {}, { entities });
  assert.equal(scans, 1);
  for (let i = 0; i < 5; i += 1) el.hass = { ...hass, states: { ...states, [`sensor.noise${i}`]: { entity_id: `sensor.noise${i}`, state: '1', attributes: {} } } };
  assert.equal(scans, 1, 'unrelated state changes must not scan the registry');
  assert.equal(root.querySelectorAll('.plant').length, 2);
});

test('the card still finds plants when the registry carries no platform', () => {
  const { root } = setup(two(), {}, { entities: { 'sensor.a': {}, 'sensor.b': {} } });
  assert.equal(root.querySelectorAll('.plant').length, 2);
});

test('overdue animations of two plants do not share names', () => {
  const states = {
    'sensor.a': plant('sensor.a', { display_name: 'A', water_days_left: -2, water_status: 'overdue' }),
    'sensor.b': plant('sensor.b', { display_name: 'B', water_days_left: -1, water_status: 'overdue', water_interval: 14 }),
  };
  const { root } = setup(states);
  const names = [...root.querySelectorAll('.plant')].map((p) => (p.innerHTML.match(/@keyframes (k[wf][a-z0-9]+_?\d*)\{/g) || []));
  const first = new Set(names[0].map((n) => n.replace(/\d+\{$/, '')));
  const second = new Set(names[1].map((n) => n.replace(/\d+\{$/, '')));
  assert.ok(first.size > 0 && second.size > 0);
  for (const n of first) assert.equal(second.has(n), false, 'keyframe prefix shared: ' + n);
});

/* ---------------------------------------------------------------- layout */
test('the header holds title, filters and the add button; the list sits outside it', () => {
  const { root } = setup(two());
  const top = root.querySelector('.top');
  const kids = [...top.children].map((c) => c.className.split(' ')[0]);
  assert.deepEqual(kids.sort(), ['add', 'title', 'tools']);
  assert.equal(top.querySelector('#list'), null, 'the list must not be inside the header');
  assert.equal(root.querySelector('#body > #list') !== null, true);
  assert.equal(root.querySelector('#body #dlg'), null, 'the dialog must stay outside the container element');
  assert.equal(root.querySelectorAll('.tools > button').length, 3);
});

/* ---------------------------------------------------------------- safety */
test('names, notes and places are shown as text, never as markup', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const states = {
    'sensor.x': plant('sensor.x', {
      display_name: evil, plant_name: evil, notes: evil, location: evil, area: evil, species_name: evil,
      sensor_name: evil, soil_notes: evil, fertiliser_name: evil, moisture_entity: 'sensor.s1', moisture: 40, battery: 50,
    }),
  };
  const bad = (root) => root.querySelectorAll('img[src="x"], [onerror="alert(1)"]').length;
  const large = setup(states);
  assert.equal(bad(large.root), 0, 'list');
  large.click(large.root.querySelector('.plant [data-a=info]'));
  assert.equal(bad(large.root), 0, 'information window');
  assert.ok(large.root.querySelector('.db').textContent.includes(evil), 'the text itself must still be shown');
  large.el._openForm('edit', 'sensor.x');
  assert.equal(bad(large.root), 0, 'form');
  const compact = setup(states, { config: { size: 'compact' } });
  assert.equal(bad(compact.root), 0, 'compact list');
});
