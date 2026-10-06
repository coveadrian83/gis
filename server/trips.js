'use strict';

const crypto = require('node:crypto');
const GeoCore = require('../public/shared/geo-core.js');
const Domain = require('../public/shared/domain.js');
const time = require('./time.js');
const { transaction } = require('./db.js');

const MODE_BY_CODE = Domain.byCode(Domain.MODES);
const PURPOSE_BY_CODE = Domain.byCode(Domain.PURPOSES);
const REPEAT_BY_CODE = Domain.byCode(Domain.REPEAT_TYPES);
const ROLE_BY_CODE = Domain.byCode(Domain.CAR_ROLES);
const ENDPOINT_SOURCES = ['poi', 'locality', 'zone', 'map', 'geocoder', 'saved'];

// Aria geografică acceptată pentru coordonate (România + Republica Moldova, cu marjă)
const ACCEPTED_BBOX = { minLat: 43.5, maxLat: 48.8, minLng: 20.0, maxLng: 30.5 };

/*
 * Reguli automate de validare (spec. §17.3). Valorile extreme NU sunt eliminate automat:
 * ele primesc CHECK și sunt revizuite de coordonator. EXCLUDE automat doar pentru duplicat cert.
 */
const FLAG_SEVERITY = {
  DUPLICATE: 'EXCLUDE',
  SAME_POINT: 'CHECK',
  DURATION_SHORT: 'CHECK',
  DURATION_LONG: 'CHECK',
  SPEED_HIGH: 'CHECK',
  BOTH_OUT_ZMI: 'CHECK',
  HIGH_DAILY_VOLUME: 'CHECK',
  TIME_OVERLAP: 'CHECK',
  OCCUPANCY_INCONSISTENT: 'CHECK',
  O_GEO_MISSING: 'CHECK',
  D_GEO_MISSING: 'CHECK',
  O_POINT_OUTSIDE_LOCALITY_UAT: 'CHECK',
  D_POINT_OUTSIDE_LOCALITY_UAT: 'CHECK'
  // restul flag-urilor sunt informative (OVERNIGHT, LATE_REPORT, SAME_UNIT, *_LOCATION_APPROX etc.)
};

const FLAG_LABELS = {
  DUPLICATE: 'Duplicat cert al unei deplasări deja raportate',
  SAME_POINT: 'Originea și destinația sunt practic în același punct',
  DURATION_SHORT: 'Durată foarte scurtă (< 2 min)',
  DURATION_LONG: 'Durată foarte mare (> 180 min)',
  SPEED_HIGH: 'Viteză în linie dreaptă neplauzibilă pentru modul declarat',
  BOTH_OUT_ZMI: 'Origine și destinație ambele în afara ZMI',
  HIGH_DAILY_VOLUME: 'Peste 12 deplasări raportate de același participant în aceeași zi',
  TIME_OVERLAP: 'Se suprapune în timp cu altă deplasare a aceluiași participant',
  OCCUPANCY_INCONSISTENT: 'Pasager declarat cu ocupare 1',
  O_GEO_MISSING: 'Origine neclasificată (date geografice lipsă)',
  D_GEO_MISSING: 'Destinație neclasificată (date geografice lipsă)',
  O_POINT_OUTSIDE_LOCALITY_UAT: 'Markerul originii este în afara UAT-ului localității alese',
  D_POINT_OUTSIDE_LOCALITY_UAT: 'Markerul destinației este în afara UAT-ului localității alese',
  OVERNIGHT: 'Deplasare peste miezul nopții',
  LATE_REPORT: 'Raportată la peste 72 h după sosire',
  SAME_UNIT: 'Deplasare în interiorul aceleiași unități O–D',
  O_LOCATION_APPROX: 'Poziția originii este aproximativă (centrul UAT)',
  D_LOCATION_APPROX: 'Poziția destinației este aproximativă (centrul UAT)',
  O_LOCALITY_NEAREST: 'Origine atribuită celei mai apropiate localități SIRUTA',
  D_LOCALITY_NEAREST: 'Destinație atribuită celei mai apropiate localități SIRUTA',
  O_ZONE_CENTROID: 'Origine aleasă ca zonă (centroid)',
  D_ZONE_CENTROID: 'Destinație aleasă ca zonă (centroid)',
  O_IASI_NO_ZONE: 'Origine în Iași, dar în afara celor 17 zone',
  D_IASI_NO_ZONE: 'Destinație în Iași, dar în afara celor 17 zone',
  O_LOCALITY_IN_IASI: 'Localitate din Municipiul Iași – atribuită zonei MVA–MVI',
  D_LOCALITY_IN_IASI: 'Localitate din Municipiul Iași – atribuită zonei MVA–MVI'
};

class InputError extends Error {
  constructor(message, field) {
    super(message);
    this.field = field;
    this.status = 400;
  }
}

function str(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function parseEndpoint(ep, field) {
  if (!ep || typeof ep !== 'object') throw new InputError(`Lipsește ${field === 'origin' ? 'originea' : 'destinația'}.`, field);
  const lat = Number(ep.lat), lng = Number(ep.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new InputError('Coordonate invalide.', field);
  if (lat < ACCEPTED_BBOX.minLat || lat > ACCEPTED_BBOX.maxLat || lng < ACCEPTED_BBOX.minLng || lng > ACCEPTED_BBOX.maxLng) {
    throw new InputError('Punctul selectat este în afara ariei acceptate de studiu.', field);
  }
  const source = ENDPOINT_SOURCES.includes(ep.source) ? ep.source : 'map';
  return {
    source,
    ref: str(ep.ref, 40),
    label: str(ep.label, 160) || 'Punct pe hartă',
    lat, lng,
    approx: ep.approx === true
  };
}

/**
 * Validează structural payload-ul trimis de aplicație.
 * opts.now – momentul primirii (ms); opts.enforceWindow – aplică fereastra de raportare (max. N zile în urmă).
 */
function parseInput(body, config, opts) {
  const now = opts.now;
  if (!body || typeof body !== 'object') throw new InputError('Cerere invalidă.');
  const out = {};

  out.trip_id = /^[0-9a-f-]{36}$/i.test(String(body.trip_id || '')) ? String(body.trip_id).toLowerCase() : crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(body.participant_id || ''))) throw new InputError('Identificator de participant invalid.', 'participant_id');
  out.participant_id = String(body.participant_id);

  if (!time.isValidDate(body.trip_date)) throw new InputError('Data deplasării este invalidă.', 'trip_date');
  out.trip_date = body.trip_date;
  if (opts.enforceWindow) {
    const today = time.localDate(now);
    const minDate = [config.STUDY_START, time.addDays(today, -config.MAX_DAYS_BACK)].sort().pop();
    if (out.trip_date > today) throw new InputError('Data deplasării nu poate fi în viitor.', 'trip_date');
    if (out.trip_date < minDate) {
      throw new InputError(out.trip_date < config.STUDY_START
        ? 'Data este anterioară începerii studiului.'
        : `Se pot raporta deplasări din ultimele ${config.MAX_DAYS_BACK} zile.`, 'trip_date');
    }
    if (out.trip_date > config.STUDY_END) throw new InputError('Perioada de colectare s-a încheiat.', 'trip_date');
  }

  const dep = Domain.parseHHMM(body.departure_time), arr = Domain.parseHHMM(body.arrival_time);
  if (dep === null) throw new InputError('Ora plecării este invalidă (HH:MM).', 'departure_time');
  if (arr === null) throw new InputError('Ora sosirii este invalidă (HH:MM).', 'arrival_time');
  out.departure_time = String(body.departure_time).trim().padStart(5, '0');
  out.arrival_time = String(body.arrival_time).trim().padStart(5, '0');
  const dur = Domain.durationMinutes(out.departure_time, out.arrival_time);
  if (dur.minutes < 1) throw new InputError('Ora sosirii trebuie să fie după ora plecării.', 'arrival_time');
  out.duration_min = dur.minutes;
  out.overnight = dur.overnight;
  out.arrival_epoch = time.localToEpoch(out.trip_date, dep + dur.minutes);
  if (opts.enforceWindow && out.arrival_epoch > now + 15 * 60 * 1000) {
    throw new InputError('Ora sosirii este în viitor. Raportează deplasarea după ce ai ajuns.', 'arrival_time');
  }

  out.origin = parseEndpoint(body.origin, 'origin');
  out.destination = parseEndpoint(body.destination, 'destination');

  if (!MODE_BY_CODE[body.mode]) throw new InputError('Alege modul de transport.', 'mode');
  out.mode = body.mode;
  if (!PURPOSE_BY_CODE[body.purpose]) throw new InputError('Alege scopul deplasării.', 'purpose');
  out.purpose = body.purpose;
  if (!REPEAT_BY_CODE[body.repeat_type]) throw new InputError('Alege dacă deplasarea este recurentă sau ocazională.', 'repeat_type');
  out.repeat_type = body.repeat_type;

  out.car_role = null;
  out.occupancy = null;
  if (out.mode === 'car') {
    if (!ROLE_BY_CODE[body.car_role]) throw new InputError('Alege dacă ai fost șofer sau pasager.', 'car_role');
    const occ = parseInt(body.occupancy, 10);
    if (!Domain.OCCUPANCY.includes(occ)) throw new InputError('Alege numărul de persoane din autoturism.', 'occupancy');
    out.car_role = body.car_role;
    out.occupancy = occ;
  }
  out.pt_line = Domain.isPublicTransport(out.mode) ? str(body.pt_line, 30) : null;

  const src = String(body.campaign_source || '');
  out.campaign_source = /^[A-Za-z0-9_.-]{1,40}$/.test(src) ? src.toLowerCase() : null;
  out.app_version = str(body.app_version, 20);
  return out;
}

function round(v, d) {
  if (v === null || v === undefined) return null;
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
}

function periodTag(config, date) {
  const p = (config.PERIODS || []).find((x) => date >= x.from && date <= x.to);
  return p ? p.tag : `LUNA_${date.slice(0, 7)}`;
}

/** Construiește rândul TRIPS_ANALYSIS și flag-urile automate (fără reguli care necesită baza de date). */
function buildAnalysis(input, geo, config, receivedAtMs) {
  const flags = [];
  const o = GeoCore.classifyEndpoint(geo, input.origin);
  const d = GeoCore.classifyEndpoint(geo, input.destination);
  o.flags.forEach((f) => flags.push('O_' + f));
  d.flags.forEach((f) => flags.push('D_' + f));

  const distance = GeoCore.haversineKm(input.origin.lat, input.origin.lng, input.destination.lat, input.destination.lng);
  const approx = input.origin.approx || input.destination.approx ||
    o.flags.includes('ZONE_CENTROID') || d.flags.includes('ZONE_CENTROID');

  if (input.overnight) flags.push('OVERNIGHT');
  if (distance < 0.1) flags.push('SAME_POINT');
  if (o.unit_id === d.unit_id) flags.push('SAME_UNIT');
  if (input.duration_min < 2) flags.push('DURATION_SHORT');
  if (input.duration_min > 180) flags.push('DURATION_LONG');
  if (!approx && distance >= 1) {
    const speed = distance / (input.duration_min / 60);
    if (speed > (Domain.MAX_STRAIGHT_SPEED[input.mode] || 120)) flags.push('SPEED_HIGH');
  }
  if (o.unit_type === 'OUT_ZMI' && d.unit_type === 'OUT_ZMI' && !flags.includes('O_GEO_MISSING')) flags.push('BOTH_OUT_ZMI');
  if (input.car_role === 'passenger' && input.occupancy === 1) flags.push('OCCUPANCY_INCONSISTENT');

  const delayH = (receivedAtMs - input.arrival_epoch) / 3600000;
  if (delayH > 72) flags.push('LATE_REPORT');

  const wd = time.weekday(input.trip_date);
  const dec = config.COORD_DECIMALS;
  const row = {
    trip_id: input.trip_id,
    participant_id: input.participant_id,
    trip_date: input.trip_date,
    departure_time: input.departure_time,
    arrival_time: input.arrival_time,
    duration_min: input.duration_min,
    overnight: input.overnight ? 1 : 0,
    departure_time_band: Domain.timeBand(input.departure_time),
    arrival_time_band: Domain.timeBand(input.arrival_time),
    day_type: wd === 0 || wd === 6 ? 'weekend' : 'weekday',
    period_tag: periodTag(config, input.trip_date),
    distance_km: round(distance, 2),
    mode: input.mode,
    purpose: input.purpose,
    repeat_type: input.repeat_type,
    car_role: input.car_role,
    occupancy: input.occupancy,
    pt_line: input.pt_line,
    submitted_at: new Date(receivedAtMs).toISOString(),
    reporting_delay_hours: round(delayH, 1),
    geometry_version: config.GEOMETRY_VERSION,
    campaign_source: input.campaign_source
  };
  for (const [prefix, c, ep] of [['origin', o, input.origin], ['destination', d, input.destination]]) {
    row[prefix + '_unit_type'] = c.unit_type;
    row[prefix + '_unit_id'] = c.unit_id;
    row[prefix + '_unit_name'] = c.unit_name;
    row[prefix + '_zone_id'] = c.zone_id;
    row[prefix + '_locality_siruta'] = c.locality_siruta;
    row[prefix + '_uat'] = c.uat_siruta;
    row[prefix + '_uat_name'] = c.uat_name;
    row[prefix + '_label'] = ep.label;
    row[prefix + '_source'] = ep.source;
    row[prefix + '_lat'] = round(ep.lat, dec);
    row[prefix + '_lng'] = round(ep.lng, dec);
  }
  return { row, flags };
}

/** Reguli care depind de deplasările anterioare ale aceluiași participant. */
function contextFlags(db, row) {
  const flags = [];
  const earlier = db.prepare(`
    SELECT trip_id, departure_time, arrival_time, duration_min, origin_unit_id, destination_unit_id, validation_flags
    FROM trips_analysis
    WHERE participant_id = ? AND trip_date = ? AND trip_id <> ?
      AND (submitted_at < ? OR (submitted_at = ? AND trip_id < ?))
  `).all(row.participant_id, row.trip_date, row.trip_id, row.submitted_at, row.submitted_at, row.trip_id);

  const dep = Domain.parseHHMM(row.departure_time);
  const end = dep + row.duration_min;
  let duplicate = false, overlap = false;
  for (const e of earlier) {
    if (e.validation_flags.split(',').includes('DUPLICATE')) continue;
    if (e.departure_time === row.departure_time && e.arrival_time === row.arrival_time &&
        e.origin_unit_id === row.origin_unit_id && e.destination_unit_id === row.destination_unit_id) {
      duplicate = true;
      continue;
    }
    const ed = Domain.parseHHMM(e.departure_time), ee = ed + e.duration_min;
    if (dep < ee && ed < end) overlap = true;
  }
  if (duplicate) flags.push('DUPLICATE');
  else if (overlap) flags.push('TIME_OVERLAP');
  if (earlier.length >= 11) flags.push('HIGH_DAILY_VOLUME');
  return flags;
}

function statusFromFlags(flags) {
  let status = 'VALID';
  for (const f of flags) {
    const s = FLAG_SEVERITY[f];
    if (s === 'EXCLUDE') return 'EXCLUDE';
    if (s === 'CHECK') status = 'CHECK';
  }
  return status;
}

const ANALYSIS_COLUMNS = [
  'trip_id', 'participant_id', 'trip_date', 'departure_time', 'arrival_time', 'duration_min', 'overnight',
  'departure_time_band', 'arrival_time_band', 'day_type', 'period_tag',
  'origin_unit_type', 'origin_unit_id', 'origin_unit_name', 'origin_zone_id', 'origin_locality_siruta', 'origin_uat', 'origin_uat_name', 'origin_label', 'origin_source', 'origin_lat', 'origin_lng',
  'destination_unit_type', 'destination_unit_id', 'destination_unit_name', 'destination_zone_id', 'destination_locality_siruta', 'destination_uat', 'destination_uat_name', 'destination_label', 'destination_source', 'destination_lat', 'destination_lng',
  'distance_km', 'mode', 'purpose', 'repeat_type', 'car_role', 'occupancy', 'pt_line',
  'submitted_at', 'reporting_delay_hours', 'auto_status', 'manual_status', 'validation_status', 'validation_flags',
  'geometry_version', 'campaign_source', 'processed_at', 'reviewed_at', 'review_note'
];

function insertAnalysis(db, row) {
  const cols = ANALYSIS_COLUMNS;
  db.prepare(`INSERT INTO trips_analysis (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (row[c] === undefined ? null : row[c])));
}

function finalizeRow(db, built, manual) {
  const flags = built.flags.concat(contextFlags(db, built.row));
  const row = built.row;
  row.validation_flags = flags.join(',');
  row.auto_status = statusFromFlags(flags);
  row.manual_status = manual && manual.manual_status ? manual.manual_status : null;
  row.reviewed_at = manual ? manual.reviewed_at || null : null;
  row.review_note = manual ? manual.review_note || null : null;
  row.validation_status = row.manual_status || row.auto_status;
  row.processed_at = new Date().toISOString();
  return row;
}

/**
 * Înregistrează o deplasare nouă: TRIPS_RAW (nemodificat) + TRIPS_ANALYSIS (derivat).
 * Idempotent pe trip_id (aplicația reîncearcă trimiterile eșuate din coada locală).
 */
function submitTrip(db, geo, config, rawText, nowMs = Date.now()) {
  let body;
  try { body = JSON.parse(rawText); } catch { throw new InputError('JSON invalid.'); }
  const input = parseInput(body, config, { now: nowMs, enforceWindow: true });

  const existing = db.prepare('SELECT participant_id FROM trips_raw WHERE trip_id = ?').get(input.trip_id);
  if (existing) {
    if (existing.participant_id !== input.participant_id) {
      const e = new InputError('Identificator de deplasare deja folosit.');
      e.status = 409;
      throw e;
    }
    return { duplicate_submission: true, row: getTrip(db, input.trip_id) };
  }

  const built = buildAnalysis(input, geo, config, nowMs);
  return transaction(db, () => {
    db.prepare('INSERT INTO trips_raw (trip_id, participant_id, received_at, app_version, payload_json) VALUES (?,?,?,?,?)')
      .run(input.trip_id, input.participant_id, new Date(nowMs).toISOString(), input.app_version, rawText);
    const row = finalizeRow(db, built, null);
    insertAnalysis(db, row);
    return { duplicate_submission: false, row };
  });
}

function getTrip(db, tripId) {
  return db.prepare('SELECT * FROM trips_analysis WHERE trip_id = ?').get(tripId) || null;
}

/**
 * Reconstruiește integral TRIPS_ANALYSIS din TRIPS_RAW cu geometriile și regulile curente.
 * Deciziile manuale (VALID/CHECK/EXCLUDE) ale coordonatorului sunt păstrate.
 */
function reprocessAll(db, geo, config, actor) {
  const previous = new Map();
  for (const r of db.prepare('SELECT * FROM trips_analysis').all()) previous.set(r.trip_id, r);
  const raws = db.prepare('SELECT trip_id, received_at, payload_json FROM trips_raw ORDER BY received_at, trip_id').all();
  let ok = 0;
  const errors = [];
  transaction(db, () => {
    db.exec('DELETE FROM trips_analysis');
    for (const r of raws) {
      try {
        const nowMs = Date.parse(r.received_at);
        const input = parseInput(JSON.parse(r.payload_json), config, { now: nowMs, enforceWindow: false });
        input.trip_id = r.trip_id;
        const built = buildAnalysis(input, geo, config, nowMs);
        insertAnalysis(db, finalizeRow(db, built, previous.get(r.trip_id)));
        ok++;
      } catch (e) {
        // ex. coordonate eliminate prin politica de retenție: rândul de analiză existent se păstrează neschimbat
        if (previous.has(r.trip_id)) insertAnalysis(db, previous.get(r.trip_id));
        errors.push({ trip_id: r.trip_id, error: e.message, kept_previous: previous.has(r.trip_id) });
      }
    }
    db.prepare('INSERT INTO audit_log (at, actor, action, note) VALUES (?,?,?,?)')
      .run(new Date().toISOString(), actor || 'system', 'REPROCESS', `geometrie ${config.GEOMETRY_VERSION}; ${ok} reprocesate; ${errors.length} erori`);
  });
  return { processed: ok, errors };
}

/** Decizie manuală a coordonatorului. Datele declarate nu se modifică niciodată. */
function setStatus(db, tripId, status, note, actor) {
  if (status !== null && !Domain.STATUSES.includes(status)) throw new InputError('Status invalid.');
  const row = getTrip(db, tripId);
  if (!row) {
    const e = new InputError('Deplasare inexistentă.');
    e.status = 404;
    throw e;
  }
  const newStatus = status || row.auto_status;
  const cleanNote = str(note, 500);
  const at = new Date().toISOString();
  transaction(db, () => {
    db.prepare('UPDATE trips_analysis SET manual_status = ?, validation_status = ?, reviewed_at = ?, review_note = ? WHERE trip_id = ?')
      .run(status, newStatus, at, cleanNote, tripId);
    db.prepare('INSERT INTO audit_log (at, actor, action, trip_id, old_status, new_status, note) VALUES (?,?,?,?,?,?,?)')
      .run(at, actor, status ? 'SET_STATUS' : 'RESET_TO_AUTO', tripId, row.validation_status, newStatus, cleanNote);
  });
  return getTrip(db, tripId);
}

module.exports = {
  InputError,
  FLAG_SEVERITY,
  FLAG_LABELS,
  ANALYSIS_COLUMNS,
  parseInput,
  buildAnalysis,
  submitTrip,
  getTrip,
  reprocessAll,
  setStatus,
  statusFromFlags
};
