/* The Green Finger card - bundled with the green_finger integration.
 *
 * Two cards:
 *   custom:green-finger-card        every plant of the integration (header, filters, "Add plant")
 *   custom:green-finger-plant-card  one plant (option: entity)
 * Both come in two sizes: "large" (LED gauges) and "compact" (one slim row per plant, no gauges).
 * A plant is a sensor entity of the integration (attribute green_finger: true).
 */
(() => {
  'use strict';

  const VER = '0.3.0';
  const DOMAIN = 'green_finger';
  const GRN = '#34d058', AMB = '#ffb000', RED = '#ff3b30', BLU = '#4aa8ff', MUT = 'var(--gf-mut)';
  const SEV_COL = [GRN, AMB, RED];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LAST = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MAXP = 6;
  const H = 104;
  const DEG = '\u00b0C', DASH = '\u2013', DOT = '\u00b7';
  const SIZE_KEY = 'green-finger-size';
  const FILTER_KEY = 'green-finger-filters';
  const SPECIES = new Map(); // species id -> saved OpenPlantbook record; shared by every card on the page

  /* -------------------------------------------------------------- helpers */
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const isNum = (v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v));
  const r1 = (v) => Math.round(Number(v) * 10) / 10;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const parseIso = (d) => {
    const p = String(d || '').split('-');
    return p.length === 3 && +p[1] >= 1 && +p[1] <= 12 ? new Date(+p[0], +p[1] - 1, +p[2]) : null;
  };
  const daysSince = (d) => {
    const t = parseIso(d); if (!t) return null;
    const n = new Date(); n.setHours(0, 0, 0, 0);
    return Math.round((n - t) / 86400000);
  };
  const fmt = (d) => { const t = parseIso(d); return t ? t.getDate() + ' ' + MON[t.getMonth()] : '?'; };
  const fmtLong = (d) => { const t = parseIso(d); return t ? t.getDate() + ' ' + MON[t.getMonth()] + ' ' + t.getFullYear() : '?'; };
  const ago = (d) => { const k = daysSince(d); return k === null ? '' : (k === 0 ? 'today' : (k > 0 ? k + 'd ago' : 'in ' + (-k) + 'd')); };
  const agoLong = (d) => { const k = daysSince(d); return k === null ? '' : (k === 0 ? 'today' : (k > 0 ? plural(k, 'day') + ' ago' : 'in ' + plural(-k, 'day'))); };
  const inDays = (n) => (n === 0 ? 'today' : (n === 1 ? 'tomorrow' : (n > 0 ? 'in ' + plural(n, 'day') : plural(-n, 'day') + ' overdue')));
  const fmtSoil = (mix) => (mix || []).map((c) => c.percent + '% ' + c.name).join('\n');
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h.toString(36); };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const msg = (e) => (e && e.message ? e.message : (typeof e === 'string' ? e : 'Something went wrong.'));

  const sevOf = (a) => {
    const one = (st) => (st === 'overdue' || st === 'dry' || st === 'wet' ? 2 : (st === 'due' || st === 'low' || st === 'high' ? 1 : 0));
    return Math.max(one(a.water_status), one(a.feed_status), one(a.moisture_status));
  };
  const zoneCol = (st) => (st === 'ok' ? GRN : (st === 'low' || st === 'high' || st === 'cool' || st === 'warm' ? AMB : (st ? RED : MUT)));
  const leftCol = (left) => (left <= 1 ? RED : (left <= 4 ? AMB : GRN));
  const battIcon = (bl) => (bl >= 95 ? 'mdi:battery' : (bl < 10 ? 'mdi:battery-alert' : 'mdi:battery-' + (Math.round(bl / 10) * 10)));
  const battCol = (bl) => (bl > 50 ? GRN : (bl >= 20 ? AMB : RED));
  const dayTxt = (interval, left) => {
    if (!(interval > 0)) return 'rest';
    if (left === null || left === undefined) return '?';
    return left < 0 ? 'overdue ' + (-left) + 'd' : (left === 0 ? 'today' : left + 'd');
  };

  /* --------------------------------------------------------------- gauges */
  const colHtml = (label, svg, valTxt, valCol, subTxt) =>
    '<div class="col"><div class="lab">' + label + '</div>' + svg +
    '<div class="val" style="color:' + valCol + '">' + valTxt + '</div><div class="sub">' + subTxt + '</div></div>';
  const vsvg = (inner) => '<svg viewBox="0 0 56 ' + H + '" width="56" height="' + H +
    '" style="display:block;overflow:visible;filter:drop-shadow(0 0 2px rgba(255,255,255,.25))">' +
    '<style>@keyframes ptr{0%,100%{transform:translateX(0)}50%{transform:translateX(-3px)}}</style>' + inner + '</svg>';
  const vrect = (i, cnt, col, on, extra) => {
    const lh = H / cnt;
    return '<rect x="16" y="' + ((cnt - 1 - i) * lh + lh * 0.14).toFixed(2) + '" width="24" height="' + (lh * 0.72).toFixed(2) +
      '" style="fill:' + (on ? col : 'var(--gf-off)') + (extra || '') + '"/>';
  };
  const restCol = (label, txt, sub) => {
    let s = ''; for (let i = 0; i < 20; i++) s += vrect(i, 20, MUT, false);
    return colHtml(label, vsvg(s), txt, MUT, sub);
  };
  const dayCol = (label, pfx, left, interval, last, extra) => {
    const sub = extra ? 'postponed +' + extra + 'd' : '';
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
        inner += vrect(i, cnt, RED, true, ';opacity:.15;animation:' + pfx + i + ' 1.6s linear infinite');
      }
      return colHtml(label, vsvg('<style>' + css + '</style>' + inner), 'overdue ' + (-left) + 'd', RED, sub);
    }
    const dayOf = (i) => (i + 1) * (interval + 1) / cnt;
    const colAt = (i) => (dayOf(i) <= 1.01 ? RED : (dayOf(i) <= 4.01 ? AMB : GRN));
    const lit = Math.max(0, Math.min(cnt, Math.ceil((left + 1) * cnt / (interval + 1))));
    for (let i = 0; i < cnt; i++) inner += vrect(i, cnt, colAt(i), i < lit);
    return colHtml(label, vsvg(inner), left === 0 ? 'due today' : left + 'd left', leftCol(left), sub);
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
    inner += '<polygon points="0,' + (py - 6).toFixed(1) + ' 13,' + py.toFixed(1) + ' 0,' + (py + 6).toFixed(1) +
      '" style="fill:var(--primary-text-color,#fff);animation:ptr 1.8s ease-in-out infinite"/>';
    let st, col;
    if (val < tLo) { st = nm[0]; col = RED; } else if (val < zlo) { st = nm[1]; col = AMB; } else if (val <= zhi) { st = nm[2]; col = GRN; } else if (val <= tHi) { st = nm[3]; col = AMB; } else { st = nm[4]; col = RED; }
    return colHtml(label, vsvg(inner), r1(val) + unit + ' ' + st, col, sub);
  };

  /* ------------------------------------------------------------------ CSS */
  const CSS = `
    :host{display:block;color:var(--primary-text-color);--gf-mut:var(--secondary-text-color,#9aa5b8);--gf-line:var(--divider-color,rgba(127,127,127,.3));
      --gf-off:rgba(127,127,127,.28);--gf-card:var(--card-background-color,#1c1c1c);--gf-field:var(--secondary-background-color,#2a2a2a);
      --gf-pri:var(--primary-color,#03a9f4);--gf-onpri:var(--text-primary-color,#fff);--gf-red:${RED}}
    *{box-sizing:border-box}
    button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
    ha-icon{--mdc-icon-size:20px}
    #body{container-type:inline-size}
    .top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin:0 0 8px}
    .title{order:1;flex:1 1 0;min-width:0;display:flex;align-items:center;gap:8px;font-size:125%;font-weight:500}
    .title span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tools{order:3;flex:1 0 100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
    @container (min-width:640px){.tools{order:2;flex:0 0 auto}.add{order:3}}
    .chip,.ico{display:flex;align-items:center;justify-content:center;background:var(--gf-card);border:1px solid var(--gf-line);height:36px}
    .chip{gap:5px;border-radius:18px;padding:0 12px 0 8px;font-size:90%}
    .chip ha-icon{--mdc-icon-size:18px}
    .chip.on{border-color:var(--gf-pri);box-shadow:0 0 0 1px var(--gf-pri) inset}
    .ico{width:36px;border-radius:50%}
    .add{order:2;display:flex;align-items:center;gap:6px;height:40px;padding:0 16px 0 10px;border:0;border-radius:20px;background:var(--gf-pri);color:var(--gf-onpri);font-weight:600}
    #list{display:grid;gap:10px;grid-template-columns:var(--gf-cols,1fr)}
    #list.c{gap:8px}
    #list>*{min-width:0}
    .empty{padding:24px;text-align:center;color:var(--gf-mut)}
    .plant{position:relative;border-radius:16px;padding:10px 12px 2px;box-shadow:0 2px 8px rgba(0,0,0,.25)}
    .head{display:flex;gap:10px;align-items:center;padding-right:96px;cursor:pointer}
    .nm{font-size:118%;font-weight:600;line-height:1.15}
    .sci{font-size:78%;font-style:italic;opacity:.75;margin-top:2px}
    .info{font-size:72%;color:var(--gf-mut);margin-top:2px}
    .notes{font-size:78%;margin-top:8px;padding:6px 8px;border-radius:8px;background:rgba(127,127,127,.12);white-space:pre-wrap;overflow-wrap:anywhere;max-height:6.5em;overflow:auto}
    .batt{position:absolute;top:10px;right:12px;text-align:right}
    .batt b{display:flex;align-items:center;justify-content:flex-end;font-size:90%;font-weight:600}
    .batt small{display:block;font-size:62%;color:var(--gf-mut);margin-top:1px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gauges{display:grid;gap:2px;margin-top:10px;justify-items:center}
    .col{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0}
    .lab{font-size:66%;letter-spacing:1.2px;color:var(--gf-mut)}
    .val{font-weight:600;font-size:82%;white-space:nowrap}
    .sub{font-size:64%;color:var(--gf-mut);white-space:nowrap;text-align:center}
    .acts{display:flex;justify-content:space-around;border-top:1px solid var(--gf-line);margin-top:4px;padding-top:2px}
    .acts button{background:none;border:0;padding:4px 10px;border-radius:10px}
    .plant.c{display:grid;grid-template-columns:44px minmax(0,1fr) auto;column-gap:10px;align-items:center;padding:7px 4px 7px 10px;border-radius:14px;cursor:pointer}
    .thumb{width:44px;height:44px;border-radius:12px;object-fit:cover;border:2px solid transparent;display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.15)}
    .thumb ha-icon{--mdc-icon-size:24px;color:var(--gf-mut)}
    .c .thumb{grid-column:1;grid-row:1/3}
    .c .nm{grid-column:2;grid-row:1;font-size:105%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .c .acts{grid-column:3;grid-row:1;border:0;margin:0;padding:0;justify-content:flex-end}
    .c .acts button{padding:4px 7px}
    .sts{grid-column:2/4;grid-row:2;display:flex;flex-wrap:wrap;gap:1px 10px;padding-right:8px;font-size:80%}
    .st{display:inline-flex;align-items:center;gap:2px;font-weight:600;white-space:nowrap}
    .st ha-icon{--mdc-icon-size:15px}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:100;display:flex;align-items:flex-end;justify-content:center}
    .dlg{display:flex;flex-direction:column;background:var(--gf-card);color:var(--primary-text-color);width:min(560px,100%);max-height:94vh;max-height:94dvh;border-radius:20px 20px 0 0;overflow:hidden}
    @media(min-width:700px){.ov{align-items:center}.dlg{border-radius:20px;max-height:90vh}}
    .dh{display:flex;align-items:center;gap:10px;padding:12px 6px 8px 16px}
    .dh h2{margin:0;flex:1;min-width:0;font-size:120%;font-weight:600;line-height:1.2;overflow-wrap:anywhere}
    .dh h2 small{display:block;font-size:70%;font-weight:400;font-style:italic;color:var(--gf-mut)}
    .dh img,.dh .ph{flex:none;width:46px;height:46px;border-radius:12px;object-fit:cover;background:rgba(127,127,127,.15);display:flex;align-items:center;justify-content:center}
    .x{flex:none;width:40px;height:40px;background:none;border:0;font-size:150%;line-height:1}
    .db{flex:1;overflow:auto;padding:0 16px 8px;-webkit-overflow-scrolling:touch}
    .df{display:flex;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--gf-line)}
    .df .btn{flex:1}
    .tabs{display:flex;gap:4px;margin:0 16px 8px;padding:3px;border-radius:12px;background:var(--gf-field)}
    .tabs button{flex:1;border:0;border-radius:10px;padding:8px 6px;background:none;font-weight:500}
    .tabs button.on{background:var(--gf-pri);color:var(--gf-onpri)}
    .fld{display:flex;flex-direction:column;gap:3px;font-size:78%;color:var(--gf-mut);margin:0 0 8px;min-width:0}
    .fld input,.fld select,.fld textarea{background:var(--gf-field);color:var(--primary-text-color);border:1px solid var(--gf-line);border-radius:10px;padding:9px 10px;font:inherit;font-size:16px;width:100%;min-width:0}
    .fld textarea{min-height:64px;resize:vertical}
    .fld.chk{flex-direction:row;align-items:center;gap:10px;font-size:90%;color:var(--primary-text-color)}
    .fld.chk input{width:22px;height:22px;flex:none}
    .g2{display:grid;grid-template-columns:1fr 1fr;gap:0 8px}
    .g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0 8px}
    .sec{font-size:72%;letter-spacing:1px;color:var(--gf-mut);margin:12px 0 5px;text-transform:uppercase}
    details.sx{border:1px solid var(--gf-line);border-radius:12px;margin:8px 0}
    details.sx>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;padding:10px 12px;font-weight:500}
    details.sx>summary::-webkit-details-marker{display:none}
    details.sx>summary .t{flex:none;white-space:nowrap}
    details.sx>summary small{flex:1;min-width:0;font-weight:400;color:var(--gf-mut);font-size:80%;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    details.sx>summary ha-icon.chev{flex:none;--mdc-icon-size:18px;transition:transform .15s}
    details.sx[open]>summary ha-icon.chev{transform:rotate(180deg)}
    details.sx>.in{padding:2px 12px 6px}
    .seg{display:flex;gap:6px;margin:0 0 8px}
    .seg button{flex:1;border:1px solid var(--gf-line);border-radius:12px;padding:9px;background:var(--gf-field)}
    .seg button.on{background:var(--gf-pri);color:var(--gf-onpri);border-color:transparent}
    .btn{border:0;border-radius:12px;padding:11px 12px;background:var(--gf-field);font-weight:500}
    .btn.p{background:var(--gf-pri);color:var(--gf-onpri)}
    .btn.d{color:var(--gf-red)}
    .btn.s{padding:6px 10px;font-size:85%}
    .btn[disabled]{opacity:.5;cursor:default}
    .row{display:flex;gap:8px;margin-top:6px}.row .btn{flex:1}
    .idrow{display:flex;flex-wrap:wrap;gap:0 8px;align-items:flex-end}.idrow .fld{flex:1 1 150px}.idrow .btn{flex:1 1 150px;margin:0 0 8px}
    .per{display:grid;grid-template-columns:1fr 1fr;gap:0 8px;align-items:end;padding-bottom:6px;margin:0 0 6px;border-bottom:1px dashed var(--gf-line)}
    .per .fld{margin:0 0 6px}
    .per .btn{margin:0 0 6px;justify-self:end}
    .md{display:grid;grid-template-columns:minmax(0,1fr) 58px;gap:4px}
    .md.ev{grid-template-columns:minmax(0,1fr) auto;align-items:center}
    .md.ev b{font-weight:400;font-size:120%}
    @media(min-width:520px){.per{grid-template-columns:1fr 1fr 110px 40px}}
    @media(max-width:379px){.g2{grid-template-columns:1fr}.per{grid-template-columns:1fr auto}.per .fld:nth-child(-n+2){grid-column:1/-1}}
    .res{display:flex;gap:10px;align-items:center;padding:8px;border-radius:12px;background:var(--gf-field);margin:0 0 6px;cursor:pointer;border:1px solid transparent}
    .res.on{border-color:var(--gf-pri)}
    .res img{width:52px;height:52px;border-radius:10px;object-fit:cover;background:rgba(127,127,127,.15);flex:none}
    .res small{display:block;color:var(--gf-mut)}
    .picked{display:flex;gap:10px;align-items:center;padding:8px;border-radius:12px;background:var(--gf-field);border:1px solid var(--gf-pri);margin:0 0 6px;cursor:pointer}
    .picked img{width:44px;height:44px;border-radius:8px;object-fit:cover}
    .picked .grow{flex:1;min-width:0}
    .note{font-size:80%;color:var(--gf-mut);margin:0 0 8px}
    .spin{padding:12px;text-align:center;color:var(--gf-mut)}
    .err{padding:8px 10px;margin:6px 0;border-radius:10px;background:rgba(255,59,48,.14);color:var(--gf-red);font-size:90%}
    .loader{display:inline-block;width:18px;height:18px;border:3px solid rgba(127,127,127,.3);border-top-color:var(--gf-pri);border-radius:50%;animation:gfspin .8s linear infinite;vertical-align:middle;margin-right:8px}
    @keyframes gfspin{to{transform:rotate(360deg)}}
    .cam{width:100%;border-radius:12px;background:#000;max-height:260px}
    .pic{display:flex;gap:10px;align-items:center;margin:0 0 8px}
    .pic img,.pic .ph{flex:none;width:72px;height:72px;border-radius:14px;object-fit:cover;background:rgba(127,127,127,.15);display:flex;align-items:center;justify-content:center}
    .pic input[type=file],.fld input[type=file]{display:none}
    .pic .bt{flex:1;display:grid;grid-template-columns:1fr 1fr;gap:6px}
    .pic .bt .btn{text-align:center;padding:8px 6px;font-size:90%}
    .pic .bt .full{grid-column:1/-1}
    .kv{display:grid;grid-template-columns:minmax(84px,max-content) minmax(0,1fr);gap:5px 12px;font-size:92%;margin:0 0 6px}
    .kv .k{color:var(--gf-mut)}
    .kv .v{overflow-wrap:anywhere}
    .pp{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:4px 0 8px;font-size:88%}
    .pp span{color:var(--gf-mut);margin-right:2px}
    table{border-collapse:collapse;width:100%;font-size:90%}
    td{padding:4px 6px;border-bottom:1px solid var(--gf-line)}
    .tip{margin:0 0 10px;font-size:92%;line-height:1.45;overflow-wrap:anywhere}
    .tip b{display:block;font-size:72%;letter-spacing:1px;color:var(--gf-mut);font-weight:500;text-transform:uppercase}
    .opbh{display:flex;gap:10px;align-items:center;margin:0 0 6px}
    .opbh img{width:64px;height:64px;border-radius:12px;object-fit:cover;flex:none}
    .meta{font-size:80%;color:var(--gf-mut)}
    .saved{display:flex;gap:8px;align-items:center;justify-content:space-between;margin:6px 0 4px;font-size:85%;color:var(--gf-mut)}
  `;

  const OPB_TIPS = [['watering', 'Watering'], ['fertilization', 'Feeding'], ['sunlight', 'Sunlight'], ['soil', 'Soil'], ['pruning', 'Pruning']];
  const OPB_RANGES = [
    ['Soil moisture', 'min_soil_moist', 'max_soil_moist', ' %'],
    ['Temperature', 'min_temp', 'max_temp', ' ' + DEG],
    ['Air humidity', 'min_env_humid', 'max_env_humid', ' %'],
    ['Light', 'min_light_lux', 'max_light_lux', ' lux'],
    ['Light', 'min_light_mmol', 'max_light_mmol', ' mmol'],
    ['Soil conductivity', 'min_soil_ec', 'max_soil_ec', ' \u00b5S/cm'],
    ['Daily light', 'min_dli', 'max_dli', ' mol/m\u00b2'],
  ];

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
      try { this._f = JSON.parse(localStorage.getItem(FILTER_KEY)) || this._f; } catch (e) { /* ignore */ }
      this._d = null; // the add / edit form
      this._info = null; // the information pop-up
      this._ids = null; // entity ids of the plants (rescanned only when the entity registry changes)
      this._entsRef = null;
      this._rendered = {}; // entity id -> state object that is currently drawn
      this._listKey = '';
      this._size = 'large';
      this._onKey = (e) => { if (e.key === 'Escape' && (this._d || this._info)) this._closeDlg(); };
    }

    get _single() { return false; }

    disconnectedCallback() {
      this._stopCamera();
      clearTimeout(this._qt);
      this._offKey();
    }

    /* --------------------------------------------------------------- config */
    setConfig(config) {
      this._config = Object.assign({ title: 'Plants', icon: 'mdi:sprout', sort: 'name', size: 'large' }, config || {});
      try { this._build(); } catch (e) { this._fail(e); }
    }
    _fail(e) {
      // never leave a bare error box: say what went wrong and what to try
      console.error('green-finger-card:', e); // eslint-disable-line no-console
      if (this.shadowRoot) {
        this.shadowRoot.innerHTML = '<style>' + CSS + '</style><div class="empty">The Green Finger card could not render: ' +
          esc(msg(e)) + '. Reload the page; if this stays, update the integration.</div>';
      }
      this._listKey = ''; this._rendered = {};
    }
    getCardSize() {
      const compact = this._size === 'compact';
      if (this._single) return compact ? 1 : 5;
      const n = (this._ids || []).length || 1;
      return 1 + Math.ceil(n * (compact ? 1 : 5) / Math.max(1, Number(this._config && this._config.columns) || 1));
    }
    getGridOptions() { return this._single ? { columns: 6, min_columns: 3 } : { columns: 12, min_columns: 4 }; }
    static getStubConfig() { return { title: 'Plants' }; }
    static getConfigForm() {
      const labels = {
        title: 'Title', icon: 'Icon', columns: 'Columns (empty = as many as fit)', min_width: 'Minimum card width (px)',
        sort: 'Order', size: 'Card size', entity: 'Plant',
      };
      return {
        schema: [
          { name: 'title', selector: { text: {} } },
          { name: 'icon', selector: { icon: {} } },
          { name: 'size', selector: { select: { options: [{ value: 'large', label: 'Large (with gauges)' }, { value: 'compact', label: 'Compact (one slim row per plant)' }] } } },
          { name: 'sort', selector: { select: { options: [{ value: 'name', label: 'By name' }, { value: 'urgency', label: 'Most urgent first' }] } } },
          { name: 'columns', selector: { number: { min: 1, max: 6, mode: 'box' } } },
          { name: 'min_width', selector: { number: { min: 200, max: 800, step: 10, unit_of_measurement: 'px', mode: 'box' } } },
        ],
        computeLabel: (s) => labels[s.name] || s.name,
      };
    }

    /* --------------------------------------------------------- hass updates */
    set hass(h) {
      this._hass = h;
      if (!this._config) return;
      try { this._sync(false); } catch (e) { this._fail(e); }
    }
    get hass() { return this._hass; }

    _build() {
      const cfg = this._config, single = this._single;
      this._size = this._readSize();
      this.shadowRoot.innerHTML = '<style>' + CSS + '</style><div id="body">' + (single ? '' :
        '<div class="top"><div class="title"><ha-icon icon="' + esc(cfg.icon) + '"></ha-icon><span>' + esc(cfg.title) + '</span></div>' +
        '<div class="tools">' +
        '<button class="chip" data-a="fw" title="Show only the plants that need water"><ha-icon icon="mdi:watering-can"></ha-icon>Needs water</button>' +
        '<button class="chip" data-a="ff" title="Show only the plants that need feeding"><ha-icon icon="mdi:sack"></ha-icon>Needs feeding</button>' +
        '<button class="ico" data-a="size" aria-label="Card size"><ha-icon icon="mdi:view-agenda-outline"></ha-icon></button></div>' +
        '<button class="add" data-a="add"><ha-icon icon="mdi:plus"></ha-icon>Add plant</button></div>') +
        '<div id="list"></div></div><div id="dlg"></div>';
      // the listeners sit on the shadow root itself, so they are added only once
      if (!this._wired) {
        this._wired = true;
        const r = this.shadowRoot;
        r.addEventListener('click', (e) => this._click(e));
        r.addEventListener('change', (e) => this._change(e));
        r.addEventListener('input', (e) => this._input(e));
        r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && e.target.id === 'q') { clearTimeout(this._qt); this._search(); } });
        r.addEventListener('toggle', (e) => {
          const t = e.target;
          if (this._d && t && t.dataset && t.dataset.sec) this._d.open[t.dataset.sec] = t.open;
        }, true);
      }
      this._listKey = ''; this._rendered = {}; this._ids = null;
      this._sync(true);
    }

    _readSize() {
      const cfg = this._config.size === 'compact' ? 'compact' : 'large';
      if (this._single) return cfg;
      try {
        const s = JSON.parse(localStorage.getItem(SIZE_KEY + ':' + this._config.title));
        // the toggle is remembered per device, but only while the dashboard setting is the one it was made against
        if (s && s.base === cfg && (s.size === 'compact' || s.size === 'large')) return s.size;
      } catch (e) { /* ignore */ }
      return cfg;
    }

    /** Entity ids of this integration's plants. Runs only when the entity registry changes, not on every state change. */
    _scan(h) {
      const ents = h.entities;
      if (ents && typeof ents === 'object') {
        const keys = Object.keys(ents);
        if (keys.some((k) => ents[k] && ents[k].platform)) {
          // the integration's summary sensor ("plants needing care") is a sensor too, but it is not a plant
          return keys.filter((k) => {
            if (ents[k].platform !== DOMAIN || !k.startsWith('sensor.')) return false;
            const st = h.states[k];
            return !st || !!(st.attributes && st.attributes.green_finger);
          });
        }
      }
      return Object.keys(h.states).filter((k) => k.startsWith('sensor.') && h.states[k] && h.states[k].attributes && h.states[k].attributes.green_finger);
    }
    _plants() {
      const h = this._hass; if (!h) return [];
      const ids = this._single || !this._ids ? this._scan(h) : this._ids;
      return ids.map((id) => h.states[id]).filter((s) => s && s.attributes && s.attributes.green_finger);
    }

    _sync(force) {
      const h = this._hass; if (!h || !this._config) return;
      const cfg = this._config;
      let changed = !!force;
      if (this._single) {
        const ids = cfg.entity ? [cfg.entity] : [];
        if (!this._ids || this._ids[0] !== ids[0]) { this._ids = ids; changed = true; }
      } else if (this._ids === null || h.entities !== this._entsRef) {
        this._ids = this._scan(h); this._entsRef = h.entities; changed = true;
      }
      for (const id of this._ids) {
        if (h.states[id] !== this._rendered[id]) { changed = true; break; }
      }
      if (this._info) {
        const cur = h.states[this._info.eid];
        if (cur !== this._info.state) { this._info.state = cur; if (cur) this._renderInfo(true); else this._closeDlg(); }
      }
      if (changed) this._renderList();
    }

    /* ----------------------------------------------------------------- list */
    _renderList() {
      const root = this.shadowRoot, list = root && root.getElementById('list'); if (!list || !this._ids || !this._hass) return;
      const cfg = this._config, h = this._hass, compact = this._size === 'compact';
      const fw = root.querySelector('[data-a=fw]'), ff = root.querySelector('[data-a=ff]'), sz = root.querySelector('[data-a=size]');
      if (fw) fw.classList.toggle('on', !!this._f.water);
      if (ff) ff.classList.toggle('on', !!this._f.feed);
      if (sz) {
        sz.setAttribute('title', compact ? 'Switch to the large cards with gauges' : 'Switch to compact cards');
        const ic = sz.querySelector('ha-icon'); if (ic) ic.setAttribute('icon', compact ? 'mdi:view-agenda-outline' : 'mdi:view-list');
      }
      let ps = this._ids.map((id) => h.states[id]).filter((s) => s && s.attributes && s.attributes.green_finger);
      if (!this._single) {
        ps.sort((a, b) => String(a.attributes.display_name).localeCompare(String(b.attributes.display_name)));
        if (this._f.water) ps = ps.filter((s) => ['needs_water', 'needs_both'].includes(s.state));
        if (this._f.feed) ps = ps.filter((s) => ['needs_feed', 'needs_both'].includes(s.state));
        if (cfg.sort === 'urgency') {
          const rank = { needs_both: 0, needs_water: 1, needs_feed: 2, ok: 3 };
          ps = ps.slice().sort((a, b) => (rank[a.state] ?? 4) - (rank[b.state] ?? 4));
        }
      }
      const n = Number(cfg.columns);
      const minw = Math.max(200, Number(cfg.min_width) || (compact ? 300 : 380));
      list.style.setProperty('--gf-cols', n >= 1 ? 'repeat(' + Math.round(n) + ',minmax(0,1fr))'
        : 'repeat(auto-fill,minmax(min(100%,' + minw + 'px),1fr))');
      list.classList.toggle('c', compact);
      const key = this._size + '|' + ps.map((s) => s.entity_id).join(',');
      const draw = (s) => (compact ? this._compactHtml(s) : this._largeHtml(s));
      if (key !== this._listKey) {
        this._listKey = key;
        list.innerHTML = ps.length ? ps.map(draw).join('') : '<div class="empty">' + this._emptyText() + '</div>';
      } else {
        // the same plants in the same order: redraw only the ones whose state changed
        const kids = list.children;
        ps.forEach((s, i) => { if (this._rendered[s.entity_id] !== s && kids[i]) kids[i].outerHTML = draw(s); });
      }
      this._rendered = {};
      ps.forEach((s) => { this._rendered[s.entity_id] = s; });
      this._ids.forEach((id) => { if (!(id in this._rendered)) this._rendered[id] = h.states[id]; });
    }
    _emptyText() {
      const cfg = this._config;
      if (this._single) return cfg.entity ? 'Plant ' + esc(cfg.entity) + ' not found.' : 'Choose a plant in the card settings.';
      return this._f.water || this._f.feed ? 'No plants match the filter.' : 'No plants to show.';
    }

    _battery(a) {
      if (!isNum(a.battery)) return null;
      const bl = Math.max(0, Math.min(100, Math.round(a.battery)));
      return { bl, icon: battIcon(bl), col: battCol(bl) };
    }
    _pic(a, style) {
      return a.picture
        ? '<img src="' + esc(a.picture) + '" style="' + style + '" onerror="this.style.display=\'none\'">'
        : '<div style="' + style + ';display:flex;align-items:center;justify-content:center;background:rgba(127,127,127,.15)"><ha-icon icon="mdi:sprout" style="--mdc-icon-size:44px;color:var(--gf-mut)"></ha-icon></div>';
    }
    _bg(sev) {
      const col = SEV_COL[sev];
      const bgc = ['rgba(52,208,88,.20),rgba(52,208,88,.04)', 'rgba(255,176,0,.26),rgba(255,176,0,.06)', 'rgba(255,59,48,.30),rgba(255,59,48,.07)'][sev];
      return 'linear-gradient(90deg,' + col + ' 0 4px,transparent 4px),linear-gradient(160deg,' + bgc + ')';
    }
    _btn(act, icon, color, eid, label) {
      return '<button data-a="' + act + '" data-e="' + esc(eid) + '" title="' + label + '" aria-label="' + label + '"><ha-icon icon="' + icon +
        '" style="color:' + color + ';--mdc-icon-size:22px"></ha-icon></button>';
    }

    /** The large card: header, LED gauges, buttons. */
    _largeHtml(s) {
      const a = s.attributes, eid = s.entity_id, sev = sevOf(a), col = SEV_COL[sev], hk = hash(eid);
      const cols = [];
      cols.push(a.water_interval > 0
        ? dayCol('WATER', 'kw' + hk, a.water_days_left, a.water_interval, fmt(a.last_watered), a.water_postponed_days)
        : restCol('WATER', 'rest period', ''));
      cols.push(a.feed_interval > 0
        ? dayCol('FERTILISE', 'kf' + hk, a.feed_days_left, a.feed_interval, fmt(a.last_fertilised), a.feed_postponed_days)
        : restCol('FERTILISE', 'rest period', ''));
      const im = a.ideal_moisture || [20, 60], it = a.ideal_temperature || [15, 30];
      if (isNum(a.moisture)) cols.push(zCol('MOISTURE', Number(a.moisture), 0, 100, 50, im[0], im[1], 3, '%', ['dry', 'low', 'ok', 'high', 'wet'], 'ideal ' + im[0] + DASH + im[1] + '%'));
      if (isNum(a.temperature)) cols.push(zCol('TEMP', Number(a.temperature), 0, 50, 50, it[0], it[1], 2, DEG, ['cold', 'cool', 'ok', 'warm', 'hot'], 'ideal ' + it[0] + DASH + it[1] + DEG));
      const b = this._battery(a);
      const batt = b ? '<div class="batt"><b style="color:' + b.col + '"><ha-icon icon="' + b.icon + '" style="--mdc-icon-size:20px;color:' + b.col + '"></ha-icon>' + b.bl + '%</b>' +
        (a.sensor_name ? '<small>' + esc(a.sensor_name) + '</small>' : '') + '</div>' : '';
      const pic = this._pic(a, 'width:88px;height:88px;object-fit:cover;border-radius:16px;border:2px solid ' + col + ';box-shadow:0 0 14px ' + col + '66;display:block;flex:none');
      const sci = a.species_name && String(a.species_name).toLowerCase() !== String(a.display_name).toLowerCase()
        ? '<div class="sci">' + esc(a.species_name) + '</div>' : '';
      const where = [a.area, a.location].filter(Boolean).map(esc).join(' ' + DASH + ' ');
      const sched = (label, interval, period, postponed) => '<div class="info">' + label + ' ' +
        (interval > 0 ? 'every ' + plural(interval, 'day') : 'resting') +
        (period && period !== '1 Jan - 31 Dec' ? ' <span style="white-space:nowrap">' + DOT + ' ' + esc(period) + '</span>' : '') +
        (postponed > 0 ? ' <span style="white-space:nowrap">' + DOT + ' postponed ' + postponed + 'd</span>' : '') + '</div>';
      const notes = a.notes && String(a.notes).trim()
        ? '<div class="notes" title="Notes">' + esc(String(a.notes).trim()) + '</div>' : '';
      return '<div class="plant" style="background:' + this._bg(sev) + '">' + batt +
        '<div class="head" data-a="info" data-e="' + esc(eid) + '">' + pic + '<div style="min-width:0"><div class="nm">' + esc(a.display_name) + '</div>' + sci +
        sched('Water', a.water_interval, a.water_period, a.water_postponed_days) +
        sched('Feed', a.feed_interval, a.feed_period, a.feed_postponed_days) +
        (where ? '<div class="info"><ha-icon icon="mdi:map-marker" style="--mdc-icon-size:13px"></ha-icon> ' + where + '</div>' : '') +
        '</div></div>' +
        '<div class="gauges" style="grid-template-columns:repeat(' + cols.length + ',1fr)">' + cols.join('') + '</div>' +
        notes + '<div class="acts">' + this._btn('water', 'mdi:watering-can', BLU, eid, 'Watered today') + this._btn('feed', 'mdi:sack', GRN, eid, 'Fertilised today') +
        this._btn('info', 'mdi:information', 'var(--primary-text-color)', eid, 'Information') + this._btn('edit', 'mdi:cog', '#ffcc00', eid, 'Edit plant') + '</div></div>';
    }

    /** The compact card: one slim row, no gauges. */
    _compactHtml(s) {
      const a = s.attributes, eid = s.entity_id, sev = sevOf(a), col = SEV_COL[sev];
      const st = (icon, txt, c, title) => '<span class="st" style="color:' + c + '" title="' + esc(title) + '"><ha-icon icon="' + icon + '"></ha-icon>' + esc(txt) + '</span>';
      const sts = [];
      sts.push(st('mdi:watering-can', dayTxt(a.water_interval, a.water_days_left),
        a.water_interval > 0 && a.water_days_left != null ? leftCol(a.water_days_left) : MUT, 'Watering'));
      sts.push(st('mdi:sack', dayTxt(a.feed_interval, a.feed_days_left),
        a.feed_interval > 0 && a.feed_days_left != null ? leftCol(a.feed_days_left) : MUT, 'Feeding'));
      if (isNum(a.moisture)) sts.push(st('mdi:water-percent', Math.round(a.moisture) + '%', zoneCol(a.moisture_status), 'Soil moisture'));
      if (isNum(a.temperature)) sts.push(st('mdi:thermometer', r1(a.temperature) + '\u00b0', zoneCol(a.temperature_status), 'Temperature'));
      const b = this._battery(a);
      if (b) sts.push(st(b.icon, b.bl + '%', b.col, 'Battery'));
      const thumb = a.picture
        ? '<img class="thumb" src="' + esc(a.picture) + '" style="border-color:' + col + '" onerror="this.style.display=\'none\'">'
        : '<div class="thumb" style="border-color:' + col + '"><ha-icon icon="mdi:sprout"></ha-icon></div>';
      return '<div class="plant c" data-a="info" data-e="' + esc(eid) + '" style="background:' + this._bg(sev) + '">' + thumb +
        '<div class="nm">' + esc(a.display_name) + '</div>' +
        '<div class="acts">' + this._btn('water', 'mdi:watering-can', BLU, eid, 'Watered today') + this._btn('feed', 'mdi:sack', GRN, eid, 'Fertilised today') +
        this._btn('info', 'mdi:information', 'var(--primary-text-color)', eid, 'Information') + '</div>' +
        '<div class="sts">' + sts.join('') + '</div></div>';
    }

    /* --------------------------------------------------------------- events */
    _notify(message) {
      this.dispatchEvent(new CustomEvent('hass-notification', { detail: { message }, bubbles: true, composed: true }));
    }
    async _call(service, data, eid) {
      try { await this._hass.callService(DOMAIN, service, data, { entity_id: eid }); } catch (e) { this._notify(msg(e)); }
    }
    _click(e) {
      const t = e.target.closest ? e.target.closest('[data-a]') : null; if (!t) return;
      const act = t.dataset.a, eid = t.dataset.e, d = this._d;
      if (act === 'ov') { if (e.target === t) this._closeDlg(); return; } // the backdrop only, never clicks inside the dialog
      if (act === 'fw' || act === 'ff') {
        const k = act === 'fw' ? 'water' : 'feed';
        this._f[k] = !this._f[k];
        try { localStorage.setItem(FILTER_KEY, JSON.stringify(this._f)); } catch (x) { /* ignore */ }
        this._renderList(); return;
      }
      if (act === 'size') {
        this._size = this._size === 'compact' ? 'large' : 'compact';
        try {
          localStorage.setItem(SIZE_KEY + ':' + this._config.title,
            JSON.stringify({ base: this._config.size === 'compact' ? 'compact' : 'large', size: this._size }));
        } catch (x) { /* ignore */ }
        this._renderList(); return;
      }
      if (act === 'water') { this._call('water', {}, eid); return; }
      if (act === 'feed') { this._call('fertilise', {}, eid); return; }
      if (act === 'info') { this._openInfo(eid); return; }
      if (act === 'edit') { this._openForm('edit', eid); return; }
      if (act === 'add') { this._openForm('add'); return; }
      if (act === 'close') { this._closeDlg(); return; }
      if (act === 'tab') { this._setTab(t.dataset.t); return; }
      if (act === 'opbrefresh') { this._loadOpb(true); return; }
      if (act === 'pp') { this._call('postpone', { kind: t.dataset.k, days: Number(t.dataset.n) }, this._info && this._info.eid); return; }
      if (act === 'editinfo') { const id = this._info && this._info.eid; if (id) this._openForm('edit', id); return; }
      if (!d) return;
      if (act === 'save') { this._save(); return; }
      if (act === 'fill') { this._fill(); return; }
      if (act === 'nopic') { d.picture = ''; this._renderForm(); return; }
      if (act === 'inside') { d.inside = t.dataset.v === '1'; this._renderForm(); return; }
      if (act === 'addper') { const k = t.dataset.k; if (d[k].length < MAXP) { d[k].push([3, 1, 11, 30, 14]); this._renderForm(); } return; }
      if (act === 'delper') { d[t.dataset.k].splice(+t.dataset.i, 1); this._renderForm(); return; }
      if (act === 'pick') { this._pick(t.dataset.pid); return; }
      if (act === 'togglelist') { d.listOpen = !d.listOpen; this._renderForm(); return; }
      if (act === 'cam') { this._camera(); return; }
      if (act === 'snap') { this._snap(); return; }
      if (act === 'camstop') { this._stopCamera(); this._renderForm(); return; }
      if (act === 'delask') { d.confirmDel = true; this._renderForm(); return; }
      if (act === 'delno') { d.confirmDel = false; this._renderForm(); return; }
      if (act === 'delyes') { this._delete(); return; }
    }
    _input(e) {
      const t = e.target, d = this._d;
      if (t.id === 'q') {
        clearTimeout(this._qt);
        this._qt = setTimeout(() => this._search(), 900);
        return;
      }
      // keep typed text in the form data at once, so that no redraw can lose it
      if (d && t.dataset && t.dataset.f && (t.tagName === 'TEXTAREA' || t.type === 'text')) this._setField(t, false);
    }
    _change(e) {
      const t = e.target; if (!this._d) return;
      if (t.id === 'file' || t.id === 'file-cam') { this._upload(t.files && t.files[0]); return; }
      if (t.dataset && t.dataset.f) this._setField(t, true);
    }
    _setField(t, final) {
      const f = t.dataset.f, d = this._d;
      const plain = ['name', 'common_name', 'species', 'location', 'area', 'last_watered', 'last_fertilised', 'moisture_entity',
        'fertiliser_name', 'soil_mix', 'soil_notes', 'notes'];
      if (plain.includes(f)) {
        d[f] = t.value;
        if (f === 'name') d.nameTouched = true;
        if (f === 'species') {
          const b = this.shadowRoot.querySelector('[data-a=fill]');
          if (b) b.disabled = !String(t.value).trim() || !!d.filling;
        }
        if (final && f === 'moisture_entity') { this._renderForm(); return; } // the "mark as watered automatically" switch depends on it
      } else if (f === 'auto_watered') d.auto_watered = !!t.checked;
      else if (!final) return;
      else if (f === 'mr0') d.mr[0] = Number(t.value);
      else if (f === 'mr1') d.mr[1] = Number(t.value);
      else if (f === 'tr0') d.tr[0] = Number(t.value);
      else if (f === 'tr1') d.tr[1] = Number(t.value);
      else if (f === 'n') d.npk[0] = t.value === '' ? '' : Number(t.value);
      else if (f === 'p') d.npk[1] = t.value === '' ? '' : Number(t.value);
      else if (f === 'k') d.npk[2] = t.value === '' ? '' : Number(t.value);
      else if (f.startsWith('p:')) {
        const [, k, i, part] = f.split(':');
        const p = d[k][+i]; if (!p) return;
        const v = Number(t.value);
        const fix = (n) => { if (String(n) !== t.value) t.value = String(n); return n; }; // show the corrected number in place
        if (part === 'sm') p[0] = v;
        else if (part === 'sd') p[1] = fix(Math.max(1, Math.min(LAST[p[0] - 1], Math.round(v) || 1)));
        else if (part === 'em') p[2] = v;
        else if (part === 'ed') p[3] = fix(Math.max(1, Math.min(LAST[p[2] - 1], Math.round(v) || 1)));
        else p[4] = fix(Math.max(0, Math.min(365, Math.round(v) || 0)));
        if (part === 'sm' || part === 'em') { this._renderForm(); return; } // the day limit depends on the month
      }
      this._updateSummaries();
    }
    _summaries(d) {
      return {
        species: esc(d.speciesName || d.species || 'none'),
        care: 'water ' + this._perSummary(d.water) + ', feed ' + this._perSummary(d.feed),
        ranges: 'moisture ' + d.mr[0] + DASH + d.mr[1] + '%, temp ' + d.tr[0] + DASH + d.tr[1] + ' ' + DEG,
        soil: d.npk.every((x) => x !== '') ? 'N-P-K ' + d.npk.join('-') : 'not set',
        notes: d.notes ? esc(String(d.notes).split('\n')[0].slice(0, 28)) : 'none',
      };
    }
    _updateSummaries() {
      const d = this._d; if (!d) return;
      const sum = this._summaries(d);
      this.shadowRoot.querySelectorAll('details.sx').forEach((el) => {
        const small = el.querySelector('summary small');
        if (small && el.dataset.sec in sum) small.innerHTML = sum[el.dataset.sec];
      });
    }

    /* -------------------------------------------------------------- dialogs */
    _offKey() { if (this._keyOn) { this._keyOn = false; document.removeEventListener('keydown', this._onKey); } }
    _closeDlg() {
      this._stopCamera();
      this._d = null; this._info = null;
      this._offKey();
      const dlg = this.shadowRoot && this.shadowRoot.getElementById('dlg');
      if (dlg) dlg.innerHTML = '';
    }
    _stopCamera() {
      if (this._cam) { this._cam.getTracks().forEach((tr) => tr.stop()); this._cam = null; }
      if (this._d) this._d.camera = false;
    }
    /** Draws a dialog: fixed header (+ tabs), scrolling body, fixed footer. `keep` keeps the scroll position. */
    _frame(o) {
      const dlg = this.shadowRoot.getElementById('dlg');
      const old = dlg.querySelector('.db');
      const top = o.keep && old ? old.scrollTop : 0;
      dlg.innerHTML = '<div class="ov" data-a="ov"><div class="dlg" role="dialog" aria-modal="true" tabindex="-1">' +
        '<div class="dh">' + (o.pic || '') + '<h2>' + o.title + (o.sub ? '<small>' + o.sub + '</small>' : '') +
        '</h2><button class="x" data-a="close" aria-label="Close">&times;</button></div>' +
        (o.tabs || '') + '<div class="db">' + o.body + '</div>' + (o.foot ? '<div class="df">' + o.foot + '</div>' : '') + '</div></div>';
      const nb = dlg.querySelector('.db'); if (nb && top) nb.scrollTop = top;
      if (!o.keep) { const box = dlg.querySelector('.dlg'); if (box && box.focus) box.focus({ preventScroll: true }); }
      if (!this._keyOn) { this._keyOn = true; document.addEventListener('keydown', this._onKey); }
    }

    /* ------------------------------------------------------ information pop-up */
    _openInfo(eid) {
      const s = this._hass.states[eid]; if (!s) return;
      this._stopCamera();
      this._d = null;
      this._info = { eid, tab: 'mine', state: s, loading: false, error: '', rec: undefined };
      this._renderInfo(false);
    }
    _setTab(tab) {
      const inf = this._info; if (!inf || inf.tab === tab) return;
      inf.tab = tab; inf.error = '';
      this._renderInfo(false);
      if (tab === 'opb' && inf.rec === undefined) this._loadOpb(false);
    }
    /** The saved OpenPlantbook record of the plant. Never asks OpenPlantbook unless refresh is true or nothing is saved yet. */
    async _loadOpb(refresh) {
      const inf = this._info; if (!inf || inf.loading) return;
      const a = (inf.state && inf.state.attributes) || {};
      if (!a.species) return;
      if (!refresh && SPECIES.has(a.species)) { inf.rec = SPECIES.get(a.species); this._renderInfo(true); return; }
      inf.loading = true; inf.error = ''; this._renderInfo(true);
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: DOMAIN, service: 'get_species', service_data: { species: a.species, refresh: !!refresh }, return_response: true });
        const rec = (r && r.response && r.response.species) || null;
        if (rec) SPECIES.set(a.species, rec);
        if (this._info === inf) { inf.rec = rec; if (refresh && rec) this._notify('OpenPlantbook data refreshed.'); }
      } catch (e) {
        if (this._info === inf) { inf.error = msg(e); if (inf.rec === undefined) inf.rec = null; }
      }
      if (this._info === inf) { inf.loading = false; this._renderInfo(true); }
    }
    _renderInfo(keep) {
      const inf = this._info; if (!inf) return;
      const s = inf.state || this._hass.states[inf.eid]; if (!s) { this._closeDlg(); return; }
      const a = s.attributes;
      const pic = a.picture ? '<img src="' + esc(a.picture) + '" onerror="this.style.display=\'none\'">' : '<div class="ph"><ha-icon icon="mdi:sprout" style="color:var(--gf-mut)"></ha-icon></div>';
      const sciName = a.species_name && String(a.species_name).toLowerCase() !== String(a.display_name).toLowerCase() ? esc(a.species_name) : '';
      const tabs = '<div class="tabs"><button data-a="tab" data-t="mine" class="' + (inf.tab === 'mine' ? 'on' : '') + '">My plant</button>' +
        '<button data-a="tab" data-t="opb" class="' + (inf.tab === 'opb' ? 'on' : '') + '">OpenPlantbook</button></div>';
      this._frame({
        keep, pic, title: esc(a.display_name), sub: sciName, tabs,
        body: inf.tab === 'opb' ? this._opbHtml(a, inf) : this._mineHtml(a),
        foot: '<button class="btn p" data-a="editinfo">Edit plant</button><button class="btn" data-a="close">Close</button>',
      });
    }
    _mineHtml(a) {
      const kv = (k, v) => (v === '' || v == null ? '' : '<div class="k">' + k + '</div><div class="v">' + v + '</div>');
      const colr = (txt, c) => '<span style="color:' + c + ';font-weight:600">' + txt + '</span>';
      const sec = (t) => '<div class="sec">' + t + '</div>';
      const care = (w) => {
        const interval = w ? a.water_interval : a.feed_interval;
        const left = w ? a.water_days_left : a.feed_days_left;
        const last = w ? a.last_watered : a.last_fertilised;
        const next = w ? a.next_water : a.next_feed;
        const period = w ? a.water_period : a.feed_period;
        const extra = (w ? a.water_postponed_days : a.feed_postponed_days) || 0;
        const lines = [];
        lines.push(interval > 0 ? 'every ' + plural(interval, 'day') + (period ? ' (' + esc(period) + ')' : '') : 'resting ' + DASH + ' nothing due in this period');
        if (interval > 0 && left != null) {
          lines.push('Next: ' + colr(left < 0 ? 'was due ' + fmt(next) + ' ' + DASH + ' ' + inDays(left) : fmt(next) + ' ' + DASH + ' ' + inDays(left), leftCol(left)));
        }
        lines.push('Last: ' + fmtLong(last) + (last ? ' (' + agoLong(last) + ')' : ''));
        if (extra > 0) lines.push(colr('Postponed by ' + plural(extra, 'day') + ' (reset when you record it)', AMB));
        return kv(w ? 'Watering' : 'Feeding', lines.join('<br>'));
      };
      const post = (w) => {
        const interval = w ? a.water_interval : a.feed_interval;
        if (!(interval > 0)) return '';
        const k = w ? 'water' : 'feed';
        return '<div class="pp"><span>Postpone ' + (w ? 'watering' : 'feeding') + '</span>' +
          [[1, '+1 day'], [3, '+3 days'], [7, '+1 week']].map((x) => '<button class="btn s" data-a="pp" data-k="' + k + '" data-n="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>';
      };
      const im = a.ideal_moisture || [], it = a.ideal_temperature || [];
      const cond = [];
      if (isNum(a.moisture)) cond.push(kv('Soil moisture', colr(r1(a.moisture) + ' %', zoneCol(a.moisture_status)) + ' ' + esc(a.moisture_status || '') + ' <span class="meta">(ideal ' + im[0] + DASH + im[1] + ' %)</span>'));
      else if (im.length) cond.push(kv('Ideal moisture', im[0] + DASH + im[1] + ' %'));
      if (isNum(a.temperature)) cond.push(kv('Temperature', colr(r1(a.temperature) + ' ' + DEG, zoneCol(a.temperature_status)) + ' ' + esc(a.temperature_status || '') + ' <span class="meta">(ideal ' + it[0] + DASH + it[1] + ' ' + DEG + ')</span>'));
      else if (it.length) cond.push(kv('Ideal temperature', it[0] + DASH + it[1] + ' ' + DEG));
      if (isNum(a.battery)) cond.push(kv('Battery', colr(Math.round(a.battery) + ' %', battCol(a.battery))));
      if (a.moisture_entity) {
        cond.push(kv('Sensor', esc(a.sensor_name || a.moisture_entity)));
        cond.push(kv('Auto watered', a.auto_watered ? 'on' : 'off'));
      } else cond.push(kv('Sensor', 'none linked'));
      const where = [kv('Room', esc(a.area)), kv('Spot', esc(a.location)), kv('Grown', a.inside ? 'inside' : 'outside')].join('');
      const soil = (a.soil_mix || []).map((x) => esc(x.percent + '% ' + x.name)).join('<br>');
      const feed = [kv('N-P-K', a.fertiliser_npk_label ? esc(a.fertiliser_npk_label) : ''), kv('Product', esc(a.fertiliser_name)),
        kv('Soil mix', soil), kv('Soil notes', esc(a.soil_notes))].join('');
      const tbl = (name, ps) => (ps && ps.length ? sec(name) + '<table>' + ps.map((p) =>
        '<tr><td>' + p[1] + ' ' + MON[p[0] - 1] + ' ' + DASH + ' ' + p[3] + ' ' + MON[p[2] - 1] + '</td><td>' + (p[4] > 0 ? 'every ' + p[4] + ' days' : 'rest') + '</td></tr>').join('') + '</table>' : '');
      return sec('Care') + '<div class="kv">' + care(true) + '</div>' + post(true) + '<div class="kv">' + care(false) + '</div>' + post(false) +
        sec('Conditions') + '<div class="kv">' + cond.join('') + '</div>' +
        sec('Place') + '<div class="kv">' + where + '</div>' +
        (feed ? sec('Fertiliser and soil') + '<div class="kv">' + feed + '</div>' : '') +
        (a.notes ? sec('Notes') + '<div class="tip" style="white-space:pre-wrap">' + esc(a.notes) + '</div>' : '') +
        tbl('Watering schedule', a.water_schedule) + tbl('Feeding schedule', a.feed_schedule);
    }
    _opbHtml(a, inf) {
      const spin = (t) => '<div class="spin"><span class="loader"></span>' + t + '</div>';
      if (!a.species) {
        return '<div class="spin">This plant is not linked to an OpenPlantbook species.</div>' +
          '<div class="note" style="text-align:center">Choose <b>Edit plant</b>, search for the species and save, and its care data will appear here.</div>';
      }
      const err = inf.error ? '<div class="err">' + esc(inf.error) + '</div>' : '';
      if (inf.loading) return spin('Asking OpenPlantbook...') + err;
      const rec = inf.rec;
      if (!rec) {
        return err + '<div class="spin">No saved data for <i>' + esc(a.species_name || a.species) + '</i> yet.</div>' +
          '<div class="row"><button class="btn p" data-a="opbrefresh">Download from OpenPlantbook</button></div>';
      }
      const ranges = OPB_RANGES.filter((r) => isNum(rec[r[1]]) || isNum(rec[r[2]])).map((r) =>
        '<tr><td>' + r[0] + '</td><td>' + (isNum(rec[r[1]]) ? rec[r[1]] : '?') + DASH + (isNum(rec[r[2]]) ? rec[r[2]] : '?') + r[3] + '</td></tr>').join('');
      const tips = OPB_TIPS.filter((t) => rec[t[0]]).map((t) => '<div class="tip"><b>' + t[1] + '</b>' + esc(rec[t[0]]).replace(/\n/g, '<br>') + '</div>').join('');
      const meta = [rec.alias, rec.category, rec.origin].filter(Boolean).map(esc).join(' ' + DOT + ' ');
      const names = (a.common_names || []).slice(0, 8);
      const saved = rec.fetched_at ? 'Saved on ' + fmtLong(String(rec.fetched_at).slice(0, 10)) : 'Saved earlier';
      return err + '<div class="opbh">' + (rec.image_url ? '<img src="' + esc(rec.image_url) + '" onerror="this.style.display=\'none\'">' : '') +
        '<div style="min-width:0"><b>' + esc(rec.display_pid || a.species_name) + '</b>' + (meta ? '<div class="meta">' + meta + '</div>' : '') +
        (names.length ? '<div class="meta">Also known as: ' + esc(names.join(', ')) + '</div>' : '') + '</div></div>' +
        '<div class="saved"><span>' + saved + ' ' + DASH + ' kept on this server</span><button class="btn s" data-a="opbrefresh">Refresh</button></div>' +
        (ranges ? '<div class="sec">Ideal conditions</div><table>' + ranges + '</table>' : '') +
        (tips ? '<div class="sec">Care tips</div>' + tips : '<div class="note">OpenPlantbook has no care text for this species.</div>') +
        '<div class="note">Source: OpenPlantbook, saved here so it is not requested again. Refresh asks for it once more.</div>';
    }

    /* ------------------------------------------------------------ add / edit */
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
    _today() {
      const t = new Date();
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    }
    _openForm(mode, eid) {
      this._info = null;
      if (mode === 'edit') {
        const s = this._hass.states[eid]; if (!s) return;
        const a = s.attributes;
        this._d = {
          mode, eid, name: a.plant_name, common_name: a.common_name || '', species: a.species || '', speciesName: a.species_name || '',
          common_names: (a.common_names || []).slice(), inside: a.inside !== false, area: this._areaIdOf(eid, a.area), location: a.location || '',
          picture: a.user_picture ? a.picture : '', speciesPicture: a.species_picture || '',
          last_watered: a.last_watered, last_fertilised: a.last_fertilised,
          water: clone(a.water_schedule || []), feed: clone(a.feed_schedule || []),
          moisture_entity: a.moisture_entity || '', auto_watered: !!a.auto_watered,
          mr: (a.ideal_moisture || [20, 60]).slice(), tr: (a.ideal_temperature || [15, 30]).slice(),
          npk: (a.fertiliser_npk || ['', '', '']).slice(), fertiliser_name: a.fertiliser_name || '',
          soil_mix: fmtSoil(a.soil_mix), soil_notes: a.soil_notes || '', notes: a.notes || '',
          open: {}, nameTouched: true, results: null,
        };
      } else {
        const iso = this._today();
        this._d = {
          mode, name: '', common_name: '', species: '', speciesName: '', common_names: [], inside: true, area: '', location: '',
          picture: '', speciesPicture: '', last_watered: iso, last_fertilised: iso,
          water: [[1, 1, 12, 31, 14]], feed: [[3, 1, 11, 30, 30]], moisture_entity: '', auto_watered: false, mr: [20, 60], tr: [15, 30],
          npk: ['', '', ''], fertiliser_name: '', soil_mix: '', soil_notes: '', notes: '', open: {}, nameTouched: false,
          results: null, searching: false, picked: '',
        };
      }
      this._renderForm(false);
    }
    _perSummary(ps) {
      if (!ps.length) return 'not set';
      const v = ps.filter((p) => p[4] > 0).map((p) => p[4]);
      if (!v.length) return 'rest';
      const lo = Math.min(...v), hi = Math.max(...v);
      return 'every ' + (lo === hi ? lo : lo + DASH + hi) + ' d';
    }
    _speciesBlock(d) {
      const spin = (t) => '<div class="spin"><span class="loader"></span>' + t + '</div>';
      const picked = (d.results || []).find((r) => r.pid === d.picked);
      const rows = (d.results || []).map((r) =>
        '<div class="res' + (r.pid === d.picked ? ' on' : '') + '" data-a="pick" data-pid="' + esc(r.pid) + '">' +
        (r.image_url ? '<img src="' + esc(r.image_url) + '">' : '<img>') +
        '<div><b>' + esc(r.display) + (r.pid === d.picked ? ' \u2713' : '') + '</b>' +
        '<small>' + esc((r.common_names || []).slice(0, 3).join(', ') || (r.alias && r.alias !== r.pid ? r.alias : '')) + '</small>' +
        (r.min_soil_moist != null ? '<small>Soil ' + r.min_soil_moist + DASH + r.max_soil_moist + '% ' + DOT + ' ' + (r.min_temp ?? '?') + DASH + (r.max_temp ?? '?') + ' ' + DEG + '</small>' : '') +
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
      return '<label class="fld">Search OpenPlantbook by name<input id="q" type="search" autocomplete="off" placeholder="Latin or common name, e.g. monstera or marigold" value="' + esc(d.q || '') + '"></label>' +
        (d.searching ? spin('Searching OpenPlantbook...') : '') +
        (d.searchError ? '<div class="err">' + esc(d.searchError) + '</div>' : '') +
        (d.note && d.results && d.results.length ? '<div class="note">' + esc(d.note) + '</div>' : '') +
        list + (d.picking ? spin('Loading the species data...') : '') +
        (d.mode === 'edit' && d.species && d.picked ? '<div class="note">Species changed. Use the button below to copy its schedule and ranges too.</div>' : '') +
        '<div class="idrow"><label class="fld">Species ID<input type="text" value="' + esc(d.species) + '" data-f="species" placeholder="e.g. monstera deliciosa"></label>' +
        '<button class="btn" data-a="fill"' + (d.species && !d.filling ? '' : ' disabled') + '>' + (d.filling ? '<span class="loader"></span>' : '') + 'Fill from OpenPlantbook data</button></div>';
    }
    _renderForm(keep) {
      const d = this._d; if (!d) return;
      const keepScroll = keep !== false;
      const had = this.shadowRoot.activeElement; // the search box keeps the cursor across a redraw
      const qState = had && had.id === 'q' ? [had.selectionStart, had.selectionEnd] : null;
      const monOpts = (sel) => MON.map((m, i) => '<option value="' + (i + 1) + '"' + (i + 1 === sel ? ' selected' : '') + '>' + m + '</option>').join('');
      const per = (k, label) => {
        const rows = d[k].map((p, i) => '<div class="per">' +
          '<label class="fld">From<span class="md"><select data-f="p:' + k + ':' + i + ':sm">' + monOpts(p[0]) + '</select>' +
          '<input type="number" inputmode="numeric" min="1" max="31" value="' + p[1] + '" data-f="p:' + k + ':' + i + ':sd"></span></label>' +
          '<label class="fld">To<span class="md"><select data-f="p:' + k + ':' + i + ':em">' + monOpts(p[2]) + '</select>' +
          '<input type="number" inputmode="numeric" min="1" max="31" value="' + p[3] + '" data-f="p:' + k + ':' + i + ':ed"></span></label>' +
          '<label class="fld">Every<span class="md ev"><input type="number" inputmode="numeric" min="0" max="365" value="' + p[4] + '" data-f="p:' + k + ':' + i + ':d"><b>days</b></span></label>' +
          '<button class="btn d" data-a="delper" data-k="' + k + '" data-i="' + i + '" aria-label="Remove this period">&times;</button></div>').join('');
        return '<div class="sec">' + label + ' <span style="text-transform:none;letter-spacing:0">(0 days = rest; dates outside every period = rest)</span></div>' + rows +
          (d[k].length < MAXP ? '<button class="btn s" data-a="addper" data-k="' + k + '">+ Add period</button>' : '');
      };
      if (!d.sensors) { d.sensors = this._sensors(); d.owners = this._sensorOwners(d.eid); }
      const sens = d.sensors, owners = d.owners;
      const sopts = '<option value="">No sensor</option>' + sens.map((s) => {
        const used = owners[s.entity_id] && s.entity_id !== d.moisture_entity;
        return '<option value="' + esc(s.entity_id) + '"' + (s.entity_id === d.moisture_entity ? ' selected' : '') + (used ? ' disabled' : '') + '>' +
          esc(s.attributes.friendly_name || s.entity_id) + (used ? ' (used by ' + esc(owners[s.entity_id]) + ')' : '') + '</option>';
      }).join('') +
        (d.moisture_entity && !sens.some((s) => s.entity_id === d.moisture_entity) ? '<option value="' + esc(d.moisture_entity) + '" selected>' + esc(d.moisture_entity) + '</option>' : '');
      const aopts = '<option value="">No room</option>' + this._areas().map((x) => '<option value="' + esc(x.area_id) + '"' + (x.area_id === d.area ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('');
      const names = d.common_names.slice();
      if (d.common_name && !names.includes(d.common_name)) names.push(d.common_name);
      const cn = names.length
        ? '<label class="fld">Common name shown<select data-f="common_name"><option value="">Same as the name</option>' +
          names.map((n) => '<option value="' + esc(n) + '"' + (n === d.common_name ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' : '';
      const sum = this._summaries(d);
      const sx = (id, title, inner) => '<details class="sx" data-sec="' + id + '"' + (d.open[id] ? ' open' : '') + '><summary><span class="t">' + title + '</span>' +
        '<small>' + sum[id] + '</small><ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></summary><div class="in">' + inner + '</div></details>';
      const shown = d.picture || d.speciesPicture;
      const add = d.mode === 'add';
      const body =
        (add ? '<div class="sec">Species (optional)</div>' + this._speciesBlock(d)
          : sx('species', 'Species', this._speciesBlock(d))) +
        '<div class="sec">The plant</div>' +
        '<div class="pic">' + (shown ? '<img src="' + esc(shown) + '">' : '<div class="ph"><ha-icon icon="mdi:sprout" style="color:var(--gf-mut)"></ha-icon></div>') +
        '<div class="bt"><button class="btn" data-a="cam"><ha-icon icon="mdi:camera" style="--mdc-icon-size:18px"></ha-icon> Take photo</button>' +
        '<label class="btn" style="cursor:pointer"><ha-icon icon="mdi:image" style="--mdc-icon-size:18px"></ha-icon> Choose file<input id="file" type="file" accept="image/*"></label>' +
        (d.picture ? '<button class="btn full" data-a="nopic">Use the species picture</button>' : '') + '</div>' +
        '<input id="file-cam" type="file" accept="image/*" capture="environment" hidden></div>' +
        (d.uploadError ? '<div class="err">' + esc(d.uploadError) + '</div>' : '') +
        (d.camera ? '<video id="cam" class="cam" autoplay playsinline muted></video><div class="row">' +
          '<button class="btn p" data-a="snap">Capture</button><button class="btn" data-a="camstop">Cancel</button></div>' : '') +
        '<label class="fld">Name<input type="text" autocomplete="off" value="' + esc(d.name) + '" data-f="name" placeholder="e.g. Kitchen basil"></label>' + cn +
        '<div class="g2"><label class="fld">Room<select data-f="area">' + aopts + '</select></label>' +
        '<label class="fld">Spot in the room<input type="text" value="' + esc(d.location) + '" data-f="location" placeholder="south window sill"></label></div>' +
        '<div class="seg"><button data-a="inside" data-v="1" class="' + (d.inside ? 'on' : '') + '">Inside</button><button data-a="inside" data-v="0" class="' + (!d.inside ? 'on' : '') + '">Outside</button></div>' +
        '<label class="fld">Soil moisture sensor (optional)<select data-f="moisture_entity">' + sopts + '</select></label>' +
        (d.moisture_entity ? '<label class="fld chk"><input type="checkbox" data-f="auto_watered"' + (d.auto_watered ? ' checked' : '') + '>' +
          '<span>Mark as watered automatically when the soil gets much wetter</span></label>' : '') +
        sx('care', 'Care schedule',
          '<div class="g2"><label class="fld">Last watered<input type="date" value="' + esc(d.last_watered) + '" data-f="last_watered"></label>' +
          '<label class="fld">Last fertilised<input type="date" value="' + esc(d.last_fertilised) + '" data-f="last_fertilised"></label></div>' +
          per('water', 'Watering periods') + per('feed', 'Feeding periods')) +
        sx('ranges', 'Ideal ranges',
          '<div class="g2"><label class="fld">Moisture min %<input type="number" inputmode="decimal" value="' + d.mr[0] + '" data-f="mr0"></label>' +
          '<label class="fld">Moisture max %<input type="number" inputmode="decimal" value="' + d.mr[1] + '" data-f="mr1"></label>' +
          '<label class="fld">Temperature min ' + DEG + '<input type="number" inputmode="decimal" value="' + d.tr[0] + '" data-f="tr0"></label>' +
          '<label class="fld">Temperature max ' + DEG + '<input type="number" inputmode="decimal" value="' + d.tr[1] + '" data-f="tr1"></label></div>') +
        sx('soil', 'Fertiliser and soil',
          '<div class="g3"><label class="fld">N<input type="number" inputmode="decimal" min="0" max="100" step="0.5" value="' + esc(d.npk[0]) + '" data-f="n"></label>' +
          '<label class="fld">P<input type="number" inputmode="decimal" min="0" max="100" step="0.5" value="' + esc(d.npk[1]) + '" data-f="p"></label>' +
          '<label class="fld">K<input type="number" inputmode="decimal" min="0" max="100" step="0.5" value="' + esc(d.npk[2]) + '" data-f="k"></label></div>' +
          '<label class="fld">Fertiliser product<input type="text" value="' + esc(d.fertiliser_name) + '" data-f="fertiliser_name"></label>' +
          '<label class="fld">Soil mix (one per line, e.g. 30% perlite)<textarea data-f="soil_mix">' + esc(d.soil_mix) + '</textarea></label>' +
          '<label class="fld">Soil notes<input type="text" value="' + esc(d.soil_notes) + '" data-f="soil_notes"></label>') +
        sx('notes', 'Notes',
          '<label class="fld">Your notes<textarea data-f="notes">' + esc(d.notes) + '</textarea></label>') +
        (d.error ? '<div class="err">' + esc(d.error) + '</div>' : '') +
        (d.mode === 'edit' ? (d.confirmDel
          ? '<div class="err">Delete this plant for good?<div class="row"><button class="btn d" data-a="delyes">Yes, delete it</button><button class="btn" data-a="delno">Keep it</button></div></div>'
          : '<div class="row"><button class="btn d s" data-a="delask">Delete this plant</button></div>') : '');
      this._frame({
        keep: keepScroll, title: add ? 'Add a plant' : 'Edit plant', body,
        foot: '<button class="btn p" data-a="save"' + (d.saving ? ' disabled' : '') + '>' + (d.saving ? '<span class="loader"></span>' : '') + 'Save</button><button class="btn" data-a="close">Cancel</button>',
      });
      const q = this.shadowRoot.getElementById('q');
      if (q && qState) { q.focus(); try { q.setSelectionRange(qState[0], qState[1]); } catch (e) { /* ignore */ } }
      if (d.camera && this._cam) { const v = this.shadowRoot.getElementById('cam'); if (v) v.srcObject = this._cam; }
    }

    /* ---------------------------------------------------------------- camera */
    async _camera() {
      const d = this._d; if (!d) return;
      const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
      const fallback = () => { const f = this.shadowRoot.getElementById('file-cam'); if (f) f.click(); };
      // the in-page camera needs a secure context (https); otherwise let the device's own picker handle it
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
    async _upload(file) {
      const d = this._d; if (!d || !file) return;
      d.uploadError = '';
      try {
        const body = new FormData(); body.append('file', file);
        const res = await this._hass.fetchWithAuth('/api/image/upload', { method: 'POST', body });
        if (!res.ok) throw new Error(res.status === 404 ? 'The Image upload integration is not enabled.' : 'Upload failed (' + res.status + ').');
        const j = await res.json();
        d.picture = '/api/image/serve/' + j.id + '/512x512';
      } catch (e) { d.uploadError = msg(e); }
      if (this._d === d) this._renderForm();
    }

    /* ---------------------------------------------------------------- species */
    async _search() {
      const d = this._d; if (!d) return;
      const q = (this.shadowRoot.getElementById('q') || {}).value || '';
      d.q = q; if (q.trim().length < 3) return;
      d.searching = true; d.results = null; d.note = ''; d.searchError = ''; d.picked = ''; d.listOpen = true;
      this._renderForm();
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: DOMAIN, service: 'search_species', service_data: { query: q.trim() }, return_response: true });
        d.results = (r.response && r.response.results) || [];
        d.note = (r.response && r.response.note) || '';
      } catch (e) { d.results = null; d.searchError = msg(e); }
      d.searching = false;
      if (this._d === d) this._renderForm();
    }
    async _pick(pid) {
      const d = this._d; if (!d) return;
      d.picked = pid; d.listOpen = false; d.picking = true; d.searchError = '';
      this._renderForm();
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: DOMAIN, service: 'get_species', service_data: { species: pid }, return_response: true });
        this._applySpecies(r.response, d.mode === 'add');
      } catch (e) { d.searchError = msg(e); d.listOpen = true; }
      d.picking = false;
      if (this._d === d) this._renderForm();
    }
    async _fill() {
      const d = this._d; if (!d || !d.species) return;
      d.filling = true; d.uploadError = ''; this._renderForm();
      try {
        const r = await this._hass.callWS({ type: 'call_service', domain: DOMAIN, service: 'get_species', service_data: { species: d.species, refresh: false }, return_response: true });
        this._applySpecies(r.response, true);
      } catch (e) { d.uploadError = msg(e); }
      d.filling = false;
      if (this._d === d) this._renderForm();
    }
    /** Copies a species into the form. `all` also copies its schedule and ranges (always for a new plant). */
    _applySpecies(resp, all) {
      const d = this._d; if (!d || !resp) return;
      const sp = resp.species || {}, sug = resp.suggestion || {};
      d.species = sp.pid || d.species;
      d.speciesName = sp.display_pid || d.speciesName;
      if (sp.pid && sp.fetched_at !== undefined) SPECIES.set(sp.pid, sp);
      d.common_names = sug.common_names || [];
      d.speciesPicture = sug.picture || d.speciesPicture;
      if (!d.nameTouched || !d.name) d.name = sug.name || d.name;
      if (!all) return;
      if (sug.water && sug.water.length) d.water = clone(sug.water);
      if (sug.feed && sug.feed.length) d.feed = clone(sug.feed);
      if (sug.moisture_range) d.mr = sug.moisture_range.map(Number);
      if (sug.temperature_range) d.tr = sug.temperature_range.map(Number);
      if (sug.npk && (d.mode === 'add' || d.npk.every((x) => x === ''))) d.npk = sug.npk.slice();
    }

    /* ---------------------------------------------------------------- save */
    async _save() {
      const d = this._d; if (!d || d.saving) return;
      if (!String(d.name || '').trim()) { d.error = 'Give the plant a name.'; this._renderForm(); return; }
      const npkSet = d.npk.every((x) => x !== '' && x !== null && !isNaN(Number(x)));
      const data = {
        name: d.name.trim(), common_name: d.common_name || '', inside: d.inside,
        location: d.location || '', area: d.area || '', picture: d.picture || '',
        last_watered: d.last_watered, last_fertilised: d.last_fertilised,
        water: d.water, feed: d.feed, moisture_entity: d.moisture_entity || '', auto_watered: !!(d.moisture_entity && d.auto_watered),
        moisture_range: d.mr, temperature_range: d.tr,
        npk: npkSet ? d.npk.map(Number) : null, fertiliser_name: d.fertiliser_name || '',
        soil_mix: d.soil_mix || '', soil_notes: d.soil_notes || '', notes: d.notes || '',
      };
      if (d.species) data.species = d.species;
      else if (d.mode === 'edit') data.species = null;
      d.saving = true; d.error = ''; this._renderForm();
      try {
        if (d.mode === 'add') await this._hass.callService(DOMAIN, 'add_plant', data);
        else await this._hass.callService(DOMAIN, 'update_plant', data, { entity_id: d.eid });
        if (this._d === d) this._closeDlg();
      } catch (e) {
        if (this._d === d) { d.saving = false; d.error = 'Could not save: ' + msg(e); this._renderForm(); }
      }
    }
    async _delete() {
      const d = this._d; if (!d || d.mode !== 'edit') return;
      try {
        await this._hass.callService(DOMAIN, 'remove_plant', {}, { entity_id: d.eid });
        if (this._d === d) this._closeDlg();
      } catch (e) {
        if (this._d === d) { d.confirmDel = false; d.error = 'Could not delete: ' + msg(e); this._renderForm(); }
      }
    }
  }

  class GreenFingerPlantCard extends GreenFingerCard {
    get _single() { return true; }
    static getStubConfig(hass) {
      const first = Object.values((hass && hass.states) || {}).find((s) => s.attributes && s.attributes.green_finger);
      return { entity: first ? first.entity_id : '' };
    }
    static getConfigForm() {
      const labels = { entity: 'Plant', size: 'Card size' };
      return {
        schema: [
          { name: 'entity', required: true, selector: { entity: { filter: { integration: DOMAIN, domain: 'sensor' } } } },
          { name: 'size', selector: { select: { options: [{ value: 'large', label: 'Large (with gauges)' }, { value: 'compact', label: 'Compact (one slim row)' }] } } },
        ],
        computeLabel: (s) => labels[s.name] || s.name,
      };
    }
  }

  if (!customElements.get('green-finger-card')) customElements.define('green-finger-card', GreenFingerCard);
  if (!customElements.get('green-finger-plant-card')) customElements.define('green-finger-plant-card', GreenFingerPlantCard);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c && c.type === 'green-finger-card')) {
    window.customCards.push({ type: 'green-finger-card', name: 'The Green Finger', description: 'All your plants, large with gauges or compact, with care info and add / edit forms (v' + VER + ')' });
  }
  if (!window.customCards.some((c) => c && c.type === 'green-finger-plant-card')) {
    window.customCards.push({ type: 'green-finger-plant-card', name: 'The Green Finger - one plant', description: 'A single plant card, large or compact, to place anywhere on a dashboard (v' + VER + ')' });
  }
})();
