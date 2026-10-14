'use strict';

const crypto = require('node:crypto');
const GeoCore = require('../public/shared/geo-core.js');
const analysis = require('./analysis.js');
const time = require('./time.js');

/*
 * Importul de deplasări din alte surse (ex. Cronologia Google a unui voluntar), făcut de coordonator
 * din panoul de administrare.
 *
 * - Fiecare fișier importat = un participant, cu identificator derivat din eticheta dată de coordonator
 *   (prefix „import-”), ca importurile să poată fi recunoscute, listate și șterse.
 * - Locurile se dau ca unități ale modelului geografic (zonă, localitate, UAT): în date ajunge centrul
 *   unității, nu adresa exactă a participantului.
 * - Se aplică aceleași reguli ca la trimiterile din aplicație, cu excepția ferestrei de 7 zile
 *   (datele importate sunt înregistrate, nu reconstituite din memorie); perioada studiului rămâne obligatorie.
 * - Identificatorul fiecărei deplasări e derivat din conținut, deci reimportul aceluiași fișier nu dublează datele.
 */

const IMPORT_PREFIX = 'import-';
const MAX_TRIPS = 500;

function participantIdFor(label) {
  const norm = String(label || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return IMPORT_PREFIX + crypto.createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

function uuidFrom(text) {
  const h = crypto.createHash('sha256').update(text).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const isImported = (participantId) => String(participantId || '').startsWith(IMPORT_PREFIX);

/**
 * Pregătește importul: validează fiecare deplasare și construiește înregistrările TRIPS_RAW.
 * body: { label, source, trips: [{ trip_date, departure_time, arrival_time, origin_unit, destination_unit,
 *         mode, purpose, repeat_type, stops, car_role, occupancy, pt_line }] }
 */
function prepareImport(body, geo, config, nowMs) {
  const label = String((body && body.label) || '').trim();
  if (label.length < 3 || label.length > 80) throw new analysis.InputError('Dați un nume importului (3–80 de caractere), de exemplu „Voluntar Tomești 01”.', 'label');
  const source = String(body.source || 'import').toLowerCase();
  if (!/^[a-z0-9_.-]{1,40}$/.test(source)) throw new analysis.InputError('Sursa poate conține doar litere fără diacritice, cifre, „_”, „.” și „-”.', 'source');
  const trips = Array.isArray(body.trips) ? body.trips : [];
  if (!trips.length) throw new analysis.InputError('Nu există deplasări de importat.', 'trips');
  if (trips.length > MAX_TRIPS) throw new analysis.InputError(`Cel mult ${MAX_TRIPS} de deplasări într-un import.`, 'trips');

  const participantId = participantIdFor(label);
  const units = new Map(GeoCore.listUnits(geo).map((u) => [u.unit_id, u]));
  const today = time.localDate(nowMs);
  const lastDay = [config.STUDY_END, today].sort()[0];
  const receivedAt = new Date(nowMs).toISOString();

  const endpoint = (unitId, field) => {
    const u = units.get(String(unitId || ''));
    if (!u || !u.centroid) throw new analysis.InputError(`Alegeți ${field === 'origin' ? 'originea' : 'destinația'} dintre zonele și localitățile ZMI.`, field);
    // ca în aplicație: localitatea și zona alese se păstrează ca atare (nu se reîncadrează după punctul central)
    const source = u.unit_type === 'LOCALITY' ? 'locality' : u.unit_type === 'IAS_ZONE' ? 'zone' : 'import';
    const ref = u.unit_type === 'LOCALITY' ? u.unit_id.slice(4) : u.unit_id;
    return { source, ref, label: u.unit_name, lat: u.centroid[0], lng: u.centroid[1], approx: true };
  };

  const results = trips.map((t, index) => {
    try {
      t = t || {};
      if (!time.isValidDate(t.trip_date)) throw new analysis.InputError('Data deplasării este invalidă.', 'trip_date');
      if (t.trip_date < config.STUDY_START) throw new analysis.InputError('Data este anterioară începerii studiului.', 'trip_date');
      if (t.trip_date > lastDay) throw new analysis.InputError(t.trip_date > today ? 'Data deplasării nu poate fi în viitor.' : 'Perioada de colectare s-a încheiat.', 'trip_date');
      const origin = endpoint(t.origin_unit, 'origin');
      const destination = endpoint(t.destination_unit, 'destination');
      const tripId = uuidFrom([participantId, t.trip_date, t.departure_time, t.arrival_time, t.origin_unit, t.destination_unit].join('|'));
      const payload = {
        trip_id: tripId,
        participant_id: participantId,
        app_version: 'import',
        campaign_source: source,
        import_label: label,
        trip_date: t.trip_date,
        departure_time: t.departure_time,
        arrival_time: t.arrival_time,
        origin,
        destination,
        mode: t.mode,
        purpose: t.purpose,
        repeat_type: t.repeat_type || 'recurrent',
        stops: Array.isArray(t.stops) ? t.stops : null,
        car_role: t.car_role,
        occupancy: t.occupancy,
        pt_line: t.pt_line || null
      };
      const input = analysis.parseInput(payload, config, { now: nowMs, enforceWindow: false });
      if (input.arrival_epoch > nowMs + 15 * 60 * 1000) throw new analysis.InputError('Ora sosirii este în viitor.', 'arrival_time');
      input.trip_id = tripId;
      const { row, flags } = analysis.buildAnalysis(input, geo, config, nowMs);
      return {
        index,
        trip_id: tripId,
        status: analysis.statusFromFlags(flags),
        flags,
        trip_date: row.trip_date,
        departure_time: row.departure_time,
        arrival_time: row.arrival_time,
        duration_min: row.duration_min,
        origin: row.origin_unit_name,
        destination: row.destination_unit_name,
        record: { trip_id: tripId, participant_id: participantId, received_at: receivedAt, app_version: 'import', payload_json: JSON.stringify(payload) }
      };
    } catch (e) {
      if (!(e instanceof analysis.InputError)) throw e;
      return { index, error: e.message, field: e.field || null };
    }
  });
  return { participant_id: participantId, label, source, results };
}

/** Rezumatul importurilor existente (din datele brute), pentru listare în panou. */
function listImports(raws) {
  const by = new Map();
  for (const r of raws) {
    if (!isImported(r.participant_id)) continue;
    let p = {};
    try { p = JSON.parse(r.payload_json); } catch { /* ignorat */ }
    const g = by.get(r.participant_id) || { participant_id: r.participant_id, label: p.import_label || null, source: p.campaign_source || null, n_trips: 0, first_date: null, last_date: null, imported_at: r.received_at };
    g.n_trips++;
    if (p.trip_date && (!g.first_date || p.trip_date < g.first_date)) g.first_date = p.trip_date;
    if (p.trip_date && (!g.last_date || p.trip_date > g.last_date)) g.last_date = p.trip_date;
    if (r.received_at > g.imported_at) g.imported_at = r.received_at;
    by.set(r.participant_id, g);
  }
  return [...by.values()].sort((a, b) => (a.imported_at < b.imported_at ? 1 : -1));
}

module.exports = { IMPORT_PREFIX, MAX_TRIPS, participantIdFor, isImported, prepareImport, listImports };
