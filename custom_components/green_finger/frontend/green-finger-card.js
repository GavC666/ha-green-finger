/* The Green Finger card - bundled with the green_finger integration.
 * Lists every plant entity of the integration (sensor with attribute green_finger: true) with LED
 * gauges, quick actions, care tips and add / edit forms that call the green_finger services.
 * Usage:  type: custom:green-finger-card   (optional: title, icon) */
(() => {
  const VER = '0.1.5';
  const DOMAIN = 'green_finger';
  const GRN = '#34d058', AMB = '#ffb000', RED = '#ff3b30', MUT = '#9aa5b8';
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LAST = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MAXP = 6;
  const H = 104;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isNum = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
  const fmt = (d) => { const p = String(d || '').split('-'); return p.length === 3 ? (+p[2]) + ' ' + MON[+p[1] - 1] : '?'; };
  const ago = (d) => {
    const p = String(d || '').split('-'); if (p.length !== 3) return '';
    const t = new Date(+p[0], +p[1] - 1, +p[2]); const n0 = new Date(); n0.setHours(0, 0, 0, 0);
    const k = Math.round((n0 - t) / 86400000); return k === 0 ? 'today' : k + 'd ago';
  };
  const fmtSoil = (mix) => (mix || []).map((c) => c.percent + '% ' + c.name).join('\n');

  /* ------------------------------------------------------------------ gauges */
  const colHtml = (label, svg, valTxt, valCol, subTxt) =>
    '<div class="col"><div class="lab">' + label + '</div>' + svg +
    '<div class="val" style="color:' + valCol + '">' + valTxt + '</div><div class="sub">' + subTxt + '</div></div>';
  const vsvg = (inner) => '<svg viewBox="0 0 56 ' + H + '" width="56" height="' + H + '" style="display:block;overflow:visible;filter:drop-shadow(0 0 2px rgba(255,255,255,.25))"><style>@keyframes ptr{0%,100%{transform:translateX(0)}50%{transform:translateX(-3px)}}</style>' + inner + '</svg>';
  const vrect = (i, cnt, col, on, extra) => {
    const lh = H / cnt;
    return '<rect x="16" y="' + ((cnt - 1 - i) * lh + lh * 0.14).toFixed(2) + '" width="24" height="' + (lh * 0.72).toFixed(2) +
      '" fill="' + (on ? col : 'rgba(255,255,255,.14)') + '"' + (extra || '') + '/>';
  };
  const restCol = (label, txt, sub) => {
    let s = ''; for (let i = 0; i < 20; i++) s += vrect(i, 20, MUT, false);
    return colHtml(label, vsvg(s), txt, MUT, sub);
  };
  const dayCol = (label, pfx, left, interval, last) => {
    const sub = 'last ' + last + '<br>every ' + interval + 'd';
    if (left === null || left === undefined || !interval) return colHtml(label, vsvg(vrect(0, 1, MUT, false)), '?', MUT, sub);
    const cnt = Math.min(Math.max(Math.round(interval) || 1, 1), 60) + 1;
    let inner = '';
    if (left < 0) {
      const T = Math.max(1, 2 * (cnt - 1)); let css = '';
      for (let i = 0; i < cnt; i++) {
        const st = {};
        const put = (k, v) => { const kk = Math.max(0, Math.min(100, Math.round(k * 100) / 100)); st[kk] = Math.max(st[kk] || 0, v); };
        put(0, 0.15); put(100, 0.15);
        [i / T * 100, (T - i) / T * 100].forEach((t) => { put(t - 0.6, 0.15); put(t, 1); put(t + 16, 0.15); });
        css += '@keyframes ' + pfx + i + '{' + Object.keys(st).map(Number).sort((x, y) => x - y).map((k) => k + '%{opacity:' + st[k] + '}').join('') + '}';
        inner += vrect(i, cnt, RED, true, ' style="opacity:.15;animation:' + pfx + i + ' 1.6s linear infinite"');
      }
      return colHtml(label, vsvg('<style>' + css + '</style>' + inner), 'overdue ' + (-left) + 'd', RED, sub);
    }
    const dayOf = (i) => (i + 1) * (interval + 1) / cnt;
    const colAt = (i) => (dayOf(i) <= 1.01 ? RED : (dayOf(i) <= 4.01 ? AMB : GRN));
    const lit = Math.max(0, Math.min(cnt, Math.ceil((left + 1) * cnt / (interval + 1))));
    for (let i = 0; i < cnt; i++) inner += vrect(i, cnt, colAt(i), i < lit);
    return colHtml(label, vsvg(inner), left === 0 ? 'due today' : left + 'd left', left <= 1 ? RED : (left <= 4 ? AMB : GRN), sub);
  };
  const zCol = (label, val, vmin, vmax, cnt, zlo, zhi, minMg, unit, nm, sub) => {
    const step = (vmax - vmin) / cnt;
    const loI = Math.max(0, Math.ceil((zlo - vmin) / step - 0.5)), hiI = Math.min(cnt - 1, Math.floor((zhi - vmin) / step - 0.5));
    const mgL = Math.max(minMg, Math.round((zhi - zlo) * 0.3 / step));
    const aBel = Math.min(mgL, Math.max(0, loI - 1)), aAbo = Math.min(mgL, Math.max(0, cnt - 2 - hiI));
    const tLo = vmin + step * (loI - aBel), tHi = vmin + step * (hiI + aAbo + 1);
    const vv = Math.max(vmin, Math.min(vmax, val));
    const zc = (i) => (i >= loI && i <= hiI ? GRN : (((i >= loI - aBel && i < loI) || (i > hiI && i <= hiI + aAbo)) ? AMB : RED));
    let inner = '';
    for (let i = 0; i < cnt; i++) inner += vrect(i, cnt, zc(i), true);
    const py = H - (vv - vmin) / (vmax - vmin) * H;
    inner += '<polygon points="0,' + (py - 6).toFixed(1) + ' 13,' + py.toFixed(1) + ' 0,' + (py + 6).toFixed(1) + '" fill="#fff" style="animation:ptr 1.8s ease-in-out infinite"/>';
    let st, col;
    if (val < tLo) { st = nm[0]; col = RED; } else if (val < zlo) { st = nm[1]; col = AMB; } else if (val <= zhi) { st = nm[2]; col = GRN; } else if (val <= tHi) { st = nm[3]; col = AMB; } else { st = nm[4]; col = RED; }
    return colHtml(label, vsvg(inner), (Math.round(val * 10) / 10) + unit + ' ' + st, col, sub);
  };

  const CSS = `
    :host{display:block}
    *{box-sizing:border-box}
    .top{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px}
    .title{display:flex;align-items:center;gap:8px;font-size:125%;font-weight:500;color:var(--primary-text-color)}
    button{font:inherit;cursor:pointer}
    .add{background:var(--primary-color);color:var(--text-primary-color,#fff);border:0;border-radius:23px;height:46px;padding:0 18px 0 12px;font-weight:600;display:flex;align-items:center;gap:6px}
    .chips{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 10px}
    #list{display:grid;gap:10px;grid-template-columns:var(--gf-cols,1fr)}
    #list>.plant{margin:0;min-width:0}
    .chip{display:flex;align-items:center;gap:8px;background:var(--card-background-color,#1c1c1c);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 10px;color:var(--primary-text-color);text-align:left}
    .chip.on{border-color:var(--primary-color);box-shadow:0 0 0 1px var(--primary-color) inset}
    .plant{position:relative;border-radius:16px;padding:10px 12px 2px;margin:0 0 10px;box-shadow:0 2px 8px rgba(0,0,0,.35);color:var(--primary-text-color)}
    .head{display:flex;gap:10px;align-items:center;padding-right:96px}
    .nm{font-size:118%;font-weight:600;line-height:1.15}
    .sci{font-size:78%;font-style:italic;opacity:.75;margin-top:2px}
    .info{font-size:72%;color:${MUT};margin-top:2px}
    .batt{position:absolute;top:10px;right:12px;text-align:right}
    .batt b{display:flex;align-items:center;justify-content:flex-end;font-size:90%;font-weight:600}
    .batt small{display:block;font-size:62%;color:${MUT};margin-top:1px}
    .gauges{display:grid;gap:2px;margin-top:10px;justify-items:center}
    .col{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}
    .lab{font-size:66%;letter-spacing:1.2px;color:${MUT}}
    .val{font-weight:600;font-size:82%;white-space:nowrap}
    .sub{font-size:64%;color:${MUT};white-space:nowrap;text-align:center}
    .acts{display:flex;justify-content:space-around;border-top:1px solid rgba(255,255,255,.12);margin-top:4px;padding-top:2px}
    .acts button{background:none;border:0;padding:4px 10px}
    .empty{padding:24px;text-align:center;color:${MUT}}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9;display:flex;align-items:flex-end;justify-content:center}
    .dlg{background:var(--card-background-color,#1c1c1c);color:var(--primary-text-color);width:min(560px,100%);max-height:92vh;overflow:auto;border-radius:20px 20px 0 0;padding:14px 16px 18px}
    @media(min-width:700px){.ov{align-items:center}.dlg{border-radius:20px}}
    .dlg h2{margin:0 0 10px;font-size:130%;font-weight:500;display:flex;justify-content:space-between;align-items:center}
    .x{background:none;border:0;color:var(--primary-text-color);font-size:150%}
    .g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
    .fld{display:flex;flex-direction:column;gap:3px;font-size:78%;color:${MUT};margin:0 0 8px}
    .fld input,.fld select,.fld textarea{background:var(--secondary-background-color,#2a2a2a);color:var(--primary-text-color);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:8px 10px;font:inherit;font-size:130%;width:100%}
    .fld textarea{min-height:76px;resize:vertical}
    .sec{font-size:80%;letter-spacing:1px;color:${MUT};margin:10px 0 4px}
    .per{display:grid;grid-template-columns:1fr 1fr 70px 34px;gap:6px;align-items:end;margin:0 0 6px}
    .per .fld{margin:0}
    .per select,.per input{font-size:105%;padding:7px 4px}
    .md{display:grid;grid-template-columns:1fr 54px;gap:3px}
    .pill{display:flex;gap:6px;margin:0 0 8px}
    .pill button{flex:1;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px;background:var(--secondary-background-color,#2a2a2a);color:var(--primary-text-color)}
    .pill button.on{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}
    .btn{border:0;border-radius:12px;padding:12px;background:var(--secondary-background-color,#2a2a2a);color:var(--primary-text-color);font-weight:500}
    .btn.p{background:var(--primary-color);color:var(--text-primary-color,#fff)}
    .btn.d{color:${RED}}
    .row{display:flex;gap:8px;margin-top:12px}.row .btn{flex:1}
    .res{display:flex;gap:10px;align-items:center;padding:8px;border-radius:12px;background:var(--secondary-background-color,#2a2a2a);margin:0 0 6px;cursor:pointer;border:1px solid transparent}
    .res.on{border-color:var(--primary-color)}
    .res img{width:56px;height:56px;border-radius:10px;object-fit:cover;background:#0003}
    .res small{display:block;color:${MUT}}
    .tip{margin:0 0 10px;font-size:90%;line-height:1.4}.tip b{display:block;font-size:80%;letter-spacing:1px;color:${MUT};font-weight:500}
    .spin{padding:14px;text-align:center;color:${MUT}}
    .loader{display:inline-block;width:18px;height:18px;border:3px solid rgba(255,255,255,.2);border-top-color:var(--primary-color);border-radius:50%;animation:gfspin .8s linear infinite;vertical-align:middle;margin-right:8px}
    @keyframes gfspin{to{transform:rotate(360deg)}}
    .picked{display:flex;gap:10px;align-items:center;padding:8px;border-radius:12px;background:var(--secondary-background-color,#2a2a2a);border:1px solid var(--primary-color);margin:0 0 6px;cursor:pointer}
    .picked img{width:44px;height:44px;border-radius:8px;object-fit:cover}
    .picked .grow{flex:1;min-width:0}
    .note{font-size:80%;color:${MUT};margin:0 0 8px}
    .cam{width:100%;border-radius:12px;background:#000;max-height:260px}
    .pic{display:flex;gap:10px;align-items:center;margin:0 0 8px}
    .pic img,.pic .ph{width:72px;height:72px;border-radius:14px;object-fit:cover;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center}
    .pic input[type=file]{display:none}
    table{border-collapse:collapse;width:100%;font-size:90%}td{padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.08)}
  `;

  class GreenFingerCard extends HTMLElement {
    constructor() {
      super();
      // Home Assistant can set `hass` on the element before it is upgraded (the script loaded late);
      // that leaves an own property that hides the setter below, so re-apply it through the setter.
      if (Object.prototype.hasOwnProperty.call(this, 'hass')) {
        const early = this.hass;
        delete this.hass;
        this.hass = early;
      }
      this.attachShadow({ mode: 'open' });
      this._f = { water: false, feed: false };
      try { this._f = JSON.parse(localStorage.getItem('green-finger-filters')) || this._f; } catch (e) { /* ignore */ }
      this._d = null;
      this._sig = '';
    }
    setConfig(config) {
      this._config = Object.assign({ title: 'Plants', icon: 'mdi:sprout', min_width: 380, sort: 'name' }, config || {});
      try { this._build(); } catch (e) { this._fail(e); }
    }
    _fail(e) {
      // never leave a bare error box: say what went wrong and what to try
      console.error('green-finger-card:', e); // eslint-disable-line no-console
      if (this.shadowRoot) {
        this.shadowRoot.innerHTML = '<style>' + CSS + '</style><div class="empty">The Green Finger card could not render: ' +
          esc(e && e.message ? e.message : e) + '. Reload the page; if this stays, update the integration.</div>';
      }
    }
    getCardSize() { return this._config && this._config.entity ? 5 : 8; }
    getGridOptions() {
      return this._config && this._config.entity ? { columns: 6, min_columns: 4 } : { columns: 12, min_columns: 6 };
    }
    static getStubConfig() { return { title: 'Plants' }; }
    static getConfigForm() {
      return {
        schema: [
          { name: 'title', selector: { text: {} } },
          { name: 'icon', selector: { icon: {} } },
          { name: 'columns', selector: { number: { min: 1, max: 6, mode: 'box' } } },
          { name: 'min_width', selector: { number: { min: 240, max: 800, step: 10, unit_of_measurement: 'px', mode: 'box' } } },
          { name: 'sort', selector: { select: { options: [{ value: 'name', label: 'Name' }, { value: 'urgency', label: 'Most urgent first' }] } } },
        ],
      };
    }
    set hass(h) {
      this._hass = h;
      try {
        const sig = this._plants().map((s) => s.entity_id + s.last_updated + s.state).join('|');
        if (sig !== this._sig) { this._sig = sig; this._renderList(); }
      } catch (e) { this._fail(e); }
    }
    _build() {
      const single = !!this._config.entity;
      this.shadowRoot.innerHTML = '<style>' + CSS + '</style>' + (single ? '' :
        '<div class="top"><div class="title"><ha-icon icon="' + esc(this._config.icon) + '"></ha-icon>' + esc(this._config.title) +
        '</div><button class="add" data-a="add"><ha-icon icon="mdi:plus"></ha-icon>Add plant</button></div>' +
        '<div class="chips"><button class="chip" data-a="fw"><ha-icon icon="mdi:watering-can"></ha-icon>Only plants needing water</button>' +
        '<button class="chip" data-a="ff"><ha-icon icon="mdi:sack"></ha-icon>Only plants needing fertiliser</button></div>') +
        '<div id="list"></div><div id="dlg"></div>';
      // the listeners sit on the shadow root itself, so they are added only once
      if (!this._wired) {
        this._wired = true;
        this.shadowRoot.addEventListener('click', (e) => this._click(e));
        this.shadowRoot.addEventListener('change', (e) => this._change(e));
        this.shadowRoot.addEventListener('input', (e) => this._input(e));
      }
      this._renderList();
    }
    _plants() {
      if (!this._hass) return [];
      return Object.values(this._hass.states)
        .filter((s) => s.entity_id.startsWith('sensor.') && s.attributes && s.attributes.green_finger)
        .sort((a, b) => String(a.attributes.display_name).localeCompare(String(b.attributes.display_name)));
    }
    _renderList() {
      const root = this.shadowRoot; if (!root || !root.getElementById('list')) return;
      const fw = root.querySelector('[data-a=fw]'), ff = root.querySelector('[data-a=ff]');
      if (fw) fw.classList.toggle('on', !!this._f.water);
      if (ff) ff.classList.toggle('on', !!this._f.feed);
      const cfg = this._config || {};
      let ps = this._plants();
      if (cfg.entity) {
        ps = ps.filter((s) => s.entity_id === cfg.entity);
      } else {
        if (this._f.water) ps = ps.filter((s) => ['needs_water', 'needs_both'].includes(s.state));
        if (this._f.feed) ps = ps.filter((s) => ['needs_feed', 'needs_both'].includes(s.state));
        if (cfg.sort === 'urgency') {
          const rank = { needs_both: 0, needs_water: 1, needs_feed: 2, ok: 3 };
          ps = ps.slice().sort((a, b) => (rank[a.state] ?? 4) - (rank[b.state] ?? 4));
        }
      }
      const list = root.getElementById('list');
      const n = Number(cfg.columns);
      const minw = Math.max(200, Number(cfg.min_width) || 380);
      list.style.setProperty('--gf-cols', n >= 1 ? 'repeat(' + Math.round(n) + ',minmax(0,1fr))'
        : 'repeat(auto-fill,minmax(min(100%,' + minw + 'px),1fr))');
      list.innerHTML = ps.length ? ps.map((s) => this._plantHtml(s)).join('')
        : '<div class="empty">' + (cfg.entity ? 'Plant ' + esc(cfg.entity) + ' not found.' : 'No plants to show.') + '</div>';
    }

    /* --------------------------------------------------------------- plant card */
    _plantHtml(s) {
      const a = s.attributes;
      const sevOf = (st) => (st === 'overdue' || st === 'dry' || st === 'wet' ? 2 : (st === 'due' || st === 'low' || st === 'high' ? 1 : 0));
      const sev = Math.max(sevOf(a.water_status), sevOf(a.feed_status), sevOf(a.moisture_status));
      const col = [GRN, AMB, RED][sev];
      const bgc = ['rgba(52,208,88,.20),rgba(52,208,88,.04)', 'rgba(255,176,0,.26),rgba(255,176,0,.06)', 'rgba(255,59,48,.30),rgba(255,59,48,.07)'][sev];
      const bg = 'linear-gradient(90deg,' + col + ' 0 4px,transparent 4px),linear-gradient(160deg,' + bgc + ')';
      const cols = [];
      cols.push(a.water_interval > 0 ? dayCol('WATER', 'krw', a.water_days_left, a.water_interval, fmt(a.last_watered))
        : restCol('WATER', 'rest period', 'last ' + fmt(a.last_watered)));
      cols.push(a.feed_interval > 0 ? dayCol('FERTILISE', 'krf', a.feed_days_left, a.feed_interval, fmt(a.last_fertilised))
        : restCol('FERTILISE', 'rest period', 'last ' + fmt(a.last_fertilised)));
      const im = a.ideal_moisture || [20, 60], it = a.ideal_temperature || [15, 30];
      if (isNum(a.moisture)) cols.push(zCol('MOISTURE', Number(a.moisture), 0, 100, 50, im[0], im[1], 3, '%', ['dry', 'low', 'ok', 'high', 'wet'], 'ideal ' + im[0] + '-' + im[1] + '%'));
      if (isNum(a.temperature)) cols.push(zCol('TEMP', Number(a.temperature), 0, 50, 50, it[0], it[1], 2, 'C', ['cold', 'cool', 'ok', 'warm', 'hot'], 'ideal ' + it[0] + '-' + it[1] + 'C'));
      let batt = '';
      if (isNum(a.battery)) {
        const bl = Math.max(0, Math.min(100, Math.round(a.battery)));
        const ic = bl >= 95 ? 'mdi:battery' : (bl < 10 ? 'mdi:battery-alert' : 'mdi:battery-' + (Math.round(bl / 10) * 10));
        const bc = bl > 50 ? GRN : (bl >= 20 ? AMB : RED);
        batt = '<div class="batt"><b style="color:' + bc + '"><ha-icon icon="' + ic + '" style="--mdc-icon-size:20px;color:' + bc + '"></ha-icon>' + bl + '%</b>' +
          (a.sensor_name ? '<small>' + esc(a.sensor_name) + '</small>' : '') + '</div>';
      }
      const ps = 'width:88px;height:88px;object-fit:cover;border-radius:16px;border:2px solid ' + col + ';box-shadow:0 0 14px ' + col + '66;display:block';
      const pic = a.picture ? '<img src="' + esc((a.picture)) + '" style="' + ps + '" onerror="this.style.display=\'none\'">'
        : '<div style="' + ps + ';background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center"><ha-icon icon="mdi:sprout" style="--mdc-icon-size:44px;color:' + MUT + '"></ha-icon></div>';
      const sci = a.species_name && String(a.species_name).toLowerCase() !== String(a.display_name).toLowerCase()
        ? '<div class="sci">' + esc(a.species_name) + '</div>' : '';
      const where = [a.area, a.location].filter(Boolean).map(esc).join(' - ');
      const period = a.water_period ? ' - ' + esc(a.water_period) : '';
      const eid = s.entity_id;
      const btn = (act, icon, color) => '<button data-a="' + act + '" data-e="' + esc(eid) + '"><ha-icon icon="' + icon + '" style="color:' + color + ';--mdc-icon-size:22px"></ha-icon></button>';
      return '<div class="plant" style="background:' + bg + '">' + batt +
        '<div class="head">' + pic + '<div style="min-width:0"><div class="nm">' + esc(a.display_name) + '</div>' + sci +
        (where ? '<div class="info"><ha-icon icon="mdi:map-marker" style="--mdc-icon-size:13px"></ha-icon> ' + where + '</div>' : '') +
        '<div class="info">Watered ' + fmt(a.last_watered) + ' (' + ago(a.last_watered) + ')' + period + '</div></div></div>' +
        '<div class="gauges" style="grid-template-columns:repeat(' + cols.length + ',1fr)">' + cols.join('') + '</div>' +
        '<div class="acts">' + btn('water', 'mdi:watering-can', '#4aa8ff') + btn('feed', 'mdi:sack', GRN) + btn('info', 'mdi:information', '#fff') +
        btn('edit', 'mdi:cog', '#ffcc00') + btn('del', 'mdi:delete', 'rgba(255,60,60,.8)') + '</div></div>';
    }

    /* ------------------------------------------------------------------ events */
    _target(eid) { return { entity_id: eid }; }
    _click(e) {
      const t = e.target.closest('[data-a]'); if (!t) return;
      const act = t.dataset.a, eid = t.dataset.e;
      const h = this._hass;
      if (act === 'ov') { if (e.target === t) this._closeDlg(); return; } // the backdrop only, never clicks inside the dialog
      if (act === 'fw' || act === 'ff') {
        const k = act === 'fw' ? 'water' : 'feed';
        this._f[k] = !this._f[k];
        try { localStorage.setItem('green-finger-filters', JSON.stringify(this._f)); } catch (x) { /* ignore */ }
        this._renderList(); return;
      }
      if (act === 'water') { h.callService(DOMAIN, 'water', {}, this._target(eid)); return; }
      if (act === 'feed') { h.callService(DOMAIN, 'fertilise', {}, this._target(eid)); return; }
      if (act === 'del') {
        const s = h.states[eid];
        if (s && window.confirm('Delete ' + s.attributes.display_name + '?')) h.callService(DOMAIN, 'remove_plant', {}, this._target(eid));
        return;
      }
      if (act === 'info') { this._openInfo(eid); return; }
      if (act === 'edit') { this._openForm('edit', eid); return; }
      if (act === 'add') { this._openForm('add'); return; }
      if (act === 'close') { this._closeDlg(); return; }
      if (act === 'save') { this._save(); return; }
      if (act === 'fill') { this._fill(); return; }
      if (act === 'nopic') { this._d.picture = ''; this._renderForm(); return; }
      if (act === 'inside') { this._d.inside = t.dataset.v === '1'; this._renderForm(); return; }
      if (act === 'addper') { const k = t.dataset.k; if (this._d[k].length < MAXP) { this._d[k].push([3, 1, 11, 30, 14]); this._renderForm(); } return; }
      if (act === 'delper') { this._d[t.dataset.k].splice(+t.dataset.i, 1); this._renderForm(); return; }
      if (act === 'pick') { this._pick(t.dataset.pid); return; }
      if (act === 'togglelist') { this._d.listOpen = !this._d.listOpen; this._renderForm(); return; }
      if (act === 'cam') { this._camera(); return; }
      if (act === 'snap') { this._snap(); return; }
      if (act === 'camstop') { this._stopCamera(); this._renderForm(); return; }
    }
    _input(e) {
      const t = e.target;
      if (t.id === 'q') {
        clearTimeout(this._qt);
        this._qt = setTimeout(() => this._search(), 900);
      }
    }
    _change(e) {
      const t = e.target; if (!this._d) return;
      if (t.id === 'file' || t.id === 'file-cam') { this._upload(t.files && t.files[0]); return; }
      if (!t.dataset.f) return;
      const f = t.dataset.f, d = this._d;
      const plain = ['name', 'common_name', 'species', 'location', 'area', 'last_watered', 'last_fertilised', 'moisture_entity',
        'fertiliser_name', 'soil_mix', 'soil_notes', 'notes'];
      if (plain.includes(f)) d[f] = t.value;
      else if (f === 'mr0') d.mr[0] = Number(t.value);
      else if (f === 'mr1') d.mr[1] = Number(t.value);
      else if (f === 'tr0') d.tr[0] = Number(t.value);
      else if (f === 'tr1') d.tr[1] = Number(t.value);
      else if (f === 'n') d.npk[0] = t.value === '' ? '' : Number(t.value);
      else if (f === 'p') d.npk[1] = t.value === '' ? '' : Number(t.value);
      else if (f === 'k') d.npk[2] = t.value === '' ? '' : Number(t.value);
      else if (f.startsWith('p:')) {
        const [, k, i, part] = f.split(':');
        const p = d[k][+i];
        const v = Number(t.value);
        if (part === 'sm') p[0] = v;
        else if (part === 'sd') p[1] = Math.max(1, Math.min(LAST[p[0] - 1], v));
        else if (part === 'em') p[2] = v;
        else if (part === 'ed') p[3] = Math.max(1, Math.min(LAST[p[2] - 1], v));
        else p[4] = Math.max(0, v || 0);
        if (part === 'sm' || part === 'em') this._renderForm();
      }
    }

    /* ----------------------------------------------------------------- dialogs */
    _closeDlg() { this._stopCamera(); this._d = null; this.shadowRoot.getElementById('dlg').innerHTML = ''; }
    _stopCamera() {
      if (this._cam) { this._cam.getTracks().forEach((tr) => tr.stop()); this._cam = null; }
      if (this._d) this._d.camera = false;
    }
    async _camera() {
      const d = this._d; if (!d) return;
      const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
      const fallback = () => { const f = this.shadowRoot.getElementById('file-cam'); if (f) f.click(); };
      // the in-page camera needs a secure context (https); otherwise let the device's picker handle it
      if (!(typeof window !== 'undefined' && window.isSecureContext) || !md || !md.getUserMedia) { fallback(); return; }
      try {
        this._cam = await md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        d.camera = true; d.uploadError = '';
        this._renderForm();
      } catch (e) { this._cam = null; fallback(); }
    }
    _snap() {
      const v = this.shadowRoot.getElementById('cam');
      if (!v || !v.videoWidth) return;
      const scale = Math.min(1, 1280 / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((blob) => {
        this._stopCamera();
        if (blob) this._upload(new File([blob], 'plant.jpg', { type: 'image/jpeg' }));
        else this._renderForm();
      }, 'image/jpeg', 0.85);
    }
    _show(html) {
      this.shadowRoot.getElementById('dlg').innerHTML = '<div class="ov" data-a="ov"><div class="dlg">' + html + '</div></div>';
    }
    _openInfo(eid) {
      const s = this._hass.states[eid]; if (!s) return;
      const a = s.attributes, c = a.care || {};
      const tbl = (name, ps) => '<div class="sec">' + name + '</div>' + (ps && ps.length ? '<table>' + ps.map((p) =>
        '<tr><td>' + p[1] + ' ' + MON[p[0] - 1] + ' - ' + p[3] + ' ' + MON[p[2] - 1] + '</td><td>' + (p[4] > 0 ? 'every ' + p[4] + ' days' : 'rest') + '</td></tr>').join('') + '</table>' : '<div class="tip">None</div>');
      const tip = (label, v) => (v ? '<div class="tip"><b>' + label + '</b>' + esc(v).replace(/\n/g, '<br>') + '</div>' : '');
      const im = a.ideal_moisture || [], it = a.ideal_temperature || [];
      const soil = (a.soil_mix || []).length ? '<tr><td>Soil mix</td><td>' + a.soil_mix.map((x) => esc(x.percent + '% ' + x.name)).join(', ') + '</td></tr>' : '';
      this._show('<h2>' + esc(a.display_name) + '<button class="x" data-a="close">&times;</button></h2>' +
        (a.picture ? '<div style="text-align:center"><img src="' + esc((a.picture)) + '" style="height:150px;border-radius:12px"></div>' : '') +
        '<div class="tip" style="text-align:center"><i>' + esc(a.species_name || '') + '</i>' + (a.species_alias ? ' - ' + esc(a.species_alias) : '') +
        ((a.common_names || []).length ? '<br><small>Also known as: ' + esc(a.common_names.slice(0, 8).join(', ')) + '</small>' : '') + '</div>' +
        '<table>' + (a.area ? '<tr><td>Room</td><td>' + esc(a.area) + '</td></tr>' : '') + (a.location ? '<tr><td>Spot</td><td>' + esc(a.location) + '</td></tr>' : '') +
        '<tr><td>Grown</td><td>' + (a.inside ? 'inside' : 'outside') + '</td></tr>' +
        '<tr><td>Soil moisture</td><td>' + im[0] + ' - ' + im[1] + ' %</td></tr><tr><td>Temperature</td><td>' + it[0] + ' - ' + it[1] + ' C</td></tr>' +
        (a.fertiliser_npk_label ? '<tr><td>Fertiliser N-P-K</td><td>' + esc(a.fertiliser_npk_label) + (a.fertiliser_name ? ' (' + esc(a.fertiliser_name) + ')' : '') + '</td></tr>' : '') +
        soil + (a.soil_notes ? '<tr><td>Soil notes</td><td>' + esc(a.soil_notes) + '</td></tr>' : '') +
        (c.min_env_humid != null ? '<tr><td>Air humidity</td><td>' + c.min_env_humid + ' - ' + c.max_env_humid + ' %</td></tr>' : '') +
        (c.min_light_lux != null ? '<tr><td>Light</td><td>' + c.min_light_lux + ' - ' + c.max_light_lux + ' lux</td></tr>' : '') +
        (c.origin ? '<tr><td>Origin</td><td>' + esc(c.origin) + '</td></tr>' : '') + (c.category ? '<tr><td>Family</td><td>' + esc(c.category) + '</td></tr>' : '') + '</table>' +
        tbl('WATERING SCHEDULE', a.water_schedule) + tbl('FEEDING SCHEDULE', a.feed_schedule) +
        '<div class="sec">CARE TIPS</div>' + tip('WATERING', c.watering) + tip('FEEDING', c.fertilization) + tip('SUNLIGHT', c.sunlight) +
        tip('SOIL', c.soil) + tip('PRUNING', c.pruning) + (a.notes ? tip('MY NOTES', a.notes) : '') + '<div class="tip"><small>Species data: OpenPlantbook</small></div>');
    }
    _sensors() {
      const h = this._hass;
      const all = Object.values(h.states).filter((s) => s.entity_id.startsWith('sensor.') && s.attributes.device_class === 'moisture');
      const pref = all.filter((s) => /soil_moisture$/.test(s.entity_id));
      return (pref.length ? pref : all).sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    }
    _sensorOwners(exceptEid) {
      const out = {};
      this._plants().forEach((s) => {
        const me = s.attributes.moisture_entity;
        if (me && s.entity_id !== exceptEid) out[me] = s.attributes.display_name || s.entity_id;
      });
      return out;
    }
    _areas() {
      const a = (this._hass && this._hass.areas) || {};
      return Object.values(a).sort((x, y) => String(x.name).localeCompare(String(y.name)));
    }
    _areaIdOf(eid, name) {
      const h = this._hass;
      const ent = h.entities && h.entities[eid];
      const dev = ent && ent.device_id && h.devices && h.devices[ent.device_id];
      if (dev && dev.area_id) return dev.area_id;
      const hit = this._areas().find((x) => x.name === name);
      return hit ? hit.area_id : '';
    }
    _today() { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); }
    _openForm(mode, eid) {
      if (mode === 'edit') {
        const s = this._hass.states[eid]; if (!s) return;
        const a = s.attributes;
        this._d = {
          mode, eid, name: a.plant_name, common_name: a.common_name || '', species: a.species || '', common_names: (a.common_names || []).slice(),
          inside: a.inside !== false, area: this._areaIdOf(eid, a.area), location: a.location || '',
          picture: a.user_picture ? a.picture : '', speciesPicture: a.species_picture || '',
          last_watered: a.last_watered, last_fertilised: a.last_fertilised,
          water: JSON.parse(JSON.stringify(a.water_schedule || [])), feed: JSON.parse(JSON.stringify(a.feed_schedule || [])),
          moisture_entity: a.moisture_entity || '', mr: (a.ideal_moisture || [20, 60]).slice(), tr: (a.ideal_temperature || [15, 30]).slice(),
          npk: (a.fertiliser_npk || ['', '', '']).slice(), fertiliser_name: a.fertiliser_name || '',
          soil_mix: fmtSoil(a.soil_mix), soil_notes: a.soil_notes || '', notes: a.notes || '',
        };
      } else {
        const iso = this._today();
        this._d = {
          mode, name: '', common_name: '', species: '', common_names: [], inside: true, area: '', location: '',
          picture: '', speciesPicture: '', last_watered: iso, last_fertilised: iso,
          water: [[1, 1, 12, 31, 14]], feed: [[3, 1, 11, 30, 30]], moisture_entity: '', mr: [20, 60], tr: [15, 30],
          npk: ['', '', ''], fertiliser_name: '', soil_mix: '', soil_notes: '', notes: '', results: null, searching: false, picked: '',
        };
      }
      this._renderForm();
    }
    _renderForm() {
      const d = this._d; if (!d) return;
      const monOpts = (sel) => MON.map((m, i) => '<option value="' + (i + 1) + '"' + (i + 1 === sel ? ' selected' : '') + '>' + m + '</option>').join('');
      const per = (k, label) => {
        const rows = d[k].map((p, i) => '<div class="per">' +
          '<label class="fld">From<div class="md"><select data-f="p:' + k + ':' + i + ':sm">' + monOpts(p[0]) + '</select>' +
          '<input type="number" min="1" max="31" value="' + p[1] + '" data-f="p:' + k + ':' + i + ':sd"></div></label>' +
          '<label class="fld">To<div class="md"><select data-f="p:' + k + ':' + i + ':em">' + monOpts(p[2]) + '</select>' +
          '<input type="number" min="1" max="31" value="' + p[3] + '" data-f="p:' + k + ':' + i + ':ed"></div></label>' +
          '<label class="fld">Every (d)<input type="number" min="0" max="365" value="' + p[4] + '" data-f="p:' + k + ':' + i + ':d"></label>' +
          '<button class="btn d" data-a="delper" data-k="' + k + '" data-i="' + i + '">&times;</button></div>').join('');
        return '<div class="sec">' + label + ' (days 0 = rest, outside = rest)</div>' + rows +
          (d[k].length < MAXP ? '<button class="btn" data-a="addper" data-k="' + k + '">+ Add period</button>' : '');
      };
      const sens = this._sensors();
      const owners = this._sensorOwners(d.eid);
      const sopts = '<option value="">No sensor</option>' + sens.map((s) => {
        const used = owners[s.entity_id] && s.entity_id !== d.moisture_entity;
        return '<option value="' + esc(s.entity_id) + '"' + (s.entity_id === d.moisture_entity ? ' selected' : '') + (used ? ' disabled' : '') + '>' +
          esc(s.attributes.friendly_name || s.entity_id) + (used ? ' (used by ' + esc(owners[s.entity_id]) + ')' : '') + '</option>';
      }).join('') +
        (d.moisture_entity && !sens.some((s) => s.entity_id === d.moisture_entity) ? '<option value="' + esc(d.moisture_entity) + '" selected>' + esc(d.moisture_entity) + '</option>' : '');
      const aopts = '<option value="">No room</option>' + this._areas().map((x) => '<option value="' + esc(x.area_id) + '"' + (x.area_id === d.area ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
      const cn = '<option value="">Plant name</option>' + d.common_names.map((n) => '<option value="' + esc(n) + '"' + (n === d.common_name ? ' selected' : '') + '>' + esc(n) + '</option>').join('') +
        (d.common_name && !d.common_names.includes(d.common_name) ? '<option value="' + esc(d.common_name) + '" selected>' + esc(d.common_name) + '</option>' : '');
      let search = '';
      if (d.mode === 'add') {
        const spin = (t) => '<div class="spin"><span class="loader"></span>' + t + '</div>';
        const picked = (d.results || []).find((r) => r.pid === d.picked);
        const rows = (d.results || []).map((r) =>
          '<div class="res' + (r.pid === d.picked ? ' on' : '') + '" data-a="pick" data-pid="' + esc(r.pid) + '">' +
          (r.image_url ? '<img src="' + esc(r.image_url) + '">' : '<img>') +
          '<div><b>' + esc(r.display) + (r.pid === d.picked ? ' \u2713' : '') + '</b>' +
          '<small>' + esc((r.common_names || []).slice(0, 3).join(', ') || (r.alias && r.alias !== r.pid ? r.alias : '')) + '</small>' +
          (r.min_soil_moist != null ? '<small>Soil ' + r.min_soil_moist + '-' + r.max_soil_moist + '% &middot; ' + (r.min_temp ?? '?') + '-' + (r.max_temp ?? '?') + ' C</small>' : '') +
          (r.via ? '<small>via ' + esc(r.via) + '</small>' : '') + '</div></div>').join('');
        let list = '';
        if (d.results && d.results.length) {
          if (picked && !d.listOpen) {
            list = '<div class="picked" data-a="togglelist">' + (d.speciesPicture ? '<img src="' + esc(d.speciesPicture) + '">' : '') +
              '<div class="grow"><b>' + esc(picked.display) + '</b><div class="note" style="margin:0">Tap to choose another species</div></div>' +
              '<ha-icon icon="mdi:chevron-down"></ha-icon></div>';
          } else {
            list = (picked ? '<div class="picked" data-a="togglelist"><div class="grow"><b>' + esc(picked.display) + '</b></div><ha-icon icon="mdi:chevron-up"></ha-icon></div>' : '') + rows;
          }
        } else if (d.results) {
          list = '<div class="spin">No match found for "' + esc(d.q || '') + '".' + (d.note ? '<br>' + esc(d.note) : '') + '</div>';
        }
        search = '<div class="sec">FIND THE SPECIES (OPENPLANTBOOK)</div><label class="fld"><input id="q" type="search" placeholder="Latin or common name, e.g. monstera or marigold" value="' + esc(d.q || '') + '"></label>' +
          (d.searching ? spin('Searching OpenPlantbook...') : '') +
          (d.searchError ? '<div class="spin">' + esc(d.searchError) + '</div>' : '') +
          (d.note && d.results && d.results.length ? '<div class="note">' + esc(d.note) + '</div>' : '') +
          list + (d.picking ? spin('Loading the species data...') : '');
      }
      const shown = d.picture || d.speciesPicture;
      this._show('<h2>' + (d.mode === 'add' ? 'Add a plant' : 'Edit plant') + '<button class="x" data-a="close">&times;</button></h2>' + search +
        '<div class="sec">PLANT</div>' +
        '<div class="pic">' + (shown ? '<img src="' + esc((shown)) + '">' : '<div class="ph"><ha-icon icon="mdi:sprout"></ha-icon></div>') +
        '<div style="flex:1"><div class="g2">' +
        '<button class="btn" data-a="cam" style="display:block;width:100%"><ha-icon icon="mdi:camera" style="--mdc-icon-size:18px"></ha-icon> Take photo</button>' +
        '<input id="file-cam" type="file" accept="image/*" capture="environment" hidden>' +
        '<label class="btn" style="display:block;text-align:center;cursor:pointer"><ha-icon icon="mdi:image" style="--mdc-icon-size:18px"></ha-icon> Choose file<input id="file" type="file" accept="image/*"></label></div>' +
        (d.picture ? '<button class="btn" style="margin-top:6px;width:100%" data-a="nopic">Use species picture</button>' : '') +
        (d.uploadError ? '<div class="spin">' + esc(d.uploadError) + '</div>' : '') + '</div></div>' +
        (d.camera ? '<video id="cam" class="cam" autoplay playsinline muted></video><div class="g2" style="margin-top:6px">' +
          '<button class="btn p" data-a="snap">Capture</button><button class="btn" data-a="camstop">Cancel</button></div>' : '') +
        '<label class="fld">Name<input type="text" value="' + esc(d.name) + '" data-f="name"></label>' +
        '<div class="g2"><label class="fld">Common name shown<select data-f="common_name">' + cn + '</select></label>' +
        '<label class="fld">Moisture sensor<select data-f="moisture_entity">' + sopts + '</select></label></div>' +
        '<div class="g2"><label class="fld">Room<select data-f="area">' + aopts + '</select></label>' +
        '<label class="fld">Spot in the room<input type="text" value="' + esc(d.location) + '" data-f="location" placeholder="south window sill"></label></div>' +
        '<div class="pill"><button data-a="inside" data-v="1" class="' + (d.inside ? 'on' : '') + '">Inside</button><button data-a="inside" data-v="0" class="' + (!d.inside ? 'on' : '') + '">Outside</button></div>' +
        '<div class="g2"><label class="fld">Last watered<input type="date" value="' + esc(d.last_watered) + '" data-f="last_watered"></label>' +
        '<label class="fld">Last fertilised<input type="date" value="' + esc(d.last_fertilised) + '" data-f="last_fertilised"></label></div>' +
        per('water', 'WATERING PERIODS') + per('feed', 'FEEDING PERIODS') +
        '<div class="sec">IDEAL RANGES</div><div class="g2"><label class="fld">Moisture min %<input type="number" value="' + d.mr[0] + '" data-f="mr0"></label>' +
        '<label class="fld">Moisture max %<input type="number" value="' + d.mr[1] + '" data-f="mr1"></label>' +
        '<label class="fld">Temperature min C<input type="number" value="' + d.tr[0] + '" data-f="tr0"></label>' +
        '<label class="fld">Temperature max C<input type="number" value="' + d.tr[1] + '" data-f="tr1"></label></div>' +
        '<div class="sec">FERTILISER (IDEAL N-P-K)</div><div class="g3">' +
        '<label class="fld">N<input type="number" min="0" max="100" step="0.5" value="' + esc(d.npk[0]) + '" data-f="n"></label>' +
        '<label class="fld">P<input type="number" min="0" max="100" step="0.5" value="' + esc(d.npk[1]) + '" data-f="p"></label>' +
        '<label class="fld">K<input type="number" min="0" max="100" step="0.5" value="' + esc(d.npk[2]) + '" data-f="k"></label></div>' +
        '<label class="fld">Fertiliser product<input type="text" value="' + esc(d.fertiliser_name) + '" data-f="fertiliser_name"></label>' +
        '<div class="sec">SOIL MIX</div>' +
        '<label class="fld">One component per line, e.g. 30% perlite<textarea data-f="soil_mix">' + esc(d.soil_mix) + '</textarea></label>' +
        '<label class="fld">Soil notes<input type="text" value="' + esc(d.soil_notes) + '" data-f="soil_notes"></label>' +
        '<label class="fld">Notes<textarea data-f="notes">' + esc(d.notes) + '</textarea></label>' +
        '<label class="fld">OpenPlantbook species ID<input type="text" value="' + esc(d.species) + '" data-f="species"></label>' +
        '<div class="row"><button class="btn" data-a="fill"' + (d.species && !d.filling ? '' : ' disabled') + '>' + (d.filling ? '<span class="loader"></span>' : '') + 'Fill from OpenPlantbook data</button></div>' +
        '<div class="row"><button class="btn p" data-a="save">Save</button><button class="btn" data-a="close">Cancel</button></div>');
      const q = this.shadowRoot.getElementById('q'); if (q && this._keepFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
      if (d.camera && this._cam) { const v = this.shadowRoot.getElementById('cam'); if (v) v.srcObject = this._cam; }
    }
    async _upload(file) {
      const d = this._d; if (!d || !file) return;
      d.uploadError = '';
      try {
        const body = new FormData(); body.append('file', file);
        const res = await this._hass.fetchWithAuth('/api/image/upload', { method: 'POST', body });
        if (!res.ok) throw new Error(res.status === 404 ? 'The Image upload integration is not enabled.' : 'Upload failed (' + res.status + ').');
        const j = await res.json();
        d.picture = '/api/image/serve/' + j.id + '/512x512';
      } catch (e) { d.uploadError = e && e.message ? e.message : String(e); }
      this._renderForm();
    }
    async _search() {
      const d = this._d; if (!d || d.mode !== 'add') return;
      const q = (this.shadowRoot.getElementById('q') || {}).value || '';
      d.q = q; if (q.trim().length < 3) return;
      d.searching = true; d.results = null; d.note = ''; d.searchError = ''; d.picked = ''; d.listOpen = true;
      this._keepFocus = true; this._renderForm();
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: DOMAIN, service: 'search_species', service_data: { query: q.trim() }, return_response: true });
        d.results = (r.response && r.response.results) || [];
        d.note = (r.response && r.response.note) || '';
      } catch (e) { d.results = null; d.searchError = e && e.message ? e.message : 'Search failed.'; }
      d.searching = false; this._renderForm();
    }
    async _pick(pid) {
      const d = this._d; if (!d) return;
      d.picked = pid; d.listOpen = false; d.picking = true; d.searchError = ''; this._keepFocus = false;
      this._renderForm();
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: DOMAIN, service: 'get_species', service_data: { species: pid }, return_response: true });
        this._applySpecies(r.response, true);
      } catch (e) { d.searchError = e && e.message ? e.message : 'Could not load the species.'; d.listOpen = true; }
      d.picking = false;
      this._renderForm();
    }
    async _fill() {
      const d = this._d; if (!d || !d.species) return;
      d.filling = true; d.uploadError = ''; this._renderForm();
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: DOMAIN, service: 'get_species', service_data: { species: d.species, refresh: false }, return_response: true });
        this._applySpecies(r.response, false);
      } catch (e) { d.uploadError = e && e.message ? e.message : 'Could not load the species data.'; }
      d.filling = false;
      this._renderForm();
    }
    _applySpecies(resp, isNew) {
      const d = this._d; if (!d || !resp) return;
      const sp = resp.species || {}, sug = resp.suggestion || {};
      d.species = sp.pid || d.species;
      d.common_names = sug.common_names || [];
      d.speciesPicture = sug.picture || d.speciesPicture;
      if (isNew || !d.name) d.name = sug.name || d.name;
      if (sug.water && sug.water.length) d.water = JSON.parse(JSON.stringify(sug.water));
      if (sug.feed && sug.feed.length) d.feed = JSON.parse(JSON.stringify(sug.feed));
      if (sug.moisture_range) d.mr = sug.moisture_range.map(Number);
      if (sug.temperature_range) d.tr = sug.temperature_range.map(Number);
      if (sug.npk && (isNew || d.npk.every((x) => x === ''))) d.npk = sug.npk.slice();
    }
    async _save() {
      const d = this._d; if (!d) return;
      if (!String(d.name || '').trim()) { window.alert('Give the plant a name.'); return; }
      const npkSet = d.npk.every((x) => x !== '' && x !== null && !isNaN(Number(x)));
      const data = {
        name: d.name.trim(), common_name: d.common_name || '', inside: d.inside,
        location: d.location || '', area: d.area || '', picture: d.picture || '',
        last_watered: d.last_watered, last_fertilised: d.last_fertilised,
        water: d.water, feed: d.feed, moisture_entity: d.moisture_entity || '',
        moisture_range: d.mr, temperature_range: d.tr,
        npk: npkSet ? d.npk.map(Number) : null, fertiliser_name: d.fertiliser_name || '',
        soil_mix: d.soil_mix || '', soil_notes: d.soil_notes || '', notes: d.notes || '',
      };
      if (d.species) data.species = d.species;
      try {
        if (d.mode === 'add') await this._hass.callService(DOMAIN, 'add_plant', data);
        else await this._hass.callService(DOMAIN, 'update_plant', data, { entity_id: d.eid });
        this._closeDlg();
      } catch (e) { window.alert('Could not save: ' + (e && e.message ? e.message : e)); }
    }
  }

  class GreenFingerPlantCard extends GreenFingerCard {
    static getStubConfig(hass) {
      const first = Object.values((hass && hass.states) || {}).find((s) => s.attributes && s.attributes.green_finger);
      return { entity: first ? first.entity_id : '' };
    }
    static getConfigForm() {
      return { schema: [{ name: 'entity', required: true, selector: { entity: { filter: { integration: DOMAIN, domain: 'sensor' } } } }] };
    }
  }

  if (!customElements.get('green-finger-card')) customElements.define('green-finger-card', GreenFingerCard);
  if (!customElements.get('green-finger-plant-card')) customElements.define('green-finger-plant-card', GreenFingerPlantCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c && c.type === 'green-finger-card')) window.customCards.push({ type: 'green-finger-card', name: 'The Green Finger', description: 'All your plants with gauges, care tips and add/edit forms (v' + VER + ')' });
  if (!window.customCards.some((c) => c && c.type === 'green-finger-plant-card')) window.customCards.push({ type: 'green-finger-plant-card', name: 'The Green Finger - one plant', description: 'A single plant card you can place anywhere on a dashboard (v' + VER + ')' });
})();
