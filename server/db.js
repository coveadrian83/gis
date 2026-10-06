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
 * Arhitectura datelor (spec. §17.1), varianta SQLite:
 *  - trips_raw  – payload-ul primit, păstrat nemodificat (JSON text);
 *  - reviews    – deciziile manuale ale coordonatorului (VALID/CHECK/EXCLUDE + notă);
 *  - audit_log  – istoricul validărilor și al operațiunilor administrative.
 * TRIPS_ANALYSIS și OD_AGGREGATED se calculează din trips_raw + reviews la fiecare citire
 * (server/analysis.js), deci reflectă mereu geometriile și regulile curente.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS trips_raw (
  trip_id        TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  received_at    TEXT NOT NULL,
  app_version    TEXT,
  payload_json   TEXT NOT NULL,
  snapshot_json  TEXT
);
CREATE INDEX IF NOT EXISTS ix_raw_participant ON trips_raw(participant_id);

CREATE TABLE IF NOT EXISTS reviews (
  trip_id       TEXT PRIMARY KEY,
  manual_status TEXT,
  reviewed_at   TEXT,
  review_note   TEXT
);

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
  // baze create de v0.5: adaugă coloana nouă
  const cols = db.prepare('PRAGMA table_info(trips_raw)').all().map((c) => c.name);
  if (!cols.includes('snapshot_json')) db.exec('ALTER TABLE trips_raw ADD COLUMN snapshot_json TEXT');
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
