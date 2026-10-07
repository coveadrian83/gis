#!/usr/bin/env node
'use strict';
/*
 * Analiza „15 minute” pentru Iași, din linia de comandă – același calcul ca pagina /15min/ (public/15min/core.js).
 *
 *   node scripts/analiza-15min.js                         # comparația profilurilor în câteva puncte + tabelul zonelor
 *   node scripts/analiza-15min.js --min 15 --speed 1.1 --avoid --spacing 400 --out var/zone.csv
 *   node scripts/analiza-15min.js --point 47.16485,27.58186
 *   node scripts/analiza-15min.js --min 15 --speed 1.0 --avoid --max-grade 8 --flat   # fără pantă
 *   node scripts/analiza-15min.js --scari                 # scările și străzile abrupte, pe zone
 *   node scripts/analiza-15min.js --check                 # verifică datele exportate (folosit în GitHub Actions)
 *
 * Panta (elev.bin) este folosită implicit dacă există; --flat o dezactivează. Referința este mereu ipoteza
 * clasică: 1,4 m/s, teren plat, cu scări.
 */
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/15min/core.js');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', '15min', 'data', 'iasi');
const ZONES = path.join(ROOT, 'public', 'data', 'iasi_17_zone_mva_mvi.geojson');

const PROFILES = [
  { name: 'Adult 1,4 m/s', speed: 1.4, avoid: false, maxGrade: 0 },
  { name: 'Mers lent 1,1 m/s', speed: 1.1, avoid: false, maxGrade: 0 },
  { name: 'Lent, fără scări', speed: 1.1, avoid: true, maxGrade: 0 },
  { name: 'Mobilitate redusă 0,8 m/s, fără scări', speed: 0.8, avoid: true, maxGrade: 0 },
  { name: 'Scaun rulant 1,0 m/s, fără scări, ≤ 8%', speed: 1.0, avoid: true, maxGrade: 8 },
  { name: 'Mers rapid 1,8 m/s', speed: 1.8, avoid: false, maxGrade: 0 }
];
const PLACES = [
  ['Piața Unirii', 47.16485, 27.58186],
  ['Palatul Culturii', 47.15742, 27.58673],
  ['Universitatea „Al. I. Cuza” (Copou)', 47.17411, 27.57178],
];

function args() {
  const a = process.argv.slice(2), o = { min: 15, speed: 1.1, avoid: false, maxGrade: 0, flat: false, spacing: 400, maxPoints: 80 };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--avoid') o.avoid = true;
    else if (k === '--check') o.check = true;
    else if (k === '--flat') o.flat = true;
    else if (k === '--scari') o.stairs = true;
    else if (k === '--max-grade') o.maxGrade = +a[++i];
    else if (k === '--min') o.min = +a[++i];
    else if (k === '--speed') o.speed = +a[++i];
    else if (k === '--spacing') o.spacing = +a[++i];
    else if (k === '--max-points') o.maxPoints = +a[++i];
    else if (k === '--out') o.out = a[++i];
    else if (k === '--point') { const [lat, lng] = a[++i].split(',').map(Number); o.point = [lat, lng]; }
    else { console.error('Argument necunoscut: ' + k); process.exit(2); }
  }
  return o;
}

function load() {
  const buf = fs.readFileSync(path.join(DATA, 'graph.bin'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const g = C.parseGraph(ab), grid = C.buildGrid(g);
  const pj = JSON.parse(fs.readFileSync(path.join(DATA, 'pois.json'), 'utf8'));
  const pois = { cats: pj.cats, pts: pj.pts, snap: C.snapPois(g, grid, pj.pts) };
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
  const ep = path.join(DATA, 'elev.bin');
  if (fs.existsSync(ep)) {
    const eb = fs.readFileSync(ep);
    C.parseElev(eb.buffer.slice(eb.byteOffset, eb.byteOffset + eb.byteLength), g);
  }
  const edgesPath = path.join(DATA, 'edges.json');
  const edges = fs.existsSync(edgesPath) ? JSON.parse(fs.readFileSync(edgesPath, 'utf8')) : null;
  return { g, grid, pois, meta, edges, ws: C.workspace(g) };
}

function comparePoint(ctx, name, lat, lng, minutes, slope) {
  const T = minutes * 60;
  const list = [{ name: 'Ipoteza clasică (1,4 m/s, plat)', ...C.REF }].concat(PROFILES.map(p => ({ ...p, slope })));
  const rows = list.map(p => ({ p, r: C.evaluatePoint(ctx, lng, lat, C.profile(p), T, 500) }));
  if (!rows[0].r) { console.log(`\n${name}: fără rețea în apropiere`); return null; }
  const ref = rows[0].r;
  const node = C.nearestNode(ctx.g, ctx.grid, lng, lat).node;
  const alt = ctx.g.ele ? `, altitudine ${ctx.g.ele[node].toFixed(0)} m` : '';
  console.log(`\n${name} (${lat}, ${lng}), ${minutes} min${alt}${slope ? ', profilurile cu pantă' : ''}`);
  for (const { p, r } of rows) {
    const rel = ref.amen ? Math.round(r.amen / ref.amen * 100) : 0;
    console.log(`  ${p.name.padEnd(40)} ${String(r.amen).padStart(5)} facilități (${String(rel).padStart(3)}%)  ` +
      `${String(r.stUsable).padStart(3)} stații utilizabile  ${r.present}/5 categorii`);
  }
  return rows;
}

function main() {
  const o = args();
  const ctx = load();
  console.log(`Rețea: ${ctx.g.nN} noduri, ${ctx.g.nE} segmente; ${ctx.pois.pts.length} facilități și stații; export ${ctx.meta.generated || '?'}`);
  const slope = !o.flat && !!ctx.g.lfw;
  console.log(ctx.g.lfw ? (slope ? 'Panta: activă (elev.bin)' : 'Panta: dezactivată (--flat)') : 'Panta: elev.bin lipsește – teren plat');

  if (o.check) {
    const counts = ctx.pois.cats.map((_, c) => ctx.pois.pts.filter(p => p[2] === c).length);
    console.log('Pe categorii:', ctx.pois.cats.map((n, c) => `${n}: ${counts[c]}`).join(', '));
    const rows = comparePoint(ctx, PLACES[0][0], PLACES[0][1], PLACES[0][2], 15, slope);
    const problems = [];
    if (ctx.g.nN < 10000) problems.push('rețeaua are prea puține noduri');
    if (counts.slice(0, 5).some(n => n === 0)) problems.push('o categorie de facilități este goală');
    if (counts[C.STATION] < 50) problems.push('prea puține stații');
    if (!rows || rows[0].r.amen < 50) problems.push('prea puține facilități accesibile din Piața Unirii');
    if (problems.length) { console.error('Datele par incomplete: ' + problems.join('; ')); process.exit(1); }
    console.log('Datele sunt în regulă.');
    return;
  }

  if (o.point) { comparePoint(ctx, 'Punctul ales', o.point[0], o.point[1], o.min, slope); return; }
  const zones = JSON.parse(fs.readFileSync(ZONES, 'utf8'));
  if (o.stairs) { stairsReport(ctx, zones); return; }
  for (const [name, lat, lng] of PLACES) comparePoint(ctx, name, lat, lng, o.min, slope);

  const opts = { minutes: o.min, profile: { speed: o.speed, avoid: o.avoid, slope, maxGrade: o.maxGrade }, spacing: o.spacing, maxPoints: o.maxPoints, maxSnap: 150 };
  console.log(`\nZone MVA–MVI: ${o.min} min, ${o.speed} m/s${o.avoid ? ', fără scări' : ''}${slope ? ', cu pantă' : ', teren plat'}` +
    `${o.maxGrade ? ', pantă ≤ ' + o.maxGrade + '%' : ''} vs. ipoteza clasică (1,4 m/s, plat, cu scări); grilă ${o.spacing} m`);
  const rows = zones.features.map(f => C.analyzeZone(ctx, f, opts));
  const f0 = v => v === null ? '–' : v.toFixed(0);
  console.log('  ' + 'Zona'.padEnd(28) + 'pct  fac.profil  fac.ref  pierdere  5/5 profil  5/5 ref  stații');
  for (const r of rows.slice().sort((a, b) => (a.amen_mean ?? -1) - (b.amen_mean ?? -1))) {
    console.log('  ' + `${r.zone_id} ${r.zone_name}`.padEnd(28) + String(r.points).padStart(3) + f0(r.amen_mean).padStart(12) +
      f0(r.amen_mean_ref).padStart(9) + (f0(r.loss_pct) + '%').padStart(10) + (f0(r.full_share) + '%').padStart(12) +
      (f0(r.full_share_ref) + '%').padStart(9) + (r.stations_mean === null ? '–' : r.stations_mean.toFixed(1)).padStart(8));
  }
  if (o.out) {
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, '﻿' + C.zonesCsv(rows, ctx.pois.cats));
    console.log('\nCSV scris în ' + o.out);
  }
}

// scările și străzile cele mai abrupte din fiecare zonă (pentru verificarea pe teren a datelor de pantă)
function stairsReport(ctx, zones) {
  const g = ctx.g;
  if (!g.grd) { console.log('elev.bin lipsește.'); return; }
  const names = {}, steps = {}, inc = {};
  if (ctx.edges) {
    for (const [e, k] of ctx.edges.name) names[e] = ctx.edges.names[k];
    for (const [e, n] of ctx.edges.step_count) steps[e] = n;
    for (const [e, v] of ctx.edges.incline) inc[e] = v;
  }
  const zoneOf = e => {
    const lon = (g.lon[g.eu[e]] + g.lon[g.ev[e]]) / 2, lat = (g.lat[g.eu[e]] + g.lat[g.ev[e]]) / 2;
    const f = zones.features.find(z => C.pointInGeometry(z.geometry, lon, lat));
    return f ? f.properties.zone_name : 'în afara zonelor';
  };
  const where = e => `${((g.lat[g.eu[e]] + g.lat[g.ev[e]]) / 2).toFixed(5)},${((g.lon[g.eu[e]] + g.lon[g.ev[e]]) / 2).toFixed(5)}`;
  const byZone = {};
  for (let e = 0; e < g.nE; e++) {
    const z = zoneOf(e);
    const b = byZone[z] || (byZone[z] = { stairs: 0, stairsLen: 0, rise: 0, steepLen: 0, len: 0, list: [], streets: [] });
    if (g.eflag[e] & 3) {
      b.stairs++; b.stairsLen += g.elen[e]; b.rise += g.up[e] + g.dn[e];
      b.list.push(e);
    } else {
      b.len += g.elen[e];
      if (g.grd[e] >= 8) { b.steepLen += g.elen[e]; if (g.elen[e] >= 40) b.streets.push(e); }
    }
  }
  console.log('\nScări și străzi abrupte pe zone (elevație Copernicus GLO-30; denumiri și step_count din OSM)');
  console.log('  ' + 'Zona'.padEnd(28) + 'scări  m scări  dif. nivel  străzi ≥ 8%');
  for (const [z, b] of Object.entries(byZone).sort((a, b) => b[1].stairs - a[1].stairs)) {
    console.log('  ' + z.padEnd(28) + String(b.stairs).padStart(5) + String(Math.round(b.stairsLen)).padStart(9) +
      (Math.round(b.rise) + ' m').padStart(12) + (b.len ? (b.steepLen / b.len * 100).toFixed(0) + '%' : '–').padStart(13));
  }
  for (const z of ['Țicău – Sărărie', 'Păcurari', 'Copou', 'Centru']) {
    const b = byZone[z];
    if (!b) continue;
    console.log(`\n${z}: cele mai înalte scări`);
    b.list.sort((x, y) => (g.up[y] + g.dn[y]) - (g.up[x] + g.dn[x])).slice(0, 8).forEach(e => {
      console.log(`  ${(names[e] || '(fără nume)').padEnd(34)} ${g.elen[e].toFixed(0).padStart(4)} m, dif. nivel ${(g.up[e] + g.dn[e]).toFixed(1)} m` +
        `${steps[e] ? ', ' + steps[e] + ' trepte' : ''}${inc[e] !== undefined ? ', incline ' + inc[e] : ''}  → ${where(e)}`);
    });
    console.log(`${z}: cele mai abrupte străzi (≥ 40 m)`);
    b.streets.sort((x, y) => g.grd[y] - g.grd[x]).slice(0, 8).forEach(e => {
      console.log(`  ${(names[e] || '(fără nume)').padEnd(34)} ${g.elen[e].toFixed(0).padStart(4)} m, pantă max ${g.grd[e]}%, ` +
        `urcare ${Math.max(g.up[e], g.dn[e]).toFixed(1)} m${inc[e] !== undefined ? ', incline OSM ' + inc[e] : ''}  → ${where(e)}`);
    });
  }
}

main();
