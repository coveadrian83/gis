'use strict';
/*
 * Generează deplasări FICTIVE pentru testarea dashboardului, într-o bază de date separată.
 *   npm run demo-data -- [--n 300] [--db var/demo.sqlite]
 *   DB_PATH=var/demo.sqlite ADMIN_PASSWORD=test npm start
 * Nu rulați pe baza de date de producție: toate înregistrările au campaign_source = "demo".
 */
const crypto = require('node:crypto');
const path = require('node:path');
const config = require('../server/config.js');
const { openDb } = require('../server/db.js');
const { loadGeo } = require('../server/geo.js');
const { submitTrip } = require('../server/trips.js');
const time = require('../server/time.js');
const Domain = require('../public/shared/domain.js');

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const n = parseInt(arg('--n', '300'), 10);
const dbPath = path.resolve(arg('--db', path.join(config.ROOT, 'var', 'demo.sqlite')));
if (dbPath === path.resolve(config.DB_PATH) && !args.includes('--force')) {
  console.error('Refuz să scriu date fictive în baza de date principală (DB_PATH). Folosiți --db <alt fișier>.');
  process.exit(2);
}

const geo = loadGeo(config.DATA_DIR);
const places = [];
geo.pois.forEach((p) => places.push({ source: 'poi', ref: p.id, label: p.name, lat: p.lat, lng: p.lng }));
geo.localities.forEach((l) => {
  const u = geo.uatBySiruta[l.uat_siruta];
  const c = l.lat !== null ? [l.lat, l.lng] : u && u.centroid;
  if (c) places.push({ source: 'locality', ref: l.siruta, label: l.name, lat: c[0], lng: c[1], approx: l.lat === null });
});
geo.zones.forEach((z) => z.centroid && places.push({ source: 'zone', ref: z.code, label: z.name, lat: z.centroid[0], lng: z.centroid[1] }));
if (places.length < 2) {
  // fără date geografice: puncte aleatoare în jurul Iașului
  for (let i = 0; i < 30; i++) places.push({ source: 'map', ref: null, label: 'Punct demo ' + i, lat: 47.16 + (Math.random() - 0.5) * 0.2, lng: 27.59 + (Math.random() - 0.5) * 0.3 });
}

const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const jitter = (p) => ({ ...p, lat: p.lat + (Math.random() - 0.5) * 0.004, lng: p.lng + (Math.random() - 0.5) * 0.004 });
const db = openDb(dbPath);
const participants = Array.from({ length: Math.max(5, Math.round(n / 6)) }, () => 'demo-' + crypto.randomUUID());
const nowMs = Date.now();
const today = time.localDate(nowMs);
let ok = 0, rejected = 0;
for (let i = 0; i < n; i++) {
  const o = rnd(places);
  let d = rnd(places);
  if (d === o) d = rnd(places);
  const date = time.addDays(today, -(1 + Math.floor(Math.random() * 6)));
  const peak = Math.random() < 0.6;
  const dep = peak ? 390 + Math.floor(Math.random() * 150) : 600 + Math.floor(Math.random() * 600);
  const mode = rnd(['car', 'car', 'car', 'bus', 'tram', 'walk', 'bike', 'taxi', 'train', 'multimodal']);
  const km = Math.hypot((o.lat - d.lat) * 111, (o.lng - d.lng) * 76);
  const speed = { car: 22, bus: 15, tram: 14, walk: 4.5, bike: 13, taxi: 24, train: 35, multimodal: 16 }[mode];
  const dur = Math.max(4, Math.round((km * 1.35 / speed) * 60 * (0.8 + Math.random() * (peak ? 1.2 : 0.5))));
  const fmt = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const body = {
    trip_id: crypto.randomUUID(), participant_id: rnd(participants), app_version: 'demo', campaign_source: 'demo',
    trip_date: date, departure_time: fmt(dep), arrival_time: fmt(dep + dur),
    origin: jitter(o), destination: jitter(d), mode,
    purpose: rnd(Domain.PURPOSES).code, repeat_type: Math.random() < 0.65 ? 'recurrent' : 'occasional',
    car_role: mode === 'car' ? (Math.random() < 0.8 ? 'driver' : 'passenger') : null,
    occupancy: mode === 'car' ? rnd([1, 1, 1, 2, 2, 3, 4]) : null,
    pt_line: ['bus', 'tram'].includes(mode) ? rnd(['3', '7', '8', '9', '28', '30', '41', '46']) : null
  };
  if (body.car_role === 'passenger' && body.occupancy === 1) body.occupancy = 2;
  try { submitTrip(db, geo, config, JSON.stringify(body), nowMs); ok++; } catch { rejected++; }
}
console.log(`${ok} deplasări demo generate în ${dbPath} (${rejected} respinse de reguli).`);
