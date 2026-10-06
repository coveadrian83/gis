'use strict';

const analysis = require('./analysis.js');

/**
 * Politica de retenție (spec. §17.2): elimină coordonatele precise ale deplasărilor primite înainte de `cutoffIso`.
 * Clasificarea (zonă / localitate / UAT, distanța) se păstrează ca instantaneu, deci analiza rămâne completă.
 */
async function purgeCoords(storage, analysisRows, cutoffIso, { dryRun = false } = {}) {
  const byId = new Map(analysisRows.map((r) => [r.trip_id, r]));
  const strip = (ep) => (ep && typeof ep === 'object' ? { ...ep, lat: null, lng: null, coords_purged: true } : ep);
  const candidate = (rec) => rec.received_at < cutoffIso && !rec.snapshot && byId.has(rec.trip_id);
  if (dryRun) return (await storage.listRaws()).filter(candidate).length;
  return storage.updateRaws((rec) => {
    if (!candidate(rec)) return null;
    const payload = JSON.parse(rec.payload_json);
    payload.origin = strip(payload.origin);
    payload.destination = strip(payload.destination);
    return { ...rec, payload_json: JSON.stringify(payload), snapshot: analysis.snapshotOf(byId.get(rec.trip_id)) };
  });
}

module.exports = { purgeCoords };
