'use strict';
/*
 * Politica de retenție (spec. §17.2): elimină coordonatele precise ale deplasărilor mai vechi de N zile.
 * Clasificarea (zonă / localitate / UAT) rămâne. Utilizare:  npm run purge-coords -- --older-than-days 90 [--apply]
 * Fără --apply rulează în mod „simulare”.
 */
const config = require('../server/config.js');
const { openDb, transaction } = require('../server/db.js');

const args = process.argv.slice(2);
const i = args.indexOf('--older-than-days');
const days = i >= 0 ? parseInt(args[i + 1], 10) : NaN;
if (!Number.isFinite(days) || days < 0) {
  console.error('Utilizare: npm run purge-coords -- --older-than-days <N> [--apply]');
  process.exit(2);
}
const apply = args.includes('--apply');
const cutoff = new Date(Date.now() - days * 86400000).toISOString();
const db = openDb(config.DB_PATH);
const rows = db.prepare('SELECT trip_id, payload_json FROM trips_raw WHERE received_at < ?').all(cutoff);
let n = 0;
const strip = (ep) => (ep && typeof ep === 'object' ? { ...ep, lat: null, lng: null, coords_purged: true } : ep);
const work = () => {
  for (const r of rows) {
    const p = JSON.parse(r.payload_json);
    if (p.origin && p.origin.lat === null && p.destination && p.destination.lat === null) continue;
    n++;
    if (!apply) continue;
    p.origin = strip(p.origin);
    p.destination = strip(p.destination);
    db.prepare('UPDATE trips_raw SET payload_json = ? WHERE trip_id = ?').run(JSON.stringify(p), r.trip_id);
    db.prepare('UPDATE trips_analysis SET origin_lat = NULL, origin_lng = NULL, destination_lat = NULL, destination_lng = NULL WHERE trip_id = ?').run(r.trip_id);
  }
  if (apply) {
    db.prepare('INSERT INTO audit_log (at, actor, action, note) VALUES (?,?,?,?)')
      .run(new Date().toISOString(), 'cli', 'PURGE_COORDS', `${n} deplasări primite înainte de ${cutoff}`);
  }
};
if (apply) transaction(db, work); else work();
console.log(`${apply ? 'Coordonate eliminate' : '[simulare] S-ar elimina coordonatele'} pentru ${n} deplasări primite înainte de ${cutoff}.`);
if (!apply) console.log('Adăugați --apply pentru a executa. Notă: după eliminare, reprocesarea acestor deplasări nu mai este posibilă.');
