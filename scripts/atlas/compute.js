'use strict';
// Toate agregatele atlasului, dintr-un export. Rezultatul (D) conține doar totaluri, mediane și procente pe unități.
const { load, median, quant } = require('./stats.js');
const ST = require('./static.json');
const TPM = ['bus', 'tram', 'train']; // harta 9: autobuz, tramvai, tren
const TPM13 = ['bus', 'tram', 'taxi']; // graficul 13: transport public (cu taxi)
const isGPS = (r) => r.participant_id.startsWith('import-');
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

async function compute(file) {
  const { rows, units } = await load(file);
  const U = Object.values(units);
  const D = { n: rows.length, participants: new Set(rows.map((r) => r.participant_id)).size, units: {} };
  const dates = rows.map((r) => r.trip_date).sort(); D.first = dates[0]; D.last = dates[dates.length - 1];
  for (const u of U) {
    const O = rows.filter((r) => r.o === u.id), Dd = rows.filter((r) => r.d === u.id);
    const cars = O.filter((r) => r.mode === 'car' && r.occupancy != null && !isGPS(r));
    const tp = O.filter((r) => TPM.includes(r.mode));
    D.units[u.id] = { id: u.id, n: u.n, zone: u.zone, o: O.length, d: Dd.length, t: O.length + Dd.length, po: new Set(O.map((r) => r.participant_id)).size,
      med: median(O.map((r) => r.duration_min)), p90: quant(O.map((r) => r.duration_min), 0.9),
      car: cars.length, carP: new Set(cars.map((r) => r.participant_id)).size, occ: cars.length ? cars.reduce((a, r) => a + Math.min(r.occupancy, 5), 0) / cars.length : null,
      solo: cars.length ? cars.filter((r) => r.occupancy === 1).length / cars.length : null, kids: cars.filter((r) => String(r.stops || '').includes('escort_child')).length,
      tp: tp.length, tpShare: O.length ? tp.length / O.length : null };
  }
  // relații
  const rel = {};
  for (const r of rows) { const k = r.o + '>' + r.d; (rel[k] = rel[k] || []).push(r); }
  D.rel = Object.entries(rel).map(([k, L]) => { const [o, d] = k.split('>'); return { o, d, n: L.length, p: new Set(L.map((r) => r.participant_id)).size, med: median(L.map((r) => r.duration_min)) }; })
    .sort((a, b) => b.n - a.n || b.p - a.p);
  D.rows = rows; // doar în memorie, pentru grafice; nu se scrie
  return D;
}
module.exports = { compute, isGPS, TPM, TPM13, r1, r2 };
