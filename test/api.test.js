'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { createApp } = require('../server/server.js');
const { openDb } = require('../server/db.js');
const time = require('../server/time.js');
const baseConfig = require('../server/config.js');
const { build } = require('./fixtures.js');

const cfg = { ...baseConfig, ADMIN_PASSWORD: 'parola-test', STUDY_START: '2020-01-01', STUDY_END: '2099-12-31', COOKIE_SECURE: '0', PERIODS: [] };

let base, app;
test.before(async () => {
  app = createApp(cfg, { db: openDb(':memory:'), geo: build(), tripLimit: 1000 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
test.after(() => app.server.close());

const PID = 'test-participant-0001';
const today = time.localDate();
const yesterday = time.addDays(today, -1);

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

async function post(p, body, headers = {}) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json(), headers: r.headers };
}

let cookie;
async function admin(p, opts = {}) {
  const r = await fetch(base + '/api/admin/' + p, {
    method: opts.method || 'GET',
    headers: { cookie, 'X-Requested-With': 'mobilitate-admin', 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const text = Buffer.from(await r.arrayBuffer()).toString('utf8'); // păstrează BOM-ul
  return { status: r.status, text, json: () => JSON.parse(text) };
}

test('config public și pagini statice', async () => {
  const c = await (await fetch(base + '/api/config')).json();
  assert.equal(c.today, today);
  const html = await fetch(base + '/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal((await fetch(base + '/../server/config.js')).status, 404);
  const r = await fetch(base + '/admin', { redirect: 'manual' });
  assert.equal(r.status, 301);
});

let firstId;
test('trimitere validă → 201, clasificare la server; retrimitere idempotentă → 200', async () => {
  const t = trip();
  firstId = t.trip_id;
  const r = await post('/api/trips', t);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.origin.unit_id, 'LOC-95113');
  assert.equal(r.body.destination.unit_id, 'IAS-Z15');
  assert.equal(r.body.duration_min, 35);
  const again = await post('/api/trips', t);
  assert.equal(again.status, 200);
  assert.equal(again.body.already_received, true);
});

test('reguli de intrare: fereastra de 7 zile, viitor, câmpuri condiționale', async () => {
  let r = await post('/api/trips', trip({ trip_date: time.addDays(today, -8) }));
  assert.equal(r.status, 400);
  assert.equal(r.body.field, 'trip_date');
  r = await post('/api/trips', trip({ trip_date: time.addDays(today, 1) }));
  assert.equal(r.status, 400);
  r = await post('/api/trips', trip({ car_role: null }));
  assert.equal(r.body.field, 'car_role');
  r = await post('/api/trips', trip({ departure_time: '08:00', arrival_time: '08:00' }));
  assert.equal(r.body.field, 'arrival_time');
  r = await post('/api/trips', trip({ mode: 'zbor' }));
  assert.equal(r.body.field, 'mode');
  r = await post('/api/trips', trip({ participant_id: 'x' }));
  assert.equal(r.status, 400);
});

test('validare automată: duplicat → EXCLUDE, durată mare → CHECK, peste miezul nopții', async () => {
  const dup = await post('/api/trips', trip());
  assert.equal(dup.status, 201);
  const long = await post('/api/trips', trip({ departure_time: '12:00', arrival_time: '15:30', mode: 'bus', car_role: null, occupancy: null, pt_line: '28' }));
  assert.equal(long.status, 201);
  const night = await post('/api/trips', trip({ participant_id: 'test-participant-0002', departure_time: '23:40', arrival_time: '00:10', mode: 'walk', destination: { source: 'map', lat: 47.061, lng: 27.626, label: 'x' } }));
  assert.equal(night.status, 201);

  const login = await post('/api/admin/login', { password: 'parola-test' });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];

  const d = (await admin('trips/' + dup.body.trip_id)).json().row;
  assert.equal(d.validation_status, 'EXCLUDE');
  assert.match(d.validation_flags, /DUPLICATE/);
  const l = (await admin('trips/' + long.body.trip_id)).json().row;
  assert.equal(l.validation_status, 'CHECK');
  assert.match(l.validation_flags, /DURATION_LONG/);
  assert.equal(l.pt_line, '28');
  assert.equal(l.car_role, null);
  const n = (await admin('trips/' + night.body.trip_id)).json().row;
  assert.equal(n.duration_min, 30);
  assert.match(n.validation_flags, /OVERNIGHT/);
  assert.match(n.validation_flags, /D_LOCALITY_NEAREST/);
});

test('administrare: autentificare, protecție CSRF, decizie manuală + audit, reprocesare', async () => {
  assert.equal((await post('/api/admin/login', { password: 'gresit' })).status, 401);
  assert.equal((await fetch(base + '/api/admin/summary')).status, 401);
  const noHeader = await fetch(base + `/api/admin/trips/${firstId}/status`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{"status":"CHECK"}' });
  assert.equal(noHeader.status, 403);

  const set = await admin(`trips/${firstId}/status`, { method: 'POST', body: { status: 'CHECK', note: 'verificare' } });
  assert.equal(set.status, 200);
  assert.equal(set.json().manual_status, 'CHECK');

  const rep = (await admin('reprocess', { method: 'POST' })).json();
  assert.equal(rep.processed, 4);
  const after = (await admin('trips/' + firstId)).json();
  assert.equal(after.row.validation_status, 'CHECK');
  assert.equal(after.row.auto_status, 'VALID');
  assert.ok(after.audit.some((a) => a.action === 'SET_STATUS' && a.note === 'verificare'));

  const s = (await admin('summary?status=VALID,CHECK,EXCLUDE')).json();
  assert.equal(s.n_trips, 4);
  assert.equal(s.n_participants, 2);
  assert.equal(s.status.EXCLUDE, 1);
});

test('agregare O–D, acoperire și exporturi', async () => {
  const od = (await admin('od?status=VALID,CHECK')).json();
  const rel = od.rows.find((r) => r.origin_id === 'LOC-95113' && r.destination_id === 'IAS-Z15');
  assert.equal(rel.n_trips, 2);
  assert.equal(rel.n_participants, 1);
  assert.equal(rel.median_min, 122.5);
  const validOnly = (await admin('od?status=VALID')).json();
  assert.ok(!validOnly.rows.some((r) => r.origin_id === 'LOC-95113' && r.destination_id === 'IAS-Z15'));
  const uat = (await admin('od?level=uat&status=VALID,CHECK')).json();
  assert.ok(uat.rows.some((r) => r.origin_id === '90001' && r.destination_id === '95060'));

  const cov = (await admin('coverage?threshold=5')).json();
  assert.ok(cov.rows.find((r) => r.unit_id === 'IAS-Z01').undercovered);

  const csv = await admin('export/trips.csv?status=VALID,CHECK,EXCLUDE&format=excel_ro');
  assert.equal(csv.status, 200);
  assert.ok(csv.text.startsWith('﻿trip_id;participant_id;'));
  const gj = (await admin('export/od.geojson?status=VALID,CHECK')).json();
  assert.equal(gj.type, 'FeatureCollection');
  assert.ok(gj.features.length >= 1);
  const raw = await admin('export/raw.jsonl');
  assert.equal(raw.text.trim().split('\n').length, 4);
});

test('dreptul la ștergere al participantului', async () => {
  const r = await post('/api/participant/erase', { participant_id: 'test-participant-0002' });
  assert.equal(r.body.deleted, 1);
  const s = (await admin('summary?status=VALID,CHECK,EXCLUDE')).json();
  assert.equal(s.n_participants, 1);
  const audit = (await admin('audit')).json();
  assert.ok(audit.rows.some((a) => a.action === 'PARTICIPANT_ERASURE'));
});
