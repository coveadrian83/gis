'use strict';

const fs = require('node:fs');
const path = require('node:path');

// node:sqlite este inclus în Node.js >= 22.13; suprimăm doar avertismentul „experimental” al acestui modul.
const origEmit = process.emitWarning;
process.emitWarning = function (warning, ...args) {
  const msg = typeof warning === 'string' ? warning : warning && warning.message;
  if (msg && msg.includes('SQLite is an experimental feature')) return;
  return origEmit.call(process, warning, ...args);
};
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = origEmit;

/*
 * Arhitectura datelor (spec. §17.1):
 *  - trips_raw       – payload-ul primit, păstrat nemodificat (JSON);
 *  - trips_analysis  – date clasificate, validate și îmbogățite; reconstruibile oricând din trips_raw;
 *  - audit_log       – istoricul validărilor manuale și al operațiunilor administrative.
 * GEO_ZONES / GEO_ALIASES sunt fișierele GeoJSON/JSON versionate din public/data (GEOMETRY_VERSION).
 * OD_AGGREGATED se calculează la cerere (dashboard/export) din trips_analysis.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS trips_raw (
  trip_id        TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  received_at    TEXT NOT NULL,
  app_version    TEXT,
  payload_json   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips_analysis (
  trip_id                TEXT PRIMARY KEY REFERENCES trips_raw(trip_id),
  participant_id         TEXT NOT NULL,
  trip_date              TEXT NOT NULL,
  departure_time         TEXT NOT NULL,
  arrival_time           TEXT NOT NULL,
  duration_min           INTEGER NOT NULL,
  overnight              INTEGER NOT NULL DEFAULT 0,
  departure_time_band    TEXT,
  arrival_time_band      TEXT,
  day_type               TEXT,
  period_tag             TEXT,

  origin_unit_type       TEXT,
  origin_unit_id         TEXT,
  origin_unit_name       TEXT,
  origin_zone_id         TEXT,
  origin_locality_siruta TEXT,
  origin_uat             TEXT,
  origin_uat_name        TEXT,
  origin_label           TEXT,
  origin_source          TEXT,
  origin_lat             REAL,
  origin_lng             REAL,

  destination_unit_type       TEXT,
  destination_unit_id         TEXT,
  destination_unit_name       TEXT,
  destination_zone_id         TEXT,
  destination_locality_siruta TEXT,
  destination_uat             TEXT,
  destination_uat_name        TEXT,
  destination_label           TEXT,
  destination_source          TEXT,
  destination_lat             REAL,
  destination_lng             REAL,

  distance_km            REAL,
  mode                   TEXT NOT NULL,
  purpose                TEXT NOT NULL,
  repeat_type            TEXT NOT NULL,
  car_role               TEXT,
  occupancy              INTEGER,
  pt_line                TEXT,

  submitted_at           TEXT NOT NULL,
  reporting_delay_hours  REAL,
  auto_status            TEXT NOT NULL,
  manual_status          TEXT,
  validation_status      TEXT NOT NULL,
  validation_flags       TEXT NOT NULL DEFAULT '',
  geometry_version       TEXT NOT NULL,
  campaign_source        TEXT,
  processed_at           TEXT NOT NULL,
  reviewed_at            TEXT,
  review_note            TEXT
);

CREATE INDEX IF NOT EXISTS ix_ta_date ON trips_analysis(trip_date);
CREATE INDEX IF NOT EXISTS ix_ta_participant ON trips_analysis(participant_id, trip_date);
CREATE INDEX IF NOT EXISTS ix_ta_od ON trips_analysis(origin_unit_id, destination_unit_id);
CREATE INDEX IF NOT EXISTS ix_ta_status ON trips_analysis(validation_status);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,
  trip_id    TEXT,
  old_status TEXT,
  new_status TEXT,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS ix_audit_trip ON audit_log(trip_id);
`;

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, transaction };
