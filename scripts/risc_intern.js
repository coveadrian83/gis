#!/usr/bin/env node
'use strict';
/*
 * Analiza internă de risc pentru Masterplanul de Mobilitate Activă Iași (cap. 3 „Siguranța rutieră și harta de risc”,
 * cap. 5.2 „matricea viteză – volum – trafic greu → tipul intervenției”, cap. 6 „Intersecții și puncte critice”).
 *
 * Folosește, pe lângă datele publice ale hărții /micromobilitate/, datele Defensive Pedal (scorul de risc pe străzi,
 * traficul zilnic ADT din modelul VISUM 2022 și estimat, factorii de risc) – DOAR PENTRU UZ INTERN. Fișierul lor stă în
 * data/defensive_pedal/ (ignorat de git), iar rezultatele în var/risc_intern/ (ignorat de git). Nimic din ce scrie acest
 * script nu se publică pe site.
 *
 *   node scripts/risc_intern.js [--dp data/defensive_pedal/iasi_velo_risk.geojson] [--out var/risc_intern]
 *
 * Ieșiri (în --out):
 *   segmente.geojson      străzile din cele 17 zone: clasa, limita, benzile, riscul propriu (1–5), riscul DP (scor și
 *                         clasă 1–5), riscul propriu + trafic, ADT și sursa lui, trafic greu, accidente bicicletă /
 *                         trotinetă, cererea din chestionar, scorul de lipsă, rețeaua propusă, piste neconforme și
 *                         tipul de intervenție recomandat (matricea de la cap. 5.2)
 *   intersectii.geojson / intersectii.csv
 *                         intersecțiile (grupuri de noduri ≤ 25 m, sensurile giratorii unite) cu componentele
 *                         priorității și prioritatea (cap. 6.2 / 6.10)
 *   raport.md             tabelele de sinteză, pe structura cap. 3
 */
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/15min/core.js');
const M = require('../public/micromobilitate/micro.js');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public', 'micromobilitate', 'data');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DP_FILE = path.resolve(opt('--dp', path.join(ROOT, 'data', 'defensive_pedal', 'iasi_velo_risk.geojson')));
const OUT = path.resolve(opt('--out', path.join(ROOT, 'var', 'risc_intern')));
const ab = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const KX = Math.cos(47.16 * Math.PI / 180) * 111320, KY = 110540;
const ROAD = (c) => c >= M.CLS.LOCAL && c <= M.CLS.TRUNK;
const CLS_NAME = ['pistă', 'alee comună', 'alee / drum de pământ', 'stradă locală', 'terțiară', 'secundară', 'principală', 'drum național', 'autostradă', 'trotuar / pietonal', 'scări', 'interzis bicicletelor'];

// clasele Defensive Pedal: tăieturile cu 5 clase din Rotariu (2026), §3.10
const dpBand = (s) => (s < 42 ? 1 : s < 80 ? 2 : s < 105 ? 3 : s < 130 ? 4 : 5);
// ADT tipic pe clasă (mediana din datele DP pe Iași), pentru străzile fără ADT
const ADT_BY_CLASS = { 3: 30, 4: 3800, 5: 9300, 6: 11100, 7: 16400 };

/* Matricea de alegere a soluției (cap. 5.2 / 9.5), după pragurile uzuale din CROW (2016) și din ghidurile
 * europene; de aliniat cu SR 10144:2024. v = viteza admisă (km/h), adt = vehicule/zi, lanes = benzi în total. */
function intervention(v, adt, lanes, hgv) {
  if (v > 50) return ['E', 'pistă separată fizic sau rută alternativă (> 50 km/h)'];
  if (adt >= 10000 || lanes >= 4 || (hgv && adt >= 5000)) return ['D', 'pistă separată fizic'];
  if (adt >= 2500) return v <= 30 ? ['C', 'bandă velo / trafic mixt cu calmare'] : ['C', 'bandă velo marcată (sau 30 km/h + calmare)'];
  return v <= 30 ? ['A', 'trafic mixt (fără amenajare)'] : ['B', 'trafic mixt cu Zona 30 / calmare'];
}

function main() {
  if (!fs.existsSync(DP_FILE)) { console.error('Lipsește fișierul Defensive Pedal: ' + DP_FILE); process.exit(2); }
  // ---- rețeaua și factorii (ca în pagină)
  const g = C.parseGraph(ab(path.join(PUB, 'iasi', 'graph.bin')));
  M.parseMicro(ab(path.join(PUB, 'iasi', 'micro.bin')), g);
  if (fs.existsSync(path.join(PUB, 'iasi', 'elev.bin'))) C.parseElev(ab(path.join(PUB, 'iasi', 'elev.bin')), g);
  const grid = C.buildGrid(g);
  const ed = J(path.join(PUB, 'iasi', 'edges.json'));
  const names = new Array(g.nE);
  ed.name.forEach(([e, k]) => { names[e] = ed.names[k]; });
  M.markTram(g, J(path.join(PUB, 'tramvai.json')).linii);
  const tp = M.prepareTransit(J(path.join(PUB, 'transit.json')), g, grid, C.nearestNode);
  M.markBus(g, tp);
  M.markNonconforming(g, names, J(path.join(PUB, 'piste_masterplan.json')));
  M.markProposed(g, J(path.join(PUB, 'retea_propusa.geojson')));
  M.resetRisk(g); M.useScenario(g, false);
  const zones = J(path.join(ROOT, 'public', 'data', 'iasi_17_zone_mva_mvi.geojson'));
  const zoneOf = new Int16Array(g.nE).fill(-1);
  for (let e = 0; e < g.nE; e++) {
    const lon = (g.lon[g.eu[e]] + g.lon[g.ev[e]]) / 2, lat = (g.lat[g.eu[e]] + g.lat[g.ev[e]]) / 2;
    zoneOf[e] = zones.features.findIndex((f) => C.pointInGeometry(f.geometry, lon, lat));
  }
  // chestionarul
  const survey = {};
  J(path.join(PUB, 'chestionar.json')).strazi.forEach((s) => { survey[s.nume] = s; });
  // accidentele (bicicletă / trotinetă, publice)
  const acc = J(path.join(PUB, 'accidente.json'));
  const accEdge = M.snapAccidents(g, acc.puncte, 30);
  const accN = new Uint16Array(g.nE), accK = new Uint16Array(g.nE);
  acc.puncte.forEach((p, i) => { const e = accEdge[i]; if (e >= 0) { accN[e]++; if (p[4]) accK[e]++; } });

  // ---- potrivirea cu Defensive Pedal: mijlocul fiecărei muchii → cel mai apropiat segment DP aproape paralel (≤ 12 m)
  const DP = J(DP_FILE).features;
  const cell = 120 / 111000, cells = new Map();
  DP.forEach((f, i) => {
    const cs = f.geometry.coordinates;
    for (let j = 1; j < cs.length; j++) {
      const a = cs[j - 1], b = cs[j], n = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * KX, (b[1] - a[1]) * KY) / 60));
      for (let k = 0; k <= n; k++) {
        const key = Math.floor((a[0] + (b[0] - a[0]) * k / n) / cell) + ',' + Math.floor((a[1] + (b[1] - a[1]) * k / n) / cell);
        if (!cells.has(key)) cells.set(key, new Set());
        cells.get(key).add(i);
      }
    }
  });
  const match = new Int32Array(g.nE).fill(-1);
  for (let e = 0; e < g.nE; e++) {
    const u = g.eu[e], v = g.ev[e], mx = (g.lon[u] + g.lon[v]) / 2, my = (g.lat[u] + g.lat[v]) / 2;
    const ex = (g.lon[v] - g.lon[u]) * KX, ey = (g.lat[v] - g.lat[u]) * KY, EL = Math.hypot(ex, ey);
    const cx = Math.floor(mx / cell), cy = Math.floor(my / cell);
    let best = -1, bd = 12;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const s = cells.get((cx + dx) + ',' + (cy + dy));
      if (!s) continue;
      for (const i of s) {
        const cs = DP[i].geometry.coordinates;
        for (let j = 1; j < cs.length; j++) {
          const ax = (cs[j - 1][0] - mx) * KX, ay = (cs[j - 1][1] - my) * KY, bx = (cs[j][0] - mx) * KX, by = (cs[j][1] - my) * KY;
          const sx = bx - ax, sy = by - ay, L2 = sx * sx + sy * sy;
          const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * sx + ay * sy) / L2)) : 0;
          const d = Math.hypot(ax + t * sx, ay + t * sy);
          if (d >= bd) continue;
          const SL = Math.sqrt(L2);
          if (EL > 2 && SL > 2 && Math.abs((ex * sx + ey * sy) / (EL * SL)) < 0.7) continue;
          bd = d; best = i;
        }
      }
    }
    match[e] = best;
  }
  const dpOf = (e) => (match[e] >= 0 ? DP[match[e]].properties : null);
  const adtOf = (e) => {
    const p = dpOf(e);
    if (p && p.adt_24h != null) return [p.adt_24h, 'VISUM 2022'];
    if (p && p.adt_estimated != null) return [p.adt_estimated, 'estimat DP'];
    return [ADT_BY_CLASS[g.cls[e]] || 0, 'tipic pe clasă'];
  };
  const hgvOf = (e) => { const p = dpOf(e); return !!(p && /HGV/.test(p.factors_increase || '')); };

  // ---- riscul propriu + trafic (factorul care lipsea): +1 la ≥ 10.000 vehicule/zi, +2 la ≥ 20.000
  const RISK_BANDS = [1, 2, 3, 3, 4, 4, 5];
  const ownAdt = new Uint8Array(g.nE);
  for (let e = 0; e < g.nE; e++) {
    let p = M.riskPoints(g, e);
    if (ROAD(g.cls[e])) { const a = adtOf(e)[0]; if (a >= 20000) p += 2; else if (a >= 10000) p += 1; }
    ownAdt[e] = RISK_BANDS[Math.min(6, p)];
  }

  // ---- lipsurile (bicicleta, rețeaua sigură risc 1–2, 15 min), ca în pagină
  const P = J(path.join(PUB, 'iasi', 'pois.json'));
  const pois = { cats: P.cats, pts: P.pts, snap: C.snapPois(g, grid, P.pts) };
  const origins = [];
  zones.features.forEach((f) => C.thin(C.gridPoints(f.geometry, 800), 25).forEach((pt) => {
    const r = C.nearestNode(g, grid, pt[0], pt[1], 8);
    if (r.node >= 0 && r.dist <= 150) origins.push([r.node, r.dist]);
  }));
  const bike = M.VEHICLES.bike, slope = !!g.up;
  const free = M.edgeTimes(g, bike, { v0: bike.v0, legal: false, slope });
  const safe = M.edgeTimes(g, bike, { v0: bike.v0, legal: true, maxRisk: 2, slope });
  const gap = M.gapScores(g, free, safe, origins, pois, 900, { access: 1.2 });

  // ---- segmentele (din cele 17 zone)
  fs.mkdirSync(OUT, { recursive: true });
  const segFeats = [];
  const conf = { own: [...Array(5)].map(() => [0, 0, 0, 0, 0]), ownAdt: [...Array(5)].map(() => [0, 0, 0, 0, 0]) };
  const byBand = { own: [], ownAdt: [], dp: [] };
  ['own', 'ownAdt', 'dp'].forEach((k) => { for (let b = 0; b < 5; b++) byBand[k].push({ km: 0, acc: 0, ksi: 0 }); });
  const interv = {};
  for (let e = 0; e < g.nE; e++) {
    if (zoneOf[e] < 0) continue;
    const c = g.cls[e];
    if (c === M.CLS.MOTORWAY || c === M.CLS.STEPS) continue;
    const p = dpOf(e), [adt, adtSrc] = adtOf(e), hgv = hgvOf(e);
    const v = M.speedLimit(g, e), lanes = g.lanes ? g.lanes[e] : 0;
    const s = names[e] && survey[names[e]];
    const iv = ROAD(c) ? intervention(v, adt, lanes, hgv) : null;
    const km = g.elen[e] / 1000;
    if (p && c !== M.CLS.FOOTWAY && c !== M.CLS.PATH) {
      const db = dpBand(p.risk_score);
      conf.own[g.risk[e] - 1][db - 1] += km;
      conf.ownAdt[ownAdt[e] - 1][db - 1] += km;
      [['own', g.risk[e]], ['ownAdt', ownAdt[e]], ['dp', db]].forEach(([k, b]) => {
        const r = byBand[k][b - 1]; r.km += km; r.acc += accN[e]; r.ksi += accK[e];
      });
    }
    if (iv && g.prop[e]) {
      const key = iv[0];
      interv[key] = interv[key] || { label: iv[1], km: 0, byCat: {} };
      interv[key].km += km;
      const cat = M.PROP_NAME[g.prop[e]];
      interv[key].byCat[cat] = (interv[key].byCat[cat] || 0) + km;
    }
    const coords = [];
    const u = g.eu[e], w = g.ev[e];
    coords.push([+g.lon[u].toFixed(6), +g.lat[u].toFixed(6)]);
    for (let k = g.sst[e]; k < g.sst[e + 1]; k++) coords.push([+g.slon[k].toFixed(6), +g.slat[k].toFixed(6)]);
    coords.push([+g.lon[w].toFixed(6), +g.lat[w].toFixed(6)]);
    segFeats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {
      segment: e, strada: names[e] || '', zona: zones.features[zoneOf[e]].properties.zone_name, clasa: CLS_NAME[c],
      limita_kmh: v, limita_etichetata: g.maxspeed[e] > 0, benzi: lanes || null, lungime_m: Math.round(g.elen[e]),
      risc_propriu: g.risk[e], risc_propriu_trafic: ownAdt[e],
      dp_scor: p ? p.risk_score : null, dp_clasa: p ? dpBand(p.risk_score) : null,
      dp_factori_plus: p ? p.factors_increase : null, dp_factori_minus: p ? p.factors_decrease : null,
      adt: adt || null, adt_sursa: adtSrc, trafic_greu: hgv, sine_tramvai: !!g.tram[e], autobuze_ora: Math.round(g.bus[e]) || 0,
      pista_neconforma: g.nonconf[e] || 0, retea_propusa: g.prop[e] ? M.PROP_NAME[g.prop[e]] : '',
      accidente_velo: accN[e], accidente_velo_grave: accK[e],
      chestionar_parcurse: s ? s.parcurse : 0, chestionar_dorite: s ? s.dorite : 0,
      lipsa_scor: Math.round(gap[e] * 100) / 100,
      interventie: iv ? iv[0] : '', interventie_descriere: iv ? iv[1] : ''
    } });
  }
  fs.writeFileSync(path.join(OUT, 'segmente.geojson'), JSON.stringify({ type: 'FeatureCollection', features: segFeats }));

  // ---- intersecțiile: noduri cu ≥ 3 ramuri de stradă / pistă, unite la ≤ 25 m și în sensurile giratorii
  const roadDeg = new Uint8Array(g.nN);
  for (let e = 0; e < g.nE; e++) {
    const c = g.cls[e];
    if (ROAD(c) || c === M.CLS.CYCLEWAY) { roadDeg[g.eu[e]]++; roadDeg[g.ev[e]]++; }
  }
  const parent = new Int32Array(g.nN).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const cand = [];
  for (let n = 0; n < g.nN; n++) if (roadDeg[n] >= 3) cand.push(n);
  const ncell = 25 / 111000, nc = new Map();
  cand.forEach((n) => {
    const key = Math.floor(g.lon[n] / ncell) + ',' + Math.floor(g.lat[n] / ncell);
    if (!nc.has(key)) nc.set(key, []);
    nc.get(key).push(n);
  });
  cand.forEach((n) => {
    const cx = Math.floor(g.lon[n] / ncell), cy = Math.floor(g.lat[n] / ncell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) (nc.get((cx + dx) + ',' + (cy + dy)) || []).forEach((m) => {
      if (m > n && Math.hypot((g.lon[m] - g.lon[n]) * KX, (g.lat[m] - g.lat[n]) * KY) <= 25) union(n, m);
    });
  });
  // sensurile giratorii (OSM, data/transport/osm/giratorii.json): toate nodurile din cerc + 15 m
  const rb = fs.existsSync(path.join(ROOT, 'data', 'transport', 'osm', 'giratorii.json'))
    ? J(path.join(ROOT, 'data', 'transport', 'osm', 'giratorii.json')).elements.filter((x) => x.geometry) : [];
  const roundaboutOf = new Map();
  rb.forEach((w, ri) => {
    const lon = w.geometry.reduce((s, p) => s + p.lon, 0) / w.geometry.length, lat = w.geometry.reduce((s, p) => s + p.lat, 0) / w.geometry.length;
    const rad = Math.max(...w.geometry.map((p) => Math.hypot((p.lon - lon) * KX, (p.lat - lat) * KY))) + 15;
    let first = -1;
    cand.forEach((n) => {
      if (Math.hypot((g.lon[n] - lon) * KX, (g.lat[n] - lat) * KY) <= rad) { if (first < 0) first = n; else union(first, n); roundaboutOf.set(n, ri); }
    });
  });
  const groups = new Map();
  cand.forEach((n) => { const r = find(n); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n); });
  const accByNode = new Map();
  // accidentele în intersecție (Poliția: „Intersecție cu”) sau la ≤ 30 m de un nod al grupului
  const inters = [];
  for (const [, nodes] of groups) {
    const set = new Set(nodes);
    const app = new Set();   // muchiile care intră în grup din afară (ramurile)
    nodes.forEach((n) => {
      for (let k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) {
        const e = g.adjEdge[k], c = g.cls[e];
        if (!(ROAD(c) || c === M.CLS.CYCLEWAY)) continue;
        const o = g.eu[e] === n ? g.ev[e] : g.eu[e];
        if (!set.has(o) || g.elen[e] > 40) app.add(e);
      }
    });
    if (app.size < 3) continue;
    const lon = nodes.reduce((s, n) => s + g.lon[n], 0) / nodes.length, lat = nodes.reduce((s, n) => s + g.lat[n], 0) / nodes.length;
    let maxOwn = 0, maxDp = 0, maxDpScore = 0, adtSum = 0, hi = 0, tram = false, prop = 0, gapSum = 0, demand = 0, hgv = false;
    const streets = new Map();
    app.forEach((e) => {
      maxOwn = Math.max(maxOwn, ownAdt[e]);
      const p = dpOf(e);
      if (p) { maxDp = Math.max(maxDp, dpBand(p.risk_score)); maxDpScore = Math.max(maxDpScore, p.risk_score); }
      if (ROAD(g.cls[e])) adtSum += adtOf(e)[0];
      if (ownAdt[e] >= 4 || (p && dpBand(p.risk_score) >= 4)) hi++;
      if (g.tram[e]) tram = true;
      if (hgvOf(e)) hgv = true;
      if (g.prop[e] && (!prop || g.prop[e] < prop)) prop = g.prop[e];
      gapSum += gap[e];
      const nm = names[e];
      if (nm) { streets.set(nm, (streets.get(nm) || 0) + g.elen[e]); const s = survey[nm]; if (s) demand = Math.max(demand, s.parcurse + s.dorite); }
    });
    let a = 0, ak = 0;
    acc.puncte.forEach((p) => {
      if (Math.abs(p[0] - lon) > 0.001 || Math.abs(p[1] - lat) > 0.001) return;
      const d = Math.min(...nodes.map((n) => Math.hypot((g.lon[n] - p[0]) * KX, (g.lat[n] - p[1]) * KY)));
      if (d <= 30) { a++; if (p[4]) ak++; }
    });
    const zi = zones.features.findIndex((f) => C.pointInGeometry(f.geometry, lon, lat));
    if (zi < 0) continue;
    inters.push({ lon, lat, nume: [...streets.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map((x) => x[0]).join(' × ') || '(fără nume)',
      zona: zones.features[zi].properties.zone_name, ramuri: app.size, giratoriu: nodes.some((n) => roundaboutOf.has(n)),
      risc_max_propriu: maxOwn, risc_max_dp: maxDp, dp_scor_max: maxDpScore, ramuri_risc_ridicat: hi, adt_ramuri: adtSum,
      trafic_greu: hgv, sine_tramvai: tram, retea_propusa: prop ? M.PROP_NAME[prop] : '', cerere_chestionar: demand,
      accidente_velo: a, accidente_velo_grave: ak, lipsa_scor: gapSum });
  }
  // prioritatea: media a cinci componente normalizate 0–1 (ponderi egale, transparente)
  const mx = (k) => Math.max(1e-9, ...inters.map((x) => x[k]));
  const mAdt = Math.log1p(mx('adt_ramuri')), mDem = mx('cerere_chestionar'), mAcc = mx('accidente_velo'), mGap = mx('lipsa_scor');
  inters.forEach((x) => {
    x.c_risc = Math.max(x.risc_max_propriu, x.risc_max_dp) / 5;
    x.c_trafic = Math.log1p(x.adt_ramuri) / mAdt;
    x.c_cerere = x.cerere_chestionar / mDem;
    x.c_accidente = x.accidente_velo / mAcc;
    x.c_retea = x.lipsa_scor / mGap;
    x.prioritate = (x.c_risc + x.c_trafic + x.c_cerere + x.c_accidente + x.c_retea) / 5;
  });
  inters.sort((a, b) => b.prioritate - a.prioritate);
  const r2 = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
  fs.writeFileSync(path.join(OUT, 'intersectii.geojson'), JSON.stringify({ type: 'FeatureCollection', features: inters.map((x, i) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [+x.lon.toFixed(6), +x.lat.toFixed(6)] },
    properties: Object.fromEntries([['rang', i + 1]].concat(Object.entries(x).filter(([k]) => k !== 'lon' && k !== 'lat').map(([k, v]) => [k, r2(v)])))
  })) }));
  const cols = ['rang', 'nume', 'zona', 'prioritate', 'c_risc', 'c_trafic', 'c_cerere', 'c_accidente', 'c_retea', 'ramuri', 'giratoriu', 'risc_max_propriu', 'risc_max_dp',
    'adt_ramuri', 'trafic_greu', 'sine_tramvai', 'cerere_chestionar', 'accidente_velo', 'accidente_velo_grave', 'lipsa_scor', 'retea_propusa', 'lat', 'lon'];
  const esc = (v) => { const s = String(v === undefined ? '' : v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  fs.writeFileSync(path.join(OUT, 'intersectii.csv'), '﻿' + [cols.join(',')].concat(inters.map((x, i) => cols.map((k) => esc(k === 'rang' ? i + 1 : k === 'lat' || k === 'lon' ? x[k].toFixed(6) : r2(x[k]))).join(','))).join('\n') + '\n');

  // ---- raportul
  const f1 = (v) => (v == null || !isFinite(v) ? '–' : v.toLocaleString('ro-RO', { maximumFractionDigits: 1 }));
  const f0 = (v) => (v == null || !isFinite(v) ? '–' : Math.round(v).toLocaleString('ro-RO'));
  let matched = 0, total = 0;
  for (let e = 0; e < g.nE; e++) if (zoneOf[e] >= 0 && ROAD(g.cls[e])) { total += g.elen[e]; if (match[e] >= 0) matched += g.elen[e]; }
  const xs = [], ys = [];
  for (let e = 0; e < g.nE; e++) if (zoneOf[e] >= 0 && match[e] >= 0 && g.cls[e] !== M.CLS.FOOTWAY && g.cls[e] !== M.CLS.PATH && g.cls[e] < 8) { xs.push(M.riskPoints(g, e)); ys.push(DP[match[e]].properties.risk_score); }
  const rank = (a) => { const o = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length); for (let i = 0; i < o.length;) { let j = i; while (j < o.length && o[j][0] === o[i][0]) j++; for (let k = i; k < j; k++) r[o[k][1]] = (i + j - 1) / 2; i = j; } return r; };
  const spear = (a, b) => { const ra = rank(a), rb = rank(b), n = a.length, ma = ra.reduce((s, v) => s + v, 0) / n, mb = rb.reduce((s, v) => s + v, 0) / n; let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++) { sab += (ra[i] - ma) * (rb[i] - mb); saa += (ra[i] - ma) ** 2; sbb += (rb[i] - mb) ** 2; } return sab / Math.sqrt(saa * sbb); };
  const md = [];
  md.push('# Analiza internă de risc – Iași (uz intern, NU se publică)', '');
  md.push('Generat de `scripts/risc_intern.js` la ' + new Date().toISOString().slice(0, 16).replace('T', ' ') + '. Date: rețeaua OSM a hărții /micromobilitate/, Defensive Pedal (scor, ADT VISUM 2022 / estimat, factori), accidentele Poliției cu bicicletă / trotinetă (2022–2026), chestionarul Masterplanului, Masterplanul Velo 2023 (piste neconforme, rețeaua propusă). Zona: cele 17 zone MVA–MVI.', '');
  md.push('## 3.1 Metodologia – trei scoruri comparate', '');
  md.push('- **Risc propriu** (harta publică): tipul drumului, limita de viteză, benzile, șinele de tramvai, autobuzele, banda velo, piatra cubică, pistele neconforme; 5 clase.');
  md.push('- **Risc propriu + trafic** (intern): același, plus volumul de trafic – +1 la ≥ 10.000 vehicule/zi, +2 la ≥ 20.000 (ADT VISUM 2022, altfel estimat DP, altfel tipic pe clasă).');
  md.push('- **Defensive Pedal**: scorul lor (0–250), în cele 5 clase din Rotariu (2026): < 42, 42–80, 80–105, 105–130, ≥ 130.', '');
  md.push('Potrivirea DP – rețea: ' + f1(matched / total * 100) + '% din lungimea străzilor din cele 17 zone. Corelația (Spearman) risc propriu – DP pe segmente: ' + spear(xs, ys).toFixed(2) + ' (n = ' + xs.length + ').', '');
  const confTable = (t, title) => {
    md.push('**' + title + '** – km, rânduri = clasa noastră, coloane = clasa DP', '', '| | DP 1 | DP 2 | DP 3 | DP 4 | DP 5 |', '|---|---|---|---|---|---|');
    t.forEach((r, i) => md.push('| ' + (i + 1) + ' | ' + r.map(f0).join(' | ') + ' |'));
    md.push('');
  };
  confTable(conf.own, 'Risc propriu vs. DP');
  confTable(conf.ownAdt, 'Risc propriu + trafic vs. DP');
  md.push('## 3.2 Evenimente rutiere – accidentele cu bicicletă / trotinetă pe clasele de risc', '');
  md.push('Doar accidentele în care biciclistul / trotinetistul a fost găsit vinovat (limita exportului Poliției), legate de strada cea mai apropiată (≤ 30 m). **Fără expunere** (numărători), nu este o validare.', '');
  md.push('| Clasa | Propriu: km | acc. / 100 km | grave | Propriu + trafic: km | acc. / 100 km | grave | DP: km | acc. / 100 km | grave |', '|---|---|---|---|---|---|---|---|---|---|');
  for (let b = 0; b < 5; b++) {
    const o = byBand.own[b], t = byBand.ownAdt[b], d = byBand.dp[b];
    md.push('| ' + (b + 1) + ' | ' + f0(o.km) + ' | ' + f1(o.acc / o.km * 100) + ' | ' + o.ksi + ' | ' + f0(t.km) + ' | ' + f1(t.acc / t.km * 100) + ' | ' + t.ksi + ' | ' + f0(d.km) + ' | ' + f1(d.acc / d.km * 100) + ' | ' + d.ksi + ' |');
  }
  md.push('');
  md.push('## 3.3–3.4 Viteze și volume de trafic', '');
  const adtSrc = {};
  for (let e = 0; e < g.nE; e++) if (zoneOf[e] >= 0 && ROAD(g.cls[e])) { const s = adtOf(e)[1]; adtSrc[s] = (adtSrc[s] || 0) + g.elen[e] / 1000; }
  md.push('Sursa volumului de trafic pe străzile din cele 17 zone: ' + Object.entries(adtSrc).map(([k, v]) => k + ' ' + f0(v) + ' km').join('; ') + '. Viteza: doar limita legală (OSM; neetichetată → 50 km/h); **viteza reală / V85 lipsește** – de obținut din măsurători (radar, date FCD) pentru cap. 3.3.', '');
  md.push('## 5.2 Matricea viteză – volum – trafic greu → tipul intervenției, pe rețeaua propusă', '');
  md.push('Praguri (de aliniat cu SR 10144:2024): > 50 km/h → E; ≥ 10.000 veh/zi, ≥ 4 benzi sau trafic greu cu ≥ 5.000 → D; ≥ 2.500 → C; altfel B (50 km/h) sau A (30 km/h). Lungimile sunt ale segmentelor OSM de pe traseele propuse (carosabil și piste paralele numărate separat).', '');
  md.push('| Tip | Intervenția | km pe rețeaua propusă | pe categorii |', '|---|---|---|---|');
  Object.keys(interv).sort().forEach((k) => md.push('| ' + k + ' | ' + interv[k].label + ' | ' + f1(interv[k].km) + ' | ' + Object.entries(interv[k].byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => c + ' ' + f1(v)).join(', ') + ' |'));
  md.push('');
  md.push('## 3.5 / 6.10 Intersecțiile prioritare (primele 25)', '');
  md.push('Prioritatea = media a cinci componente normalizate 0–1, cu ponderi egale: riscul maxim pe ramuri (propriu + trafic sau DP), traficul pe ramuri (log ADT), cererea din chestionar (străzile ramurilor), accidentele velo la ≤ 30 m și scorul de lipsă al ramurilor (bicicletă, rețeaua sigură, 15 min). Lista completă: `intersectii.csv`.', '');
  md.push('| # | Intersecția | Zona | Prioritate | Risc | Trafic | Cerere | Accidente | Rețea | Rețea propusă |', '|---|---|---|---|---|---|---|---|---|---|');
  inters.slice(0, 25).forEach((x, i) => md.push('| ' + (i + 1) + ' | ' + x.nume + (x.giratoriu ? ' (giratoriu)' : '') + (x.sine_tramvai ? ' 🚋' : '') + ' | ' + x.zona + ' | ' + x.prioritate.toFixed(2) + ' | ' + x.c_risc.toFixed(2) + ' | ' + x.c_trafic.toFixed(2) + ' | ' + x.c_cerere.toFixed(2) + ' | ' + x.accidente_velo + ' | ' + x.c_retea.toFixed(2) + ' | ' + (x.retea_propusa || '–') + ' |'));
  md.push('');
  md.push('## 3.7–3.9 Clasificarea străzilor și zonele prioritare', '');
  md.push('Stratul `segmente.geojson` (QGIS) conține pentru fiecare segment toate componentele: riscul (trei variante), traficul, trafic greu, șinele, accidentele, cererea, scorul de lipsă, rețeaua propusă, piesele neconforme și intervenția recomandată. Sugestii de simbolizare: culoare = `risc_propriu_trafic` sau `dp_clasa`, grosime = `chestionar_parcurse`, etichetă = `interventie`.', '');
  md.push('Limite: scorurile descriu gravitatea probabilă, nu frecvența; lipsesc expunerea (numărători) și viteza reală; accidentele sunt doar cele cu biciclistul vinovat; ponderile sunt ipoteze de lucru.');
  fs.writeFileSync(path.join(OUT, 'raport.md'), md.join('\n') + '\n');

  console.log('Segmente: ' + segFeats.length + '; intersecții: ' + inters.length + '; scris în ' + OUT);
  console.log('Primele 10 intersecții:');
  inters.slice(0, 10).forEach((x, i) => console.log('  ' + String(i + 1).padStart(2) + '. ' + x.prioritate.toFixed(2) + '  ' + x.nume + (x.giratoriu ? ' (giratoriu)' : '') + ' – ' + x.zona));
  console.log('Accidente / 100 km pe clase (propriu | propriu + trafic | DP):');
  for (let b = 0; b < 5; b++) console.log('  ' + (b + 1) + ': ' + ['own', 'ownAdt', 'dp'].map((k) => f1(byBand[k][b].acc / byBand[k][b].km * 100)).join(' | '));
}

main();
