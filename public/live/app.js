// Iași Live – tramvaiele și autobuzele CTP Iași în timp real, pe o hartă fluidă (MapLibre GL, hărți vectoriale
// OpenFreeMap). Date:
//   /live/vehicule                              pozițiile GPS (Tranzy, prin funcția Netlify), la 30 s
//   ../data/transport/live/forme.json           traseele pe sens („ruta_sens”), stațiile cu distanța de la plecare,
//                                               viteza comercială din orar – generate de scripts/transport_gtfs.py
//   ../data/transport/live/plecari/<id>.json    plecările din orar ale stației (zi lucrătoare / weekend)
//   ../data/transport/gtfs_servicii.json        stațiile și rutele GTFS (route_id → linie)
// Vehiculele se mișcă lin între pozițiile GPS, de-a lungul traseului; sosirea în stație = distanța rămasă pe traseu
// împărțită la viteza comercială a sensului (estimare, marcată „GPS”), alături de plecările din orar.
import * as maplibregl from '../vendor/maplibre-gl/maplibre-gl.mjs';

const D = '../data/transport/';
const POLL_MS = 30000;                                // cât păstrează /live/vehicule răspunsul (cota Tranzy)
const COL = { tramvai: '#e66767', local: '#9085e9', metropolitan: '#d55181', none: '#8f8e86' };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const colorOf = (tip, retea) => (tip === 'tramvai' ? COL.tramvai : retea === 'metropolitan' ? COL.metropolitan : retea ? COL.local : COL.none);
const lineSort = (a, b) => (b.tip === 'tramvai') - (a.tip === 'tramvai') || parseInt(a.linie, 10) - parseInt(b.linie, 10) || a.linie.localeCompare(b.linie);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* mod privat */ } },
};

// ---------- geometrie: distanțe în metri, proiecția pe traseu ----------
const R = 6371000, RAD = Math.PI / 180;
function meters(a, b) {
  const k = Math.cos(((a[1] + b[1]) / 2) * RAD);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * RAD * R;
}
function prepShape(f) {
  const c = f.c, cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + meters(c[i - 1], c[i]));
  f.cum = cum;
  f.len = cum[cum.length - 1];
  return f;
}
// distanța de-a lungul traseului a celui mai apropiat punct; `hint` = poziția anterioară (evită trecerile repetate)
function project(f, p, hint) {
  const c = f.c, cum = f.cum, k = Math.cos(p[1] * RAD);
  let best = null;
  for (let i = 0; i < c.length - 1; i++) {
    if (hint != null && (cum[i + 1] < hint - 400 || cum[i] > hint + 2500)) continue;
    const ax = c[i][0] * k, ay = c[i][1], bx = c[i + 1][0] * k, by = c[i + 1][1], px = p[0] * k, py = p[1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
    const off = Math.hypot(px - (ax + dx * t), py - (ay + dy * t)) * RAD * R;
    if (!best || off < best.off) best = { off, along: cum[i] + (cum[i + 1] - cum[i]) * t };
  }
  if (hint != null && (!best || best.off > 60)) return project(f, p, null);
  return best;
}
function pointAt(f, d) {
  const c = f.c, cum = f.cum;
  d = Math.max(0, Math.min(f.len, d));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo] || 1, t = (d - cum[lo]) / seg;
  return { p: [c[lo][0] + (c[hi][0] - c[lo][0]) * t, c[lo][1] + (c[hi][1] - c[lo][1]) * t], b: bearing(c[lo], c[hi]) };
}
function bearing(a, b) {
  const k = Math.cos(a[1] * RAD);
  return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) / RAD + 360) % 360;
}

// ---------- starea aplicației ----------
const S = { forme: {}, rute: {}, linii: {}, stops: {}, stopShapes: {}, veh: new Map(), sel: null, me: null, updated: 0, error: null };
const favs = new Set(store.get('live.fav', []));

const dark = !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches;
const map = new maplibregl.Map({
  container: 'map',
  style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`,
  center: [27.5866, 47.1585], zoom: 12.6, minZoom: 9, maxZoom: 19, maxPitch: 60,
  attributionControl: { compact: true, customAttribution: 'Date: CTP Iași (orar GTFS, GPS prin <a href="https://tranzy.ai/opendata/" target="_blank" rel="noopener">Tranzy</a>) · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>' },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

// săgeata direcției de mers, desenată o dată (iconiță rotită de hartă)
function arrowImage() {
  const n = 64, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(n / 2, 2); g.lineTo(n / 2 + 9, 16); g.lineTo(n / 2 - 9, 16); g.closePath(); g.fill();
  return { width: n, height: n, data: g.getImageData(0, 0, n, n).data };
}

// ---------- încărcarea datelor ----------
const getJSON = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + ': ' + r.status); return r.json(); });
const ready = Promise.all([getJSON(D + 'live/forme.json'), getJSON(D + 'gtfs_servicii.json'), new Promise((r) => map.on('load', r))])
  .then(([forme, serv]) => {
    Object.entries(forme).forEach(([sid, f]) => { f.sid = sid; S.forme[sid] = prepShape(f); });
    S.rute = serv.rute || {};
    S.linii = serv.linii || {};
    serv.statii.forEach((s) => { S.stops[s.id] = s; });
    Object.values(S.forme).forEach((f) => f.s.forEach(([id, d]) => (S.stopShapes[id] = S.stopShapes[id] || []).push([f.sid, d])));
    addLayers();
    route();
    poll();
  })
  .catch((e) => setStatus('Nu am putut încărca datele: ' + e.message, true));

function addLayers() {
  const lines = Object.values(S.forme).map((f) => ({ type: 'Feature', properties: { sid: f.sid, linie: f.linie, tip: f.tip, col: colorOf(f.tip, f.retea) },
    geometry: { type: 'LineString', coordinates: f.c } }));
  map.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: lines } });
  // deasupra străzilor și podurilor hărții de fundal, sub etichetele care urmează după ele
  const layers = map.getStyle().layers, lastLine = layers.map((l) => l.type).lastIndexOf('line');
  const firstLabel = (layers.slice(lastLine + 1).find((l) => l.type === 'symbol') || {}).id;
  map.addLayer({ id: 'routes', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'col'], 'line-opacity': 0.32, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 3.5] } }, firstLabel);
  map.addLayer({ id: 'routes-sel', type: 'line', source: 'routes', filter: ['==', ['get', 'linie'], '#'], layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'col'], 'line-opacity': 0.95, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7] } }, firstLabel);

  const stops = Object.values(S.stops).filter((s) => S.stopShapes[s.id]).map((s) => ({ type: 'Feature', id: +s.id || undefined,
    properties: { id: s.id, nume: s.nume, n: s.plecari_lucru || 0 }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } }));
  map.addSource('stops', { type: 'geojson', data: { type: 'FeatureCollection', features: stops } });
  map.addLayer({ id: 'stops', type: 'circle', source: 'stops', minzoom: 13,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 2.5, 17, 7], 'circle-color': dark ? '#1a1a19' : '#ffffff',
      'circle-stroke-color': dark ? '#f0efec' : '#232321', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 2] } });
  map.addLayer({ id: 'stops-label', type: 'symbol', source: 'stops', minzoom: 15.5,
    layout: { 'text-field': ['get', 'nume'], 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': dark ? '#c3c2b7' : '#3a3a37', 'text-halo-color': dark ? '#1a1a19' : '#ffffff', 'text-halo-width': 1.2 } });

  if (!map.hasImage('iasi-live-sageata')) map.addImage('iasi-live-sageata', arrowImage(), { sdf: true });
  map.addSource('veh', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'veh-arrow', type: 'symbol', source: 'veh', filter: ['has', 'b'],
    layout: { 'icon-image': 'iasi-live-sageata', 'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.45, 16, 0.75], 'icon-rotate': ['get', 'b'],
      'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': ['get', 'col'], 'icon-opacity': ['get', 'o'] } });
  map.addLayer({ id: 'veh', type: 'circle', source: 'veh',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 6, 16, 11], 'circle-color': ['get', 'col'], 'circle-opacity': ['get', 'o'],
      'circle-stroke-color': dark ? '#1a1a19' : '#ffffff', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': ['get', 'o'] } });
  map.addLayer({ id: 'veh-label', type: 'symbol', source: 'veh', minzoom: 11.5,
    layout: { 'text-field': ['get', 'l'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 11.5, 8, 16, 11],
      'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': '#ffffff', 'text-opacity': ['get', 'o'] } });

  map.on('click', 'veh', (e) => openVehicle(e.features[0].properties.id));
  map.on('click', 'stops', (e) => { if (!map.queryRenderedFeatures(e.point, { layers: ['veh'] }).length) openStop(e.features[0].properties.id); });
  map.on('click', 'routes', (e) => {
    if (map.queryRenderedFeatures(e.point, { layers: ['veh', 'stops'] }).length) return;
    openLine(e.features[0].properties.linie, e.features[0].properties.tip);
  });
  ['veh', 'stops', 'routes'].forEach((l) => {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  });
}

// ---------- vehiculele: interogare la 15 s, mișcare lină între poziții ----------
let pollTimer = null;
function poll() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, POLL_MS);
  if (document.hidden) return;
  fetch('/live/vehicule', { cache: 'no-store' })
    .then((r) => r.json().then((d) => { if (!r.ok) throw new Error(d.eroare || 'eroare ' + r.status); return d; }))
    .then(update)
    .catch((e) => { S.error = e.message; renderStatus(); });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

function shapeOf(v) { return v.ruta && v.sens != null ? S.forme[v.ruta + '_' + v.sens] || null : null; }
function routeOf(v) { return v.ruta ? S.rute[v.ruta] || null : null; }

// Mișcarea: de la ultima poziție GPS, vehiculul înaintează pe traseu cu viteza lui (din ultimele două poziții sau
// viteza raportată), cel mult 60 s; la o poziție nouă, diferența față de ce se vedea se corectează lin, în 4 s.
// Rezultatul: mișcare continuă de la prima secundă, fără salturi, aproape de poziția reală.
const EXTRAP = 60, BLEND = 4;
let clockOffset = 0;                                    // ora serverului − ora telefonului (s)
const serverNow = () => Date.now() / 1000 + clockOffset;

function update(d) {
  const seen = new Set(), now = serverNow();
  S.error = null;
  S.updated = d.actualizat;
  clockOffset = Math.max(clockOffset, d.actualizat - Date.now() / 1000);  // nu dăm timpul înapoi (cache)
  d.vehicule.forEach((v) => {
    seen.add(v.id);
    const f = shapeOf(v), p = [v.lng, v.lat];
    let st = S.veh.get(v.id);
    if (!st) { st = { id: v.id, fix: null, b: null }; S.veh.set(v.id, st); }
    const prev = st.fix;
    st.v = v; st.r = routeOf(v);
    if (prev && v.ts <= prev.ts) return;
    const pr = f ? project(f, p, prev && prev.sid === f.sid && prev.along != null ? prev.along : null) : null;
    const fix = { ts: v.ts, p, sid: f ? f.sid : null, along: pr && pr.off < 60 ? pr.along : null };
    let sp = v.v != null ? v.v / 3.6 : f ? f.v || 5 : 0;
    if (prev && prev.sid === fix.sid && prev.along != null && fix.along != null && fix.ts > prev.ts) {
      sp = Math.max(0, Math.min(25, (fix.along - prev.along) / (fix.ts - prev.ts)));
      if (v.v === 0) sp = 0;                             // stă în stație / la semafor
    }
    fix.sp = sp;
    const cur = st.cur;                                  // ce se vedea până acum: de aici pornește corecția
    st.fix = fix; st.sid = fix.sid; st.f = f;
    st.corr = null;
    if (cur && prev) {
      const target = position(st, now);
      if (cur.along != null && target.along != null && prev.sid === fix.sid && Math.abs(cur.along - target.along) < 600) st.corr = { t: now, along: cur.along - target.along };
      else if (meters(cur.p, target.p) < 600) st.corr = { t: now, dp: [cur.p[0] - target.p[0], cur.p[1] - target.p[1]] };
    }
  });
  [...S.veh.keys()].forEach((id) => { if (!seen.has(id)) S.veh.delete(id); });
  renderStatus();
  if (S.sel) refreshSheet();
}

function position(st, t) {
  const fx = st.fix, dt = Math.max(0, Math.min(EXTRAP, t - fx.ts));
  const c = st.corr, w = c ? Math.max(0, 1 - (t - c.t) / BLEND) : 0;
  if (st.f && fx.along != null && fx.sid === st.f.sid) {
    const d = Math.min(st.f.len, fx.along + fx.sp * dt + (c && c.along != null ? c.along * w : 0));
    const q = pointAt(st.f, d);
    st.b = q.b;
    return { p: q.p, along: d };
  }
  return { p: c && c.dp ? [fx.p[0] + c.dp[0] * w, fx.p[1] + c.dp[1] * w] : fx.p, along: null };
}

// cât a parcurs vehiculul pe traseu acum (ultima poziție GPS + viteza comercială × timpul scurs, cel mult 2 min)
function alongNow(st) {
  const fx = st.fix;
  if (!st.f || !fx || fx.along == null || fx.sid !== st.f.sid) return null;
  return Math.min(st.f.len, fx.along + Math.min(EXTRAP, Math.max(0, serverNow() - fx.ts)) * fx.sp);
}

function dimmed(st) {
  const s = S.sel;
  if (!s) return false;
  if (s.type === 'line') return !st.r || st.r.linie !== s.linie || st.r.tip !== s.tip;
  if (s.type === 'veh') return st.id !== s.id;
  if (s.type === 'stop') return !groupShapes(s.id).some(([, sid]) => sid === st.sid);
  return false;
}

let lastFrame = 0;
function frame(t) {
  requestAnimationFrame(frame);
  if (t - lastFrame < 50 || !map.getSource('veh') || document.hidden) return; // ~20 cadre pe secundă ajung
  lastFrame = t;
  const td = serverNow(), feats = [];
  S.veh.forEach((st) => {
    if (!st.fix) return;
    const pos = position(st, td);
    st.cur = pos;
    const props = { id: st.id, l: st.r ? st.r.linie : '?', col: st.r ? colorOf(st.r.tip, st.r.retea) : COL.none, o: dimmed(st) ? 0.15 : 1 };
    if (st.b != null) props.b = st.b;
    feats.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: pos.p } });
  });
  map.getSource('veh').setData({ type: 'FeatureCollection', features: feats });
}
requestAnimationFrame(frame);

// ---------- sosiri în stație ----------
const plecariCache = {};
function plecari1(id) {
  if (!plecariCache[id]) plecariCache[id] = getJSON(D + 'live/plecari/' + encodeURIComponent(id) + '.json').catch(() => ({}));
  return plecariCache[id];
}
// plecările tuturor peroanelor stației: {id peron: plecări}
function plecari(id) {
  const ids = group(id);
  return Promise.all(ids.map(plecari1)).then((a) => Object.fromEntries(ids.map((i, k) => [i, a[k]])));
}
// peroanele aceleiași stații (același nume, la ≤ 300 m): fișa stației le arată împreună
const groupCache = {};
function group(id) {
  if (groupCache[id]) return groupCache[id];
  const s = S.stops[id], n = norm(s.nume);
  const ids = Object.values(S.stops).filter((o) => S.stopShapes[o.id] && norm(o.nume) === n && meters([s.lng, s.lat], [o.lng, o.lat]) <= 300).map((o) => o.id);
  if (!ids.includes(id)) ids.unshift(id);
  ids.forEach((i) => { groupCache[i] = ids; });
  return ids;
}
const groupShapes = (id) => group(id).flatMap((i) => (S.stopShapes[i] || []).map((x) => [i, ...x]));

const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const dayKey = () => ([0, 6].includes(new Date().getDay()) ? 'w' : 'l');
const hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');

// vehiculele care se apropie de stație pe fiecare sens: [{sid, min, st}]
function liveEtas(stopId) {
  const out = [];
  groupShapes(stopId).forEach(([, sid, ds]) => {
    const f = S.forme[sid];
    S.veh.forEach((st) => {
      const at = st.sid === sid ? alongNow(st) : null;
      if (at == null) return;
      const rest = ds - at;
      if (rest < -20 || rest > 15000 || serverNow() - st.v.ts > 180) return;
      out.push({ sid, st, min: Math.max(0, rest) / ((f.v || 5) * 60) });
    });
  });
  return out.sort((a, b) => a.min - b.min);
}

// pls: {id peron: plecările lui}
function arrivalsHtml(stopId, pls, limit) {
  const dk = dayKey(), nm = nowMin();
  const rows = {};
  groupShapes(stopId).forEach(([id, sid]) => {
    const f = S.forme[sid], day = (pls[id] && pls[id][dk]) || {};
    if (!f || rows[sid] || f.s[f.s.length - 1][0] === id) return;   // capăt de linie: doar plecările din alte stații
    rows[sid] = { f, live: [], sched: (day[sid] || []).filter((m) => m >= nm - 0.5 && m < nm + 120).slice(0, 3) };
  });
  liveEtas(stopId).forEach((e) => { if (rows[e.sid] && rows[e.sid].live.length < 2) rows[e.sid].live.push(e); });
  // orarul se arată după ultima sosire GPS a sensului (aceeași cursă nu apare de două ori); ordinea = prima sosire afișată
  Object.values(rows).forEach((r) => {
    r.shown = r.sched.filter((m) => !r.live.length || m - nm > r.live[r.live.length - 1].min + 2).slice(0, r.live.length ? 1 : 2);
    r.first = Math.min(r.live.length ? r.live[0].min : 999, r.shown.length ? r.shown[0] - nm : 999);
  });
  const list = Object.values(rows).filter((r) => r.live.length || r.shown.length).sort((a, b) => a.first - b.first).slice(0, limit || 99);
  if (!list.length) return '<p class="muted">Nicio sosire în următoarele două ore.</p>';
  return '<ul class="arr">' + list.map((r) => {
    const live = r.live.map((e) => `<b class="eta live" title="estimare din poziția GPS">${e.min < 1 ? 'acum' : Math.round(e.min) + ' min'}</b>`).join('');
    const sched = r.shown.map((m) => `<span class="eta" title="din orar">${hhmm(m)}</span>`).join('');
    return `<li data-sid="${esc(r.f.sid)}">${chip(r.f.linie, r.f.tip, r.f.retea)}<span class="to">${esc(r.f.spre)}</span><span class="etas">${live}${sched}</span></li>`;
  }).join('') + '</ul>';
}

function chip(linie, tip, retea) {
  return `<span class="chip" style="background:${colorOf(tip, retea)}">${esc(linie)}</span>`;
}

// ---------- foaia de jos: acasă, stație, linie, vehicul ----------
const sheet = $('sheet'), body = $('sheetBody');
$('grab').addEventListener('click', () => sheet.classList.toggle('min'));

function setSel(sel) {
  S.sel = sel;
  map.setFilter('routes-sel', sel && sel.type === 'line' ? ['all', ['==', ['get', 'linie'], sel.linie], ['==', ['get', 'tip'], sel.tip]]
    : sel && sel.type === 'veh' && S.veh.get(sel.id) && S.veh.get(sel.id).sid ? ['==', ['get', 'sid'], S.veh.get(sel.id).sid]
      : sel && sel.type === 'stop' ? ['in', ['get', 'sid'], ['literal', groupShapes(sel.id).map(([, s]) => s)]] : ['==', ['get', 'linie'], '#']);
  map.setPaintProperty('routes', 'line-opacity', sel ? 0.12 : 0.32);
  sheet.classList.remove('min');
  const h = sel ? (sel.type === 'stop' ? '#s=' + sel.id : sel.type === 'line' ? '#l=' + (sel.tip === 'tramvai' ? 'T' : '') + sel.linie : '') : '';
  if (location.hash !== h) history.replaceState(null, '', h || location.pathname);
  refreshSheet();
}

function refreshSheet() {
  const s = S.sel;
  if (!s) return renderHome();
  if (s.type === 'stop' && body.dataset.view === 'stop:' + s.id) {   // doar sosirile, fără a muta lista
    return plecari(s.id).then((pl) => { if ($('arrivals')) $('arrivals').innerHTML = arrivalsHtml(s.id, pl); });
  }
  body.dataset.view = s.type === 'stop' ? 'stop:' + s.id : s.type;
  if (s.type === 'stop') return renderStop(s.id);
  if (s.type === 'line') return renderLine(s.linie, s.tip);
  if (s.type === 'veh') return renderVehicle(s.id);
}

function back() { return '<button class="back" type="button" data-act="home" aria-label="Înapoi">←</button>'; }

function renderHome() {
  body.dataset.view = 'home';
  const favList = [...favs].filter((id) => S.stops[id]);
  const near = S.me ? nearestStops(S.me, 5) : [];
  body.innerHTML = `
    <h2>Transport public Iași, acum</h2>
    <p class="muted">${S.veh.size ? S.veh.size + ' vehicule pe hartă.' : ''} Apăsați pe un vehicul, o stație sau o linie. Sosirile marcate <b class="eta live">GPS</b> sunt estimate din poziția vehiculului; celelalte sunt din orar. Între actualizări (la 30 s), vehiculele înaintează pe traseu cu viteza lor.</p>
    ${favList.length ? '<h3>Stațiile mele</h3>' + favList.map(stopCard).join('') : ''}
    ${near.length ? '<h3>Lângă mine</h3>' + near.map((n) => stopCard(n.id, n.d)).join('') : '<button class="wide" type="button" data-act="locate">◎ Stațiile de lângă mine</button>'}
    <h3>Liniile</h3>${lineChips()}
    <p class="muted small"><a href="../transport/sanatate/">Sănătatea transportului public →</a> · <a href="../transport/">Harta rețelei și analiza datelor →</a></p>`;
  favList.concat(near.map((n) => n.id)).forEach((id) => plecari(id).then((pl) => {
    const el = body.querySelector(`.stopcard[data-id="${CSS.escape(id)}"] .mini`);
    if (el) el.innerHTML = arrivalsHtml(id, pl, 3);
  }));
}

function stopCard(id, d) {
  const s = S.stops[id];
  return `<div class="stopcard" data-id="${esc(id)}"><button type="button" data-act="stop" data-id="${esc(id)}"><b>${esc(s.nume)}</b>${d != null ? `<span class="muted"> · ${Math.round(d)} m</span>` : ''}</button><div class="mini"></div></div>`;
}

function lineChips() {
  const seen = {}, list = [];
  Object.values(S.rute).forEach((r) => { const k = r.tip + r.linie; if (!seen[k]) { seen[k] = 1; list.push(r); } });
  return '<div class="chips">' + list.sort(lineSort).map((r) =>
    `<button type="button" class="chip" style="background:${colorOf(r.tip, r.retea)}" data-act="line" data-l="${esc(r.linie)}" data-t="${esc(r.tip)}">${esc(r.linie)}</button>`).join('') + '</div>';
}

function renderStop(id) {
  const s = S.stops[id];
  if (!s) return renderHome();
  const fav = favs.has(id);
  const lines = [...new Set(groupShapes(id).map(([, sid]) => sid))].map((sid) => S.forme[sid]);
  const uniq = {}; lines.forEach((f) => { uniq[f.tip + f.linie] = f; });
  body.innerHTML = `<div class="head">${back()}<h2>${esc(s.nume)}</h2>
      <button class="fav${fav ? ' on' : ''}" type="button" data-act="fav" data-id="${esc(id)}" aria-pressed="${fav}" title="${fav ? 'Scoate din stațiile mele' : 'Adaugă la stațiile mele'}">★</button></div>
    <div class="chips small">${Object.values(uniq).sort(lineSort).map((f) => chip(f.linie, f.tip, f.retea)).join('')}</div>
    <div id="arrivals"><p class="muted">Se încarcă sosirile…</p></div>`;
  plecari(id).then((pl) => { if (S.sel && S.sel.type === 'stop' && S.sel.id === id) $('arrivals').innerHTML = arrivalsHtml(id, pl); });
}

function renderLine(linie, tip) {
  const shapes = Object.values(S.forme).filter((f) => f.linie === linie && f.tip === tip);
  if (!shapes.length) return renderHome();
  const svc = S.linii[tip + '|' + linie] || {};
  const n = [...S.veh.values()].filter((st) => st.r && st.r.linie === linie && st.r.tip === tip).length;
  body.innerHTML = `<div class="head">${back()}<h2>${chip(linie, tip, shapes[0].retea)} ${esc(tip)} ${esc(shapes[0].retea)}</h2></div>
    <p><b>${n}</b> ${n === 1 ? 'vehicul' : 'vehicule'} în circulație acum${svc.lucru ? ` · ${svc.lucru} curse pe zi lucrătoare, ${svc.weekend} în weekend` : ''}${svc.interval_varf ? ` · la ~${svc.interval_varf} min la vârf` : ''}${svc.prima ? ` · ${svc.prima}–${svc.ultima}` : ''}</p>
    ${shapes.map((f) => `<h3>spre ${esc(f.spre)}</h3><ol class="stops">${f.s.map(([sid]) => S.stops[sid] ? `<li><button type="button" data-act="stop" data-id="${esc(sid)}">${esc(S.stops[sid].nume)}</button></li>` : '').join('')}</ol>`).join('')}`;
}

function renderVehicle(id) {
  const st = S.veh.get(id);
  if (!st) { body.innerHTML = `<div class="head">${back()}<h2>Vehiculul nu mai transmite</h2></div>`; return; }
  const v = st.v, r = st.r, f = st.f, age = Math.max(0, Math.round(serverNow() - v.ts));
  let next = '';
  const at = alongNow(st);
  if (f && at != null) {
    next = f.s.filter(([, d]) => d > at + 10).slice(0, 6).map(([sid, d]) =>
      `<li><button type="button" data-act="stop" data-id="${esc(sid)}">${esc((S.stops[sid] || {}).nume || sid)}</button><span class="eta live">${Math.max(1, Math.round((d - at) / ((f.v || 5) * 60)))} min</span></li>`).join('');
  }
  body.innerHTML = `<div class="head">${back()}<h2>${r ? chip(r.linie, r.tip, r.retea) + ' spre ' + esc(f ? f.spre : (r.spre[v.sens] || '')) : 'Vehicul fără linie atribuită'}</h2></div>
    <p class="muted">Vehiculul ${esc(v.nr || v.id)}${v.v != null ? ` · ${v.v} km/h` : ''} · semnal acum ${age < 90 ? age + ' s' : Math.round(age / 60) + ' min'}</p>
    ${next ? '<h3>Următoarele stații</h3><ul class="arr next">' + next + '</ul>' : ''}
    ${r ? `<button class="wide" type="button" data-act="line" data-l="${esc(r.linie)}" data-t="${esc(r.tip)}">Toată linia ${esc(r.linie)}</button>` : ''}`;
}

function openStop(id, fly) {
  const s = S.stops[id];
  if (!s) return;
  setSel({ type: 'stop', id: String(id) });
  if (fly !== false) map.easeTo({ center: [s.lng, s.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 700, padding: padding() });
}
function openLine(linie, tip) {
  setSel({ type: 'line', linie, tip });
  const b = new maplibregl.LngLatBounds();
  Object.values(S.forme).filter((f) => f.linie === linie && f.tip === tip).forEach((f) => f.c.forEach((c) => b.extend(c)));
  if (!b.isEmpty()) map.fitBounds(b, { padding: padding(), duration: 700, maxZoom: 15 });
}
function openVehicle(id) {
  setSel({ type: 'veh', id });
  const st = S.veh.get(id);
  if (st && st.cur) map.easeTo({ center: st.cur.p, zoom: Math.max(map.getZoom(), 14.5), duration: 600, padding: padding() });
}
function padding() {
  const wide = window.innerWidth >= 900;
  return wide ? { top: 80, bottom: 40, left: 420, right: 60 } : { top: 90, bottom: Math.round(window.innerHeight * 0.45), left: 30, right: 30 };
}

body.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) {
    const li = e.target.closest('li[data-sid]');
    if (li && S.forme[li.dataset.sid]) openLine(S.forme[li.dataset.sid].linie, S.forme[li.dataset.sid].tip);
    return;
  }
  const a = b.dataset.act;
  if (a === 'home') { setSel(null); }
  else if (a === 'stop') openStop(b.dataset.id);
  else if (a === 'line') openLine(b.dataset.l, b.dataset.t);
  else if (a === 'locate') locate();
  else if (a === 'fav') {
    const id = b.dataset.id;
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    store.set('live.fav', [...favs]);
    refreshSheet();
  }
});

// ---------- lângă mine ----------
function nearestStops(p, n) {
  const seen = new Set();
  return Object.values(S.stops).filter((s) => S.stopShapes[s.id]).map((s) => ({ id: s.id, d: meters(p, [s.lng, s.lat]) }))
    .sort((a, b) => a.d - b.d).filter((x) => { const g = group(x.id)[0]; if (seen.has(g)) return false; seen.add(g); return true; }).slice(0, n);
}
let meMarker = null;
function locate() {
  if (!navigator.geolocation) return setStatus('Browserul nu oferă localizarea.', true);
  setStatus('Caut poziția…');
  navigator.geolocation.getCurrentPosition((pos) => {
    S.me = [pos.coords.longitude, pos.coords.latitude];
    const el = document.createElement('div'); el.className = 'me';
    if (meMarker) meMarker.setLngLat(S.me); else meMarker = new maplibregl.Marker({ element: el }).setLngLat(S.me).addTo(map);
    map.easeTo({ center: S.me, zoom: 15.5, duration: 800 });
    setSel(null);
    renderStatus();
  }, () => setStatus('Poziția nu este disponibilă (permisiunea de localizare?).', true), { enableHighAccuracy: true, timeout: 10000 });
}
$('locate').addEventListener('click', locate);

// ---------- căutare ----------
const q = $('q'), results = $('results');
q.addEventListener('input', () => {
  const t = norm(q.value);
  if (!t) { results.hidden = true; return; }
  const lines = [], seen = {};
  Object.values(S.rute).forEach((r) => { const k = r.tip + r.linie; if (!seen[k] && norm(r.linie).startsWith(t)) { seen[k] = 1; lines.push(r); } });
  const stopsSeen = {}, stops = [];
  Object.values(S.stops).forEach((s) => {
    const n = norm(s.nume);
    if (S.stopShapes[s.id] && n.includes(t) && !stopsSeen[n]) { stopsSeen[n] = 1; stops.push(s); }
  });
  stops.sort((a, b) => norm(a.nume).indexOf(t) - norm(b.nume).indexOf(t) || (b.plecari_lucru || 0) - (a.plecari_lucru || 0));
  const html = lines.sort(lineSort).slice(0, 6).map((r) => `<button type="button" data-l="${esc(r.linie)}" data-t="${esc(r.tip)}">${chip(r.linie, r.tip, r.retea)} linia ${esc(r.linie)} · ${esc(r.tip)}</button>`).join('') +
    stops.slice(0, 8).map((s) => `<button type="button" data-id="${esc(s.id)}">● ${esc(s.nume)}</button>`).join('');
  results.innerHTML = html || '<p class="muted">Nimic găsit.</p>';
  results.hidden = false;
});
results.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  results.hidden = true; q.value = ''; q.blur();
  if (b.dataset.id) {
    // stațiile cu același nume (peroanele): alegem peronul cu cele mai multe plecări
    const name = norm(S.stops[b.dataset.id].nume);
    const best = Object.values(S.stops).filter((s) => norm(s.nume) === name && S.stopShapes[s.id]).sort((a, b2) => (b2.plecari_lucru || 0) - (a.plecari_lucru || 0))[0];
    openStop(best.id);
  } else openLine(b.dataset.l, b.dataset.t);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { results.hidden = true; if (S.sel) setSel(null); } });

// ---------- stare, legături directe (#s=<stație>, #l=<linie>, #l=T<tramvai>) ----------
function setStatus(msg, err) { const el = $('status'); el.textContent = msg; el.className = err ? 'err' : ''; }
function renderStatus() {
  if (S.error) return setStatus('Pozițiile în timp real nu sunt disponibile: ' + S.error, true);
  if (!S.updated) return setStatus('Se încarcă vehiculele…');
  setStatus(`${S.veh.size} vehicule · actualizat ${new Date(S.updated * 1000).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
}
function route() {
  const m = /^#(s|l)=(.+)$/.exec(decodeURIComponent(location.hash));
  if (m && m[1] === 's' && S.stops[m[2]]) openStop(m[2]);
  else if (m && m[1] === 'l') { const t = m[2].startsWith('T') ? 'tramvai' : 'autobuz'; openLine(m[2].replace(/^T/, ''), t); }
  else renderHome();
}
window.addEventListener('hashchange', () => ready.then(route));
setInterval(() => { if (S.sel && S.sel.type !== 'line') refreshSheet(); }, 5000);  // minutele până la sosire

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
