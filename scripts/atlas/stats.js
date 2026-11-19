'use strict';
// Calculele atlasului (agregate) din exportul brut al deplasărilor. Nu scrie nicio deplasare individuală.
const fs = require('node:fs');
const path = require('node:path');
const R = path.join(__dirname, '..', '..');
const { loadGeoFromDir } = require(path.join(R, 'server/geo.js'));
const { analyzeAll } = require(path.join(R, 'server/analysis.js'));
const config = require(path.join(R, 'server/config.js'));
const GeoCore = require(path.join(R, 'public/shared/geo-core.js'));

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const quant = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const unitKey = (side, r) => (r[side + '_uat'] === '95060' ? r[side + '_zone_id'] : 'UAT-' + r[side + '_uat']);

async function load(file) {
  const geo = await loadGeoFromDir(path.join(R, 'public/data'));
  const raws = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    .map((r) => ({ trip_id: r.trip_id, participant_id: r.participant_id, received_at: r.received_at, payload_json: JSON.stringify(r.payload), _p: r.payload }));
  const res = analyzeAll(raws, new Map(), geo, config);
  const byId = new Map(raws.map((r) => [r.trip_id, r._p]));
  const rows = res.rows.filter((r) => r.validation_status !== 'EXCLUDE').map((r) => ({ ...r, o: unitKey('origin', r), d: unitKey('destination', r), p: byId.get(r.trip_id) || {} }));
  const units = {};
  for (const u of GeoCore.listUnits(geo)) {
    if (u.unit_type === 'IAS_ZONE') units[u.unit_id] = { id: u.unit_id, n: u.unit_name, zone: true };
    else if (u.unit_type === 'UAT_REST') { const id = 'UAT-' + u.uat_siruta; if (u.uat_siruta !== '95060') units[id] = { id, n: u.uat_name || u.unit_name, zone: false }; }
  }
  return { rows, units, geo };
}
module.exports = { load, median, quant, unitKey };
if (require.main === module) (async () => {
  const { rows, units } = await load(process.argv[2]);
  console.log(rows.length, Object.keys(units).length, Object.values(units).slice(15, 22));
  console.log(Object.keys(rows[0]).join(' '));
})();
