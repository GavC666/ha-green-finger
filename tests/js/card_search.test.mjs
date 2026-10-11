import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const SRC = readFileSync(
  new URL('../../custom_components/green_finger/frontend/green-finger-card.js', import.meta.url), 'utf8');

function setup() {
  const win = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/' }).window;
  win.eval(SRC);
  const calls = [];
  const hass = {
    states: {}, areas: {}, entities: {}, devices: {}, callService: async () => {},
    callWS: async (msg) => {
      calls.push(msg);
      if (msg.service === 'get_species') {
        return {
          response: {
            species: { pid: 'tagetes patula' },
            suggestion: { name: 'French marigold', common_names: [], picture: 'https://img.test/t.jpg' },
          },
        };
      }
      return { response: { results: [], note: null } };
    },
  };
  const el = win.document.createElement('green-finger-card');
  win.document.body.appendChild(el);
  el.setConfig({});
  el.hass = hass;
  const click = (n) => n.dispatchEvent(new win.MouseEvent('click', { bubbles: true, composed: true }));
  return { win, el, calls, click, root: el.shadowRoot };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const RESULTS = [
  { pid: 'tagetes patula', display: 'Tagetes patula', alias: 'tagetes patula', via: 'Tagetes', common_names: [] },
  { pid: 'tagetes erecta', display: 'Tagetes erecta', alias: 'tagetes erecta', via: 'Tagetes', common_names: [] },
];

test('the result list collapses into one row after a species is chosen, and can be reopened', async () => {
  const { el, click, root } = setup();
  el._openForm('add');
  el._d.results = RESULTS; el._d.listOpen = true;
  el._renderForm();
  assert.equal(root.querySelectorAll('.res').length, 2);
  click(root.querySelectorAll('.res')[0]);
  await tick();
  assert.equal(root.querySelectorAll('.res').length, 0);
  assert.match(root.querySelector('.picked').textContent, /Tagetes patula/);
  click(root.querySelector('.picked'));
  assert.equal(root.querySelectorAll('.res').length, 2);
});

test('a spinner shows while searching and while loading the species', () => {
  const { el, root } = setup();
  el._openForm('add');
  el._d.searching = true; el._renderForm();
  assert.ok(root.querySelector('.loader'), 'no spinner while searching');
  el._d.searching = false; el._d.picking = true; el._renderForm();
  assert.ok(root.querySelector('.loader'), 'no spinner while loading the species');
  el._d.picking = false; el._renderForm();
  assert.equal(root.querySelector('.loader'), null);
});

test('the fill button is named after OpenPlantbook', () => {
  const { el, root } = setup();
  el._openForm('add');
  assert.match(root.querySelector('[data-a=fill]').textContent, /Fill from OpenPlantbook data/);
});

test('the common-name note and the via label are shown', () => {
  const { el, root } = setup();
  el._openForm('add');
  el._d.results = RESULTS; el._d.listOpen = true;
  el._d.note = '"marigold" is a common name, so these are species of Tagetes.';
  el._renderForm();
  assert.match(root.textContent, /common name/);
  assert.match(root.querySelector('.res').textContent, /via Tagetes/);
});

test('Take photo falls back to the device picker without a secure context', () => {
  const { el, click, root } = setup();
  el._openForm('add');
  let opened = false;
  root.getElementById('file-cam').click = () => { opened = true; };
  click(root.querySelector('[data-a=cam]'));
  assert.equal(opened, true);
});

test('Take photo opens the in-page camera when the browser allows it', async () => {
  const { win, el, click, root } = setup();
  Object.defineProperty(win, 'isSecureContext', { value: true });
  let stopped = false;
  Object.defineProperty(win.navigator, 'mediaDevices', {
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped = true; } }] }) },
  });
  el._openForm('add');
  click(root.querySelector('[data-a=cam]'));
  await tick();
  assert.ok(root.getElementById('cam'), 'camera preview missing');
  assert.ok(root.querySelector('[data-a=snap]'));
  click(root.querySelector('[data-a=camstop]'));
  assert.equal(root.getElementById('cam'), null);
  assert.equal(stopped, true);
});
