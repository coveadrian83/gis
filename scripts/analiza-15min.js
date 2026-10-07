#!/usr/bin/env node
'use strict';
/*
 * Analiza „15 minute” pentru Iași, din linia de comandă – același calcul ca pagina /15min/ (public/15min/core.js).
 *
 *   node scripts/analiza-15min.js                         # comparația profilurilor în câteva puncte + tabelul zonelor
 *   node scripts/analiza-15min.js --min 15 --speed 1.1 --avoid --spacing 400 --out var/zone.csv
 *   node scripts/analiza-15min.js --point 47.16485,27.58186
 *   node scripts/analiza-15min.js --check                 # verifică datele exportate (folosit în GitHub Actions)
 */
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/15min/core.js');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', '15min', 'data', 'iasi');
const ZONES = path.join(ROOT, 'public', 'data', 'iasi_17_zone_mva_mvi.geojson');

const PROFILES = [
  { name: 'Referință 1,4 m/s', speed: 1.4, avoid: false },
  { name: 'Mers lent 1,1 m/s', speed: 1.1, avoid: false },
  { name: 'Lent, fără scări', speed: 1.1, avoid: true },
  { name: 'Mobilitate redusă 0,8 m/s, fără scări', speed: 0.8, avoid: true },
  { name: 'Mers rapid 1,8 m/s', speed: 1.8, avoid: false }
];
const PLACES = [
  ['Piața Unirii', 47.16485, 27.58186],
  ['Palatul Culturii', 47.15742, 27.58673],
  ['Gara Iași', 47.16502, 27.56998],
  ['Universitatea „Al. I. Cuza” (Copou)', 47.17411, 27.57178],
  ['Podu Roș', 47.15330, 27.59410],
  ['Tătărași (Piața Tătărași)', 47.16120, 27.60690],
  ['Nicolina (CUG)', 47.13620, 27.58550],
  ['Dacia', 47.15650, 27.55250]
];

function args() {
  const a = process.argv.slice(2), o = { min: 15, speed: 1.1, avoid: false, spacing: 400, maxPoints: 80 };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--avoid') o.avoid = true;
    else if (k === '--check') o.check = true;
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
  return { g, grid, pois, meta, ws: C.workspace(g) };
}

function comparePoint(ctx, name, lat, lng, minutes) {
  const T = minutes * 60;
  const rows = PROFILES.map(p => ({ p, r: C.evaluatePoint(ctx, lng, lat, p, T, 500) }));
  if (!rows[0].r) { console.log(`\n${name}: fără rețea în apropiere`); return null; }
  const ref = rows[0].r;
  console.log(`\n${name} (${lat}, ${lng}), ${minutes} min`);
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

  if (o.check) {
    const counts = ctx.pois.cats.map((_, c) => ctx.pois.pts.filter(p => p[2] === c).length);
    console.log('Pe categorii:', ctx.pois.cats.map((n, c) => `${n}: ${counts[c]}`).join(', '));
    const rows = comparePoint(ctx, PLACES[0][0], PLACES[0][1], PLACES[0][2], 15);
    const problems = [];
    if (ctx.g.nN < 10000) problems.push('rețeaua are prea puține noduri');
    if (counts.slice(0, 5).some(n => n === 0)) problems.push('o categorie de facilități este goală');
    if (counts[C.STATION] < 50) problems.push('prea puține stații');
    if (!rows || rows[0].r.amen < 50) problems.push('prea puține facilități accesibile din Piața Unirii');
    if (problems.length) { console.error('Datele par incomplete: ' + problems.join('; ')); process.exit(1); }
    console.log('Datele sunt în regulă.');
    return;
  }

  if (o.point) { comparePoint(ctx, 'Punctul ales', o.point[0], o.point[1], o.min); return; }
  for (const [name, lat, lng] of PLACES) comparePoint(ctx, name, lat, lng, o.min);

  const zones = JSON.parse(fs.readFileSync(ZONES, 'utf8'));
  const opts = { minutes: o.min, profile: { speed: o.speed, avoid: o.avoid }, spacing: o.spacing, maxPoints: o.maxPoints, maxSnap: 150 };
  console.log(`\nZone MVA–MVI: ${o.min} min, ${o.speed} m/s${o.avoid ? ', fără scări' : ''} vs. referința 1,4 m/s; grilă ${o.spacing} m`);
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

main();
