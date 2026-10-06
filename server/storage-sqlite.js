'use strict';

const { openDb, transaction } = require('./db.js');

// Stocare SQLite (server Node propriu, teste, comenzi locale). Aceeași interfață ca storage-blobs.js.

function rowToRecord(r) {
  return {
    trip_id: r.trip_id,
    participant_id: r.participant_id,
    received_at: r.received_at,
    app_version: r.app_version,
    payload_json: r.payload_json,
    snapshot: r.snapshot_json ? JSON.parse(r.snapshot_json) : undefined
  };
}

function createSqliteStorage(dbPathOrDb) {
  const db = typeof dbPathOrDb === 'string' ? openDb(dbPathOrDb) : dbPathOrDb;
  return {
    kind: 'sqlite',
    db,

    async putRaw(rec) {
      const r = db.prepare('INSERT OR IGNORE INTO trips_raw (trip_id, participant_id, received_at, app_version, payload_json) VALUES (?,?,?,?,?)')
        .run(rec.trip_id, rec.participant_id, rec.received_at, rec.app_version, rec.payload_json);
      return { created: r.changes === 1 };
    },

    async getRaw(tripId) {
      const r = db.prepare('SELECT * FROM trips_raw WHERE trip_id = ?').get(tripId);
      return r ? rowToRecord(r) : null;
    },

    async listRaws() {
      return db.prepare('SELECT * FROM trips_raw').all().map(rowToRecord);
    },

    async deleteByParticipant(pid) {
      return transaction(db, () => {
        const ids = db.prepare('SELECT trip_id FROM trips_raw WHERE participant_id = ?').all(pid).map((r) => r.trip_id);
        for (const id of ids) db.prepare('DELETE FROM reviews WHERE trip_id = ?').run(id);
        db.prepare('DELETE FROM trips_raw WHERE participant_id = ?').run(pid);
        return ids.length;
      });
    },

    /** fn(record) → record modificat sau null (neschimbat). */
    async updateRaws(fn) {
      return transaction(db, () => {
        let n = 0;
        for (const r of db.prepare('SELECT * FROM trips_raw').all()) {
          const next = fn(rowToRecord(r));
          if (!next) continue;
          db.prepare('UPDATE trips_raw SET payload_json = ?, snapshot_json = ? WHERE trip_id = ?')
            .run(next.payload_json, next.snapshot ? JSON.stringify(next.snapshot) : null, r.trip_id);
          n++;
        }
        return n;
      });
    },

    async getReviews() {
      const m = new Map();
      for (const r of db.prepare('SELECT * FROM reviews').all()) m.set(r.trip_id, r);
      return m;
    },

    async setReview(tripId, review) {
      if (!review) db.prepare('DELETE FROM reviews WHERE trip_id = ?').run(tripId);
      else {
        db.prepare('INSERT INTO reviews (trip_id, manual_status, reviewed_at, review_note) VALUES (?,?,?,?) ON CONFLICT(trip_id) DO UPDATE SET manual_status = excluded.manual_status, reviewed_at = excluded.reviewed_at, review_note = excluded.review_note')
          .run(tripId, review.manual_status, review.reviewed_at, review.review_note);
      }
    },

    async appendAudit(e) {
      db.prepare('INSERT INTO audit_log (at, actor, action, trip_id, old_status, new_status, note) VALUES (?,?,?,?,?,?,?)')
        .run(e.at, e.actor, e.action, e.trip_id || null, e.old_status || null, e.new_status || null, e.note || null);
    },

    async listAudit(limit) {
      return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
    },

    async repair() {
      return { checked: db.prepare('SELECT COUNT(*) AS n FROM trips_raw').get().n, repaired: 0 };
    }
  };
}

module.exports = { createSqliteStorage };
