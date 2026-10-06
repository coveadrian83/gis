'use strict';
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApi } = require('../server/api.js');
const { createApp } = require('../server/server.js');
const { createSqliteStorage } = require('../server/storage-sqlite.js');
const { createBlobStorage } = require('../server/storage-blobs.js');
const time = require('../server/time.js');
const baseConfig = require('../server/config.js');
const { build } = require('./fixtures.js');
const { createFakeBlobStore } = require('./fake-blobs.js');

const cfg = { ...baseConfig, ADMIN_PASSWORD: 'parola-test', STUDY_START: '2020-01-01', STUDY_END: '2099-12-31', COOKIE_SECURE: '0', PERIODS: [], RATE_LIMIT_TRIPS: 10000 };
const geo = build();
const today = time.localDate();
const yesterday = time.addDays(today, -1);
const PID = 'test-participant-0001';

function trip(over = {}) {
  return {
    trip_id: crypto.randomUUID(),
    participant_id: PID,
    trip_date: yesterday,
    departure_time: '07:30',
    arrival_time: '08:05',
    origin: { source: 'locality', ref: '95113', label: 'Păun, Bârnova', lat: 47.06, lng: 27.625, approx: true },
    destination: { source: 'poi', ref: 'POI-GARA', label: 'Gara Iași', lat: 47.1654, lng: 27.5703 },
    mode: 'car', car_role: 'driver', occupancy: 1, purpose: 'work', repeat_type: 'recurrent',
    campaign_source: 'facebook_mvi',
    ...over
  };
}

for (const [name, makeStorage] of [
  ['SQLite', () => createSqliteStorage(':memory:')],
  ['Netlify Blobs', () => createBlobStorage(createFakeBlobStore())]
]) {
  describe(`API cu stocare ${name}`, () => {
    const storage = makeStorage();
    const api = createApi(cfg, { storage, getGeo: async () => geo });
    let cookie = '';

    async function call(method, path, body, headers = {}) {
      const r = await api.handle(new Request('https://test.local' + path, {
        method,
        headers: { 'Content-Type': 'application/json', cookie, ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
      }), { ip: '1.2.3.4' });
      const text = Buffer.from(await r.arrayBuffer()).toString('utf8');
      let json = null;
      try { json = JSON.parse(text); } catch { /* nu e JSON */ }
      return { status: r.status, body: json, text, headers: r.headers };
    }
    const admin = (method, path, body) => call(method, '/api/admin/' + path, body, { 'X-Requested-With': 'mobilitate-admin' });

    let firstId;
    test('trimitere validă → 201 cu clasificare; retrimitere idempotentă → 200', async () => {
      const t = trip();
      firstId = t.trip_id;
      const r = await call('POST', '/api/trips', t);
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.equal(r.body.origin.unit_id, 'LOC-95113');
      assert.equal(r.body.destination.unit_id, 'IAS-Z15');
      assert.equal(r.body.duration_min, 35);
      const again = await call('POST', '/api/trips', t);
      assert.equal(again.status, 200);
      assert.equal(again.body.already_received, true);
      const stolen = await call('POST', '/api/trips', { ...t, participant_id: 'alt-participant-0001' });
      assert.equal(stolen.status, 409);
    });

    test('reguli de intrare: fereastra de 7 zile, viitor, câmpuri condiționale', async () => {
      let r = await call('POST', '/api/trips', trip({ trip_date: time.addDays(today, -8) }));
      assert.equal(r.status, 400);
      assert.equal(r.body.field, 'trip_date');
      r = await call('POST', '/api/trips', trip({ trip_date: time.addDays(today, 1) }));
      assert.equal(r.status, 400);
      r = await call('POST', '/api/trips', trip({ car_role: null }));
      assert.equal(r.body.field, 'car_role');
      r = await call('POST', '/api/trips', trip({ departure_time: '08:00', arrival_time: '08:00' }));
      assert.equal(r.body.field, 'arrival_time');
      r = await call('POST', '/api/trips', trip({ mode: 'zbor' }));
      assert.equal(r.body.field, 'mode');
      r = await call('POST', '/api/trips', trip({ participant_id: 'x' }));
      assert.equal(r.status, 400);
      r = await call('POST', '/api/trips', { ...trip(), pt_line: 'x'.repeat(20000) });
      assert.equal(r.status, 413);
    });

    let dupId, longId, nightId;
    test('autentificare administrator și protecție CSRF', async () => {
      await new Promise((r) => setTimeout(r, 5)); // ordine de primire deterministă față de prima trimitere
      dupId = (await call('POST', '/api/trips', trip())).body.trip_id;
      longId = (await call('POST', '/api/trips', trip({ departure_time: '12:00', arrival_time: '15:30', mode: 'bus', car_role: null, occupancy: null, pt_line: '28' }))).body.trip_id;
      nightId = (await call('POST', '/api/trips', trip({ participant_id: 'test-participant-0002', departure_time: '23:40', arrival_time: '00:10', mode: 'walk', destination: { source: 'map', lat: 47.061, lng: 27.626, label: 'x' } }))).body.trip_id;

      assert.equal((await call('GET', '/api/admin/summary')).status, 401);
      assert.equal((await call('POST', '/api/admin/login', { password: 'gresit' })).status, 401);
      const login = await call('POST', '/api/admin/login', { password: 'parola-test' });
      assert.equal(login.status, 200);
      cookie = login.headers.get('set-cookie').split(';')[0];
      assert.equal((await call('GET', '/api/admin/session')).body.authenticated, true);
      const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
      const saved = cookie;
      cookie = forged;
      assert.equal((await call('GET', '/api/admin/summary')).status, 401);
      cookie = saved;
      const noHeader = await call('POST', `/api/admin/trips/${firstId}/status`, { status: 'CHECK' });
      assert.equal(noHeader.status, 403);
    });

    test('validare automată: duplicat → EXCLUDE, durată mare → CHECK, peste miezul nopții', async () => {
      const d = (await admin('GET', 'trips/' + dupId)).body.row;
      assert.equal(d.validation_status, 'EXCLUDE');
      assert.match(d.validation_flags, /DUPLICATE/);
      const first = (await admin('GET', 'trips/' + firstId)).body.row;
      assert.equal(first.validation_status, 'VALID');
      const l = (await admin('GET', 'trips/' + longId)).body.row;
      assert.equal(l.validation_status, 'CHECK');
      assert.match(l.validation_flags, /DURATION_LONG/);
      assert.equal(l.pt_line, '28');
      assert.equal(l.car_role, null);
      const n = (await admin('GET', 'trips/' + nightId)).body.row;
      assert.equal(n.duration_min, 30);
      assert.match(n.validation_flags, /OVERNIGHT/);
      assert.match(n.validation_flags, /D_LOCALITY_NEAREST/);
    });

    test('decizie manuală + audit; sumarul numără corect statusurile', async () => {
      const set = await admin('POST', `trips/${firstId}/status`, { status: 'CHECK', note: 'verificare' });
      assert.equal(set.status, 200);
      const after = (await admin('GET', 'trips/' + firstId)).body;
      assert.equal(after.row.validation_status, 'CHECK');
      assert.equal(after.row.auto_status, 'VALID');
      assert.ok(after.audit.some((a) => a.action === 'SET_STATUS' && a.note === 'verificare'));
      const s = (await admin('GET', 'summary?status=VALID')).body;
      assert.equal(s.n_raw_total, 4);
      assert.deepEqual(s.status, { VALID: 1, CHECK: 2, EXCLUDE: 1 });
      assert.equal(s.n_trips, 1);
    });

    test('agregare O–D, acoperire și exporturi', async () => {
      const od = (await admin('GET', 'od?status=VALID,CHECK')).body;
      const rel = od.rows.find((r) => r.origin_id === 'LOC-95113' && r.destination_id === 'IAS-Z15');
      assert.equal(rel.n_trips, 2);
      assert.equal(rel.median_min, 122.5);
      const uat = (await admin('GET', 'od?level=uat&status=VALID,CHECK')).body;
      assert.ok(uat.rows.some((r) => r.origin_id === '90001' && r.destination_id === '95060'));
      const cov = (await admin('GET', 'coverage?threshold=5')).body;
      assert.ok(cov.rows.find((r) => r.unit_id === 'IAS-Z01').undercovered);
      const csv = await admin('GET', 'export/trips.csv?status=VALID,CHECK,EXCLUDE&format=excel_ro');
      assert.ok(csv.text.startsWith('﻿trip_id;participant_id;'));
      assert.equal(csv.text.trim().split('\r\n').length, 5);
      const gj = (await admin('GET', 'export/od.geojson?status=VALID,CHECK')).body;
      assert.ok(gj.features.length >= 1);
      const raw = await admin('GET', 'export/raw.jsonl');
      assert.equal(raw.text.trim().split('\n').length, 4);
      const auditCsv = await admin('GET', 'export/audit.csv');
      assert.match(auditCsv.text, /SET_STATUS/);
    });

    test('retenție: coordonatele dispar, clasificarea rămâne', async () => {
      // simulăm o deplasare veche (primită acum 100 de zile) direct în stocare
      const old = trip({ trip_id: crypto.randomUUID(), participant_id: 'test-participant-0003' });
      await storage.putRaw({ trip_id: old.trip_id, participant_id: old.participant_id, received_at: new Date(Date.now() - 100 * 86400000).toISOString(), app_version: 't', payload_json: JSON.stringify(old) });
      const r = await admin('POST', 'purge-coords', { older_than_days: 90 });
      assert.equal(r.body.purged, 1);
      const d = (await admin('GET', 'trips/' + old.trip_id)).body;
      assert.equal(d.row.origin_lat, null);
      assert.equal(d.row.origin_unit_id, 'LOC-95113');
      assert.equal(d.row.destination_unit_id, 'IAS-Z15');
      assert.equal(d.row.distance_km > 10, true);
      assert.equal(d.raw.payload.origin.lat, null);
      assert.equal((await admin('POST', 'purge-coords', { older_than_days: 90 })).body.purged, 0);
    });

    test('dreptul la ștergere al participantului', async () => {
      const r = await call('POST', '/api/participant/erase', { participant_id: 'test-participant-0002' });
      assert.equal(r.body.deleted, 1);
      const s = (await admin('GET', 'summary?status=VALID,CHECK,EXCLUDE')).body;
      assert.equal(s.n_participants, 2);
      assert.ok((await admin('GET', 'audit')).body.rows.some((a) => a.action === 'PARTICIPANT_ERASURE'));
    });
  });
}

test('Netlify Blobs: 40 de trimiteri simultane nu se pierd (scriere condiționată)', async () => {
  const storage = createBlobStorage(createFakeBlobStore());
  const api = createApi(cfg, { storage, getGeo: async () => geo });
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => api.handle(new Request('https://t/api/trips', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trip({ participant_id: 'paralel-' + String(i).padStart(4, '0') }))
  }))));
  assert.ok(results.every((r) => r.status === 201));
  assert.equal((await storage.listRaws()).length, 40);
});

test('Netlify Blobs: repararea indexului readaugă deplasări salvate doar individual', async () => {
  const store = createFakeBlobStore({ jitter: false });
  const storage = createBlobStorage(store);
  const t = trip();
  await store.setJSON('raw/' + t.trip_id, { trip_id: t.trip_id, participant_id: PID, received_at: new Date().toISOString(), payload_json: JSON.stringify(t) });
  assert.equal((await storage.listRaws()).length, 0);
  assert.deepEqual(await storage.repair(), { checked: 1, repaired: 1 });
  assert.equal((await storage.listRaws()).length, 1);
});

describe('server Node propriu', () => {
  let app, base;
  before(async () => {
    app = createApp(cfg, { storage: createSqliteStorage(':memory:'), geo });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${app.server.address().port}`;
  });
  after(() => app.server.close());

  test('pagini statice, antete de securitate, API prin HTTP', async () => {
    const html = await fetch(base + '/');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal((await fetch(base + '/../server/config.js')).status, 404);
    assert.equal((await fetch(base + '/admin', { redirect: 'manual' })).status, 301);
    const c = await (await fetch(base + '/api/config')).json();
    assert.equal(c.today, today);
    const r = await fetch(base + '/api/trips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trip()) });
    assert.equal(r.status, 201);
  });
});
