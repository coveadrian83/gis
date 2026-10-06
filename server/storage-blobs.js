'use strict';

const time = require('./time.js');

/*
 * Stocare Netlify Blobs (fără server de administrat; datele stau în contul Netlify al site-ului).
 *
 * Chei:
 *   raw/<trip_id>       – fiecare deplasare, scrisă o singură dată (onlyIfNew) → idempotență + sursă de reparare
 *   day/<YYYY-MM-DD>    – index pe ziua primirii: listă de înregistrări, pentru citirea rapidă a tuturor datelor
 *   reviews             – deciziile manuale { trip_id: { manual_status, reviewed_at, review_note } }
 *   audit/<YYYY-MM>     – jurnalul de audit pe luni
 *
 * Scrierile în documentele comune folosesc scriere condiționată (ETag) cu reîncercare,
 * astfel încât trimiterile simultane nu se suprascriu.
 *
 * `store` trebuie să ofere API-ul @netlify/blobs: getWithMetadata, get, setJSON, list, delete.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

function createBlobStorage(store) {
  const JSON_OPTS = { type: 'json', consistency: 'strong' };

  /** Citește–modifică–scrie un document JSON cu ETag. fn(data) → date noi sau undefined (fără schimbare). */
  async function mutate(key, fn, init) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const cur = await store.getWithMetadata(key, JSON_OPTS);
      const data = cur ? cur.data : init();
      const next = fn(data);
      if (next === undefined) return data;
      const res = cur && cur.etag
        ? await store.setJSON(key, next, { onlyIfMatch: cur.etag })
        : await store.setJSON(key, next, { onlyIfNew: true });
      if (res && res.modified === false) {
        await sleep(15 + Math.random() * 60 * (attempt + 1));
        continue;
      }
      return next;
    }
    throw new Error('Conflict de scriere persistent pe ' + key);
  }

  async function listKeys(prefix) {
    const r = await store.list({ prefix });
    return r.blobs.map((b) => b.key);
  }

  async function readDays() {
    const keys = await listKeys('day/');
    const docs = await mapLimit(keys, 16, (k) => store.get(k, JSON_OPTS));
    return keys.map((k, i) => ({ key: k, records: docs[i] || [] }));
  }

  const dayKey = (rec) => 'day/' + time.localDate(Date.parse(rec.received_at));

  async function addToIndex(rec) {
    await mutate(dayKey(rec), (arr) => (arr.some((x) => x.trip_id === rec.trip_id) ? undefined : arr.concat([rec])), () => []);
  }

  return {
    kind: 'netlify-blobs',

    async putRaw(rec) {
      const res = await store.setJSON('raw/' + rec.trip_id, rec, { onlyIfNew: true });
      if (res && res.modified === false) {
        // deja primită; ne asigurăm totuși că e în index (o încercare anterioară putea fi întreruptă)
        const existing = await store.get('raw/' + rec.trip_id, JSON_OPTS);
        if (existing) await addToIndex(existing);
        return { created: false };
      }
      await addToIndex(rec);
      return { created: true };
    },

    async getRaw(tripId) {
      return (await store.get('raw/' + tripId, JSON_OPTS)) || null;
    },

    async listRaws() {
      const seen = new Set();
      const out = [];
      for (const d of await readDays()) {
        for (const r of d.records) {
          if (seen.has(r.trip_id)) continue;
          seen.add(r.trip_id);
          out.push(r);
        }
      }
      return out;
    },

    async deleteByParticipant(pid) {
      const removed = [];
      for (const d of await readDays()) {
        if (!d.records.some((r) => r.participant_id === pid)) continue;
        await mutate(d.key, (arr) => {
          const keep = arr.filter((r) => r.participant_id !== pid);
          arr.filter((r) => r.participant_id === pid).forEach((r) => removed.push(r.trip_id));
          return keep.length === arr.length ? undefined : keep;
        }, () => []);
      }
      const ids = [...new Set(removed)];
      await mapLimit(ids, 8, (id) => store.delete('raw/' + id));
      if (ids.length) {
        await mutate('reviews', (obj) => {
          let changed = false;
          ids.forEach((id) => { if (obj[id]) { delete obj[id]; changed = true; } });
          return changed ? obj : undefined;
        }, () => ({}));
      }
      return ids.length;
    },

    async updateRaws(fn) {
      let n = 0;
      for (const d of await readDays()) {
        const changed = [];
        await mutate(d.key, (arr) => {
          changed.length = 0;
          let any = false;
          const next = arr.map((r) => {
            const u = fn(r);
            if (!u) return r;
            any = true;
            changed.push(u);
            return u;
          });
          return any ? next : undefined;
        }, () => []);
        await mapLimit(changed, 8, (u) => store.setJSON('raw/' + u.trip_id, u));
        n += changed.length;
      }
      return n;
    },

    async getReviews() {
      const obj = (await store.get('reviews', JSON_OPTS)) || {};
      return new Map(Object.entries(obj));
    },

    async setReview(tripId, review) {
      await mutate('reviews', (obj) => {
        if (review) obj[tripId] = review;
        else if (obj[tripId]) delete obj[tripId];
        else return undefined;
        return obj;
      }, () => ({}));
    },

    async appendAudit(e) {
      const key = 'audit/' + e.at.slice(0, 7);
      await mutate(key, (arr) => arr.concat([{ id: e.at + '-' + Math.random().toString(36).slice(2, 7), ...e }]), () => []);
    },

    async listAudit(limit) {
      const keys = (await listKeys('audit/')).sort().reverse();
      const out = [];
      for (const k of keys) {
        const arr = (await store.get(k, JSON_OPTS)) || [];
        out.push(...arr.slice().reverse());
        if (out.length >= limit) break;
      }
      return out.slice(0, limit);
    },

    /** Readaugă în index deplasările salvate individual, dar lipsă din index (după o întrerupere). */
    async repair() {
      const indexed = new Set((await this.listRaws()).map((r) => r.trip_id));
      const rawKeys = await listKeys('raw/');
      const missing = rawKeys.filter((k) => !indexed.has(k.slice(4)));
      await mapLimit(missing, 8, async (k) => {
        const rec = await store.get(k, JSON_OPTS);
        if (rec) await addToIndex(rec);
      });
      return { checked: rawKeys.length, repaired: missing.length };
    }
  };
}

module.exports = { createBlobStorage, mapLimit };
