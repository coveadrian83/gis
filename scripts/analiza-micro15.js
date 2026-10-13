#!/usr/bin/env node
'use strict';
/*
 * Analiza „15 minute pe două roți” pentru Iași, din linia de comandă – același calcul ca pagina /micromobilitate/
 * (public/micromobilitate/micro.js + public/15min/core.js).
 *
 *   node scripts/analiza-micro15.js                       # vehiculele în câteva puncte + tabelul zonelor (bicicletă)
 *   node scripts/analiza-micro15.js --vehicle scooter --kmh 18 --min 15 --ref free --out var/zone_trotineta.csv
 *   node scripts/analiza-micro15.js --point 47.17411,27.57178 --min 10
 *   node scripts/analiza-micro15.js --check               # verifică datele exportate (folosit în GitHub Actions)
 *
 * Vehicule: bike, ebike, scooter, segway. --free = fără restricții (ignoră Codul rutier); --flat = fără pantă.
 * --ref walk (implicit) compară zonele cu mersul pe jos (1,4 m/s); --ref free, cu același vehicul fără restricții.
 */
const fs = require('node:fs');
const path = require('node:path');
const C = require('../public/15min/core.js');
const M = require('../public/micromobilitate/micro.js');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'public', 'micromobilitate', 'data', 'iasi');
const ZONES = path.join(ROOT, 'public', 'data', 'iasi_17_zone_mva_mvi.geojson');
const WALK = 1.4;
const PLACES = [
  ['Piața Unirii', 47.16485, 27.58186],
  ['Universitatea „Al. I. Cuza” (Copou)', 47.17411, 27.57178],
  ['Gara Iași', 47.16597, 27.56932],
  ['Nicolina (Bd. Chimiei)', 47.14112, 27.59633],
];

function args() {
  const a = process.argv.slice(2), o = { min: 15, vehicle: 'bike', kmh: null, free: false, flat: false, ref: 'walk', spacing: 600, maxPoints: 60 };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--check') o.check = true;
    else if (k === '--free') o.free = true;
    else if (k === '--flat') o.flat = true;
    else if (k === '--vehicle') o.vehicle = a[++i];
    else if (k === '--kmh') o.kmh = +a[++i];
    else if (k === '--min') o.min = +a[++i];
    else if (k === '--ref') o.ref = a[++i];
    else if (k === '--spacing') o.spacing = +a[++i];
    else if (k === '--max-points') o.maxPoints = +a[++i];
    else if (k === '--out') o.out = a[++i];
    else if (k === '--point') { const [lat, lng] = a[++i].split(',').map(Number); o.point = [lat, lng]; }
    else { console.error('Argument necunoscut: ' + k); process.exit(2); }
  }
  if (!M.VEHICLES[o.vehicle]) { console.error('Vehicul necunoscut: ' + o.vehicle + ' (bike, ebike, scooter, segway)'); process.exit(2); }
  if (o.ref !== 'walk' && o.ref !== 'free') { console.error('--ref trebuie să fie walk sau free'); process.exit(2); }
  return o;
}

const ab = (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

function load() {
  const g = C.parseGraph(ab(path.join(DATA, 'graph.bin'))), grid = C.buildGrid(g);
  M.parseMicro(ab(path.join(DATA, 'micro.bin')), g);
  const pj = JSON.parse(fs.readFileSync(path.join(DATA, 'pois.json'), 'utf8'));
  const pois = { cats: pj.cats, pts: pj.pts, snap: C.snapPois(g, grid, pj.pts) };
  const meta = JSON.parse(fs.readFileSync(path.join(DATA, 'meta.json'), 'utf8'));
  const ep = path.join(DATA, 'elev.bin');
  if (fs.existsSync(ep)) C.parseElev(ab(ep), g);
  return { g, grid, pois, meta, ws: C.workspace(g) };
}

function profile(ctx, kind, v0, legal, slope) {
  const t = kind === 'walk' ? M.walkTimes(ctx.g, WALK, slope) : M.edgeTimes(ctx.g, M.VEHICLES[kind], { v0, legal, slope });
  return M.coreProfile(t, 1.2);
}

function comparePoint(ctx, name, lat, lng, minutes, slope) {
  const T = minutes * 60;
  const list = [{ name: 'Pe jos 1,4 m/s', p: profile(ctx, 'walk', WALK, false, slope) }];
  for (const k of M.ORDER) {
    const v = M.VEHICLES[k];
    list.push({ name: `${v.name} ${Math.round(v.v0 * 3.6)} km/h`, p: profile(ctx, k, v.v0, true, slope) });
    list.push({ name: `  … fără restricții`, p: profile(ctx, k, v.v0, false, slope) });
  }
  const rows = list.map((x) => ({ ...x, r: C.evaluatePoint(ctx, lng, lat, x.p, T, 500) }));
  if (!rows[0].r) { console.log(`\n${name}: fără rețea în apropiere`); return null; }
  const walk = rows[0].r.amen || 1;
  console.log(`\n${name} (${lat}, ${lng}), ${minutes} min${slope ? ', cu pantă' : ', teren plat'}`);
  for (const { name: n, r } of rows) {
    console.log(`  ${n.padEnd(34)} ${String(r.amen).padStart(5)} facilități (${(r.amen / walk).toFixed(1).padStart(5)}× pe jos)  ` +
      `${String(r.cats[C.STATION]).padStart(4)} stații  ${String(r.cats[5]).padStart(4)} parcări biciclete  ${r.present}/5 categorii`);
  }
  return rows;
}

function main() {
  const o = args();
  const ctx = load();
  const g = ctx.g;
  console.log(`Rețea: ${g.nN} noduri, ${g.nE} segmente; ${ctx.pois.pts.length} facilități, parcări și stații; export ${ctx.meta.generated || '?'}`);
  const slope = !o.flat && !!g.up;
  console.log(g.up ? (slope ? 'Panta: activă (elev.bin)' : 'Panta: dezactivată (--flat)') : 'Panta: elev.bin lipsește – teren plat');
  if (ctx.meta.infrastructure) console.log('Infrastructură (km):', JSON.stringify(ctx.meta.infrastructure));

  if (o.check) {
    const counts = ctx.pois.cats.map((_, c) => ctx.pois.pts.filter((p) => p[2] === c).length);
    console.log('Pe categorii:', ctx.pois.cats.map((n, c) => `${n}: ${counts[c]}`).join(', '));
    const rows = comparePoint(ctx, PLACES[0][0], PLACES[0][1], PLACES[0][2], 15, slope);
    const inf = ctx.meta.infrastructure || {};
    const problems = [];
    if (g.nN < 10000) problems.push('rețeaua are prea puține noduri');
    if (counts.slice(0, 5).some((n) => n === 0)) problems.push('o categorie de facilități este goală');
    if (counts[C.STATION] < 50) problems.push('prea puține stații');
    if (!inf.km_by_class || !(inf.km_by_class['pistă pentru biciclete'] > 0)) problems.push('nicio pistă pentru biciclete');
    if (!rows) problems.push('Piața Unirii nu este legată de rețea');
    else {
      const walk = rows[0].r.amen, bike = rows[1].r.amen;
      if (walk < 50) problems.push('prea puține facilități accesibile pe jos din Piața Unirii');
      if (bike <= walk) problems.push('bicicleta nu ajunge mai departe decât mersul pe jos');
      // varianta legală nu poate depăși varianta fără restricții
      for (let i = 1; i < rows.length; i += 2) if (rows[i].r.amen > rows[i + 1].r.amen) problems.push(rows[i].name + ': legal > fără restricții');
    }
    if (problems.length) { console.error('Datele par incomplete: ' + problems.join('; ')); process.exit(1); }
    console.log('Datele sunt în regulă.');
    return;
  }

  if (o.point) { comparePoint(ctx, 'Punctul ales', o.point[0], o.point[1], o.min, slope); return; }
  for (const [name, lat, lng] of PLACES) comparePoint(ctx, name, lat, lng, o.min, slope);

  const veh = M.VEHICLES[o.vehicle], v0 = o.kmh ? o.kmh / 3.6 : veh.v0;
  const prof = profile(ctx, o.vehicle, v0, !o.free, slope);
  const ref = o.ref === 'walk' ? profile(ctx, 'walk', WALK, false, slope) : profile(ctx, o.vehicle, v0, false, slope);
  const zones = JSON.parse(fs.readFileSync(ZONES, 'utf8'));
  const opts = { minutes: o.min, profile: prof, ref, spacing: o.spacing, maxPoints: o.maxPoints, maxSnap: 150 };
  console.log(`\nZone MVA–MVI: ${veh.name}, ${(v0 * 3.6).toFixed(0)} km/h, ${o.min} min${o.free ? ', fără restricții' : ', după Codul rutier'}` +
    `${slope ? ', cu pantă' : ', teren plat'} vs. ${o.ref === 'walk' ? 'mersul pe jos' : 'același vehicul fără restricții'}; grilă ${o.spacing} m`);
  const rows = zones.features.map((f) => {
    const r = C.analyzeZone(ctx, f, opts);
    r.gain_pct = r.amen_mean_ref ? (r.amen_mean / r.amen_mean_ref - 1) * 100 : null;
    return r;
  });
  const f0 = (v) => (v === null || v === undefined ? '–' : v.toFixed(0));
  console.log('  ' + 'Zona'.padEnd(28) + 'pct  fac.vehicul  fac.ref  diferență  5/5   stații');
  for (const r of rows.slice().sort((a, b) => (a.amen_mean ?? -1) - (b.amen_mean ?? -1))) {
    console.log('  ' + `${r.zone_id} ${r.zone_name}`.padEnd(28) + String(r.points).padStart(3) + f0(r.amen_mean).padStart(13) +
      f0(r.amen_mean_ref).padStart(9) + ((r.gain_pct > 0 ? '+' : '') + f0(r.gain_pct) + '%').padStart(11) + (f0(r.full_share) + '%').padStart(6) +
      (r.stations_mean === null ? '–' : r.stations_mean.toFixed(1)).padStart(9));
  }
  if (o.out) {
    const head = 'zona_id,zona,vehicul,viteza_kmh,reguli,referinta,minute,puncte_analizate,facilitati_medie_vehicul,facilitati_medie_referinta,diferenta_pct,puncte_cu_toate_5_categorii_pct,statii_medie';
    const n = (v) => (v === null || v === undefined || !isFinite(v) ? '' : String(Math.round(v * 10) / 10));
    const t = (v) => (/[",;\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
    const lines = rows.map((r) => [t(r.zone_id), t(r.zone_name), o.vehicle, n(v0 * 3.6), o.free ? 'fara_restrictii' : 'cod_rutier',
      o.ref === 'walk' ? 'pe_jos_1.4ms' : 'fara_restrictii', o.min, r.points, n(r.amen_mean), n(r.amen_mean_ref), n(r.gain_pct),
      n(r.full_share), n(r.stations_mean)].join(','));
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, '﻿' + [head].concat(lines).join('\n') + '\n');
    console.log('\nCSV scris în ' + o.out);
  }
}

main();
