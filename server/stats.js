'use strict';

const GeoCore = require('../public/shared/geo-core.js');
const Domain = require('../public/shared/domain.js');

// ---------------------------------------------------------------------------
// Filtre comune (dashboard + exporturi)
// ---------------------------------------------------------------------------
const LIST_RE = /^[A-Za-z0-9_.:-]{1,60}$/;

function listParam(v) {
  if (!v) return [];
  return String(v).split(',').map((s) => s.trim()).filter((s) => LIST_RE.test(s));
}

function buildWhere(q, defaults = {}) {
  const where = [];
  const params = [];
  const date = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : null);
  if (date(q.date_from)) { where.push('trip_date >= ?'); params.push(q.date_from); }
  if (date(q.date_to)) { where.push('trip_date <= ?'); params.push(q.date_to); }

  const inList = (col, values) => {
    if (!values.length) return;
    where.push(`${col} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  };
  inList('origin_unit_id', listParam(q.origin));
  inList('destination_unit_id', listParam(q.destination));
  inList('mode', listParam(q.mode));
  inList('purpose', listParam(q.purpose));
  inList('repeat_type', listParam(q.repeat_type));
  inList('period_tag', listParam(q.period_tag));
  inList('day_type', listParam(q.day_type));
  inList('campaign_source', listParam(q.campaign_source));
  const uats = listParam(q.uat);
  if (uats.length) {
    const ph = uats.map(() => '?').join(',');
    where.push(`(origin_uat IN (${ph}) OR destination_uat IN (${ph}))`);
    params.push(...uats, ...uats);
  }
  const statuses = listParam(q.status !== undefined ? q.status : defaults.status).filter((s) => Domain.STATUSES.includes(s));
  inList('validation_status', statuses);
  if (q.flag && LIST_RE.test(q.flag)) { where.push("(',' || validation_flags || ',') LIKE ?"); params.push(`%,${q.flag},%`); }
  if (q.participant && /^[A-Za-z0-9_-]{4,64}$/.test(q.participant)) { where.push('participant_id = ?'); params.push(q.participant); }
  if (q.trip_id && /^[0-9a-f-]{4,36}$/i.test(q.trip_id)) { where.push('trip_id LIKE ?'); params.push(q.trip_id.toLowerCase() + '%'); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

// ---------------------------------------------------------------------------
// Statistici descriptive
// ---------------------------------------------------------------------------
/** Percentilă cu interpolare liniară (tip 7, ca în R/Excel PERCENTILE.INC). */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

function describe(values) {
  const s = values.slice().sort((a, b) => a - b);
  if (!s.length) return { n: 0, mean: null, median: null, p25: null, p75: null, p90: null, min: null, max: null, p90_minus_median: null };
  const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
  const median = percentile(s, 0.5), p90 = percentile(s, 0.9);
  return {
    n: s.length,
    mean: r1(s.reduce((a, b) => a + b, 0) / s.length),
    median: r1(median),
    p25: r1(percentile(s, 0.25)),
    p75: r1(percentile(s, 0.75)),
    p90: r1(p90),
    min: s[0],
    max: s[s.length - 1],
    p90_minus_median: r1(p90 - median)
  };
}

/** Regula orientativă de interpretare după volum (spec. §9). */
function volumeClass(n) {
  if (n < 10) return { code: 'SIGNAL', label: '<10 – doar semnalare' };
  if (n < 30) return { code: 'LOW', label: '10–29 – volum redus' };
  if (n < 50) return { code: 'DESCRIPTIVE', label: '30–49 – descriptiv' };
  return { code: 'ROBUST', label: '≥50 – consistent' };
}

function countBy(rows, key) {
  const m = {};
  for (const r of rows) {
    const k = r[key] === null || r[key] === undefined ? '–' : r[key];
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n }));
}

function summary(db, q) {
  const w = buildWhere(q);
  const rows = db.prepare(`SELECT participant_id, trip_date, duration_min, validation_status, mode, purpose, repeat_type,
      period_tag, campaign_source, departure_time_band, day_type, origin_unit_type, destination_unit_type
      FROM trips_analysis ${w.sql}`).all(...w.params);
  const participants = new Set(rows.map((r) => r.participant_id));
  const days = new Set(rows.map((r) => r.trip_date));
  // distribuția pe statusuri ignoră filtrul de status (altfel EXCLUDE ar apărea mereu 0)
  const ws = buildWhere({ ...q, status: '' });
  const status = { VALID: 0, CHECK: 0, EXCLUDE: 0 };
  for (const r of db.prepare(`SELECT validation_status AS s, COUNT(*) AS n FROM trips_analysis ${ws.sql} GROUP BY 1`).all(...ws.params)) status[r.s] = r.n;
  const valid = rows.filter((r) => r.validation_status === 'VALID');
  const external = rows.filter((r) => r.origin_unit_type === 'OUT_ZMI' || r.destination_unit_type === 'OUT_ZMI').length;
  const rawTotal = db.prepare('SELECT COUNT(*) AS n FROM trips_raw').get().n;
  return {
    n_trips: rows.length,
    n_participants: participants.size,
    n_days: days.size,
    n_raw_total: rawTotal,
    status,
    n_external: external,
    duration_valid: describe(valid.map((r) => r.duration_min)),
    by_mode: countBy(rows, 'mode'),
    by_purpose: countBy(rows, 'purpose'),
    by_repeat: countBy(rows, 'repeat_type'),
    by_period: countBy(rows, 'period_tag'),
    by_source: countBy(rows, 'campaign_source'),
    by_day_type: countBy(rows, 'day_type'),
    by_departure_band: countBy(rows, 'departure_time_band').sort((a, b) => String(a.key).localeCompare(String(b.key))),
    by_date: countBy(rows, 'trip_date').sort((a, b) => String(a.key).localeCompare(String(b.key))),
    trips_per_participant: describe([...countByMap(rows, 'participant_id').values()])
  };
}

function countByMap(rows, key) {
  const m = new Map();
  for (const r of rows) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return m;
}

// ---------------------------------------------------------------------------
// OD_AGGREGATED
// ---------------------------------------------------------------------------
function odAggregate(db, q) {
  const level = q.level === 'uat' ? 'uat' : 'unit';
  const w = buildWhere(q, { status: 'VALID' });
  const rows = db.prepare(`SELECT * FROM trips_analysis ${w.sql}`).all(...w.params);
  const groups = new Map();
  for (const r of rows) {
    const o = level === 'uat' ? (r.origin_uat || 'OUT_ZMI') : r.origin_unit_id;
    const d = level === 'uat' ? (r.destination_uat || 'OUT_ZMI') : r.destination_unit_id;
    const key = o + '→' + d;
    let g = groups.get(key);
    if (!g) {
      g = {
        origin_id: o, destination_id: d,
        origin_name: level === 'uat' ? (r.origin_uat_name || 'Exterior ZMI') : r.origin_unit_name,
        destination_name: level === 'uat' ? (r.destination_uat_name || 'Exterior ZMI') : r.destination_unit_name,
        rows: []
      };
      groups.set(key, g);
    }
    g.rows.push(r);
  }
  const minTrips = Math.max(1, parseInt(q.min_trips, 10) || 1);
  const out = [];
  for (const g of groups.values()) {
    if (g.rows.length < minTrips) continue;
    const st = describe(g.rows.map((r) => r.duration_min));
    const car = g.rows.filter((r) => r.mode === 'car' && r.occupancy);
    const lines = countBy(g.rows.filter((r) => r.pt_line), 'pt_line').slice(0, 5);
    const bands = countBy(g.rows, 'departure_time_band');
    out.push({
      origin_id: g.origin_id,
      origin_name: g.origin_name,
      destination_id: g.destination_id,
      destination_name: g.destination_name,
      n_trips: g.rows.length,
      n_participants: new Set(g.rows.map((r) => r.participant_id)).size,
      n_days: new Set(g.rows.map((r) => r.trip_date)).size,
      median_min: st.median,
      mean_min: st.mean,
      p25_min: st.p25,
      p75_min: st.p75,
      p90_min: st.p90,
      p90_minus_median: st.p90_minus_median,
      min_min: st.min,
      max_min: st.max,
      median_distance_km: describe(g.rows.map((r) => r.distance_km).filter((x) => x !== null)).median,
      share_recurrent: Math.round((100 * g.rows.filter((r) => r.repeat_type === 'recurrent').length) / g.rows.length),
      mean_car_occupancy: car.length ? Math.round((car.reduce((a, r) => a + r.occupancy, 0) / car.length) * 100) / 100 : null,
      modes: countBy(g.rows, 'mode').map((x) => `${x.key}:${x.n}`).join(' '),
      purposes: countBy(g.rows, 'purpose').map((x) => `${x.key}:${x.n}`).join(' '),
      peak_departure_band: bands.length ? bands[0].key : null,
      pt_lines: lines.map((x) => `${x.key}:${x.n}`).join(' '),
      volume_class: volumeClass(g.rows.length).label
    });
  }
  out.sort((a, b) => b.n_trips - a.n_trips || String(a.origin_name).localeCompare(String(b.origin_name)));
  return { level, statuses: listParam(q.status !== undefined ? q.status : 'VALID'), rows: out };
}

/** Flux O–D ca GeoJSON (linii între centroizii unităților), pentru QGIS / hartă web. */
function odGeoJson(db, geo, q) {
  const od = odAggregate(db, q);
  const centroids = unitCentroids(db, geo, od.level);
  const features = [];
  for (const r of od.rows) {
    const a = centroids.get(r.origin_id), b = centroids.get(r.destination_id);
    if (!a || !b) continue;
    const geometry = r.origin_id === r.destination_id
      ? { type: 'Point', coordinates: [a[1], a[0]] }
      : { type: 'LineString', coordinates: [[a[1], a[0]], [b[1], b[0]]] };
    features.push({ type: 'Feature', geometry, properties: r });
  }
  return { type: 'FeatureCollection', name: 'od_flows', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features };
}

function unitCentroids(db, geo, level) {
  const m = new Map();
  if (level === 'uat') {
    geo.uats.forEach((u) => u.centroid && m.set(u.siruta, u.centroid));
  } else {
    GeoCore.listUnits(geo).forEach((u) => u.centroid && m.set(u.unit_id, u.centroid));
  }
  // unități fără geometrie (ex. exterior ZMI): media coordonatelor observate
  const obs = db.prepare(`
    SELECT ${level === 'uat' ? "COALESCE(origin_uat,'OUT_ZMI')" : 'origin_unit_id'} AS id, AVG(origin_lat) AS lat, AVG(origin_lng) AS lng FROM trips_analysis WHERE origin_lat IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT ${level === 'uat' ? "COALESCE(destination_uat,'OUT_ZMI')" : 'destination_unit_id'}, AVG(destination_lat), AVG(destination_lng) FROM trips_analysis WHERE destination_lat IS NOT NULL GROUP BY 1
  `).all();
  for (const o of obs) if (!m.has(o.id) && o.lat !== null) m.set(o.id, [o.lat, o.lng]);
  return m;
}

/** Acoperire pe unități O–D: evidențiază zonele/localitățile subacoperite (spec. §11, §19). */
function coverage(db, geo, q) {
  const w = buildWhere(q);
  const counts = new Map();
  const add = (id, name, type, uat, field) => {
    let c = counts.get(id);
    if (!c) { c = { unit_id: id, unit_name: name, unit_type: type, uat_name: uat, as_origin: 0, as_destination: 0 }; counts.set(id, c); }
    c[field]++;
  };
  for (const u of GeoCore.listUnits(geo)) {
    counts.set(u.unit_id, { unit_id: u.unit_id, unit_name: u.unit_name, unit_type: u.unit_type, uat_name: u.uat_name, as_origin: 0, as_destination: 0 });
  }
  const rows = db.prepare(`SELECT origin_unit_id, origin_unit_name, origin_unit_type, origin_uat_name,
      destination_unit_id, destination_unit_name, destination_unit_type, destination_uat_name FROM trips_analysis ${w.sql}`).all(...w.params);
  for (const r of rows) {
    add(r.origin_unit_id, r.origin_unit_name, r.origin_unit_type, r.origin_uat_name, 'as_origin');
    add(r.destination_unit_id, r.destination_unit_name, r.destination_unit_type, r.destination_uat_name, 'as_destination');
  }
  const threshold = Math.max(1, parseInt(q.threshold, 10) || 10);
  const out = [...counts.values()].map((c) => ({ ...c, total: c.as_origin + c.as_destination, undercovered: c.as_origin + c.as_destination < threshold }));
  // UAT_REST fără observații nu sunt relevante ca „subacoperite” (sunt categorii-rest)
  return {
    threshold,
    rows: out
      .filter((c) => !(c.unit_type === 'UAT_REST' && c.total === 0))
      .sort((a, b) => a.total - b.total || String(a.unit_name).localeCompare(String(b.unit_name), 'ro'))
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
function toCsv(rows, columns, opts = {}) {
  const sep = opts.excelRo ? ';' : ',';
  const fmt = (v) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'number' && opts.excelRo ? String(v).replace('.', ',') : String(v);
    if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s; // protecție formula injection
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [columns.join(sep)];
  for (const r of rows) lines.push(columns.map((c) => fmt(r[c])).join(sep));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

module.exports = { buildWhere, describe, percentile, volumeClass, summary, odAggregate, odGeoJson, coverage, toCsv };
