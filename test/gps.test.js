'use strict';
// Colectarea GPS pe minut și istoricul (netlify/lib/gps-store.mjs, gps-colectare.mjs, istoric.mjs), pe un store în memorie.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeBlobStore } = require('./fake-blobs.js');

const veh = (id, ts) => ({ id, nr: String(1000 + id), lat: 47.15 + id / 1e4, lng: 27.59, ts, v: 20, ruta: '8', sens: '1', tip: id % 2 ? 'autobuz' : 'tramvai' });
const T0 = Date.UTC(2026, 9, 15, 6, 0, 0) / 1000;   // 09:00 la Iași

test('pack: forma compactă, reversibilă în pagină (SanatateCore.unpack)', async () => {
  const { pack } = await import('../netlify/lib/gps-store.mjs');
  const C = require('../public/transport/sanatate/core.js');
  const p = pack([veh(1, T0 - 5), veh(2, T0 - 9)], T0);
  assert.deepStrictEqual(p.v[0], [1, '8', 1, 4715010, 2759000, T0 - 5, 20, 1, '1001']);
  const u = C.unpack(p);
  assert.strictEqual(u.actualizat, T0);
  assert.deepStrictEqual(u.vehicule[1], { id: 2, nr: '1002', ruta: '8', sens: 1, lat: 47.1502, lng: 27.59, ts: T0 - 9, v: 20, tip: 'tramvai' });
});

test('save / recent / bundle / hour: citirile pe minut, apoi fișierul orei, fără dubluri', async () => {
  const G = await import('../netlify/lib/gps-store.mjs');
  const store = createFakeBlobStore({ jitter: false });
  for (let i = 0; i < 120; i++) await G.save(store, [veh(1, T0 + i * 60 - 3)], T0 + i * 60);   // 06:00–07:59 UTC
  let now = T0 + 119 * 60;
  assert.strictEqual((await G.recent(store, now, 30)).length, 31);
  // la 07:59, ora 06 s-a încheiat de 59 de minute (> 45) → se mută; ora 07 nu
  let moved = await G.bundle(store, now);
  assert.deepStrictEqual(moved, ['2026-10-15T06']);
  const h6 = await store.get('ora/2026-10-15T06');
  assert.ok(h6.citiri.length > 0 && h6.citiri.length <= 60);
  // la 08:10 ora 07 tot nu se mută (încheiată de 10 minute); o nouă rulare nu dublează ora 06
  now = T0 + 130 * 60;
  for (let i = 120; i <= 130; i++) await G.save(store, [veh(1, T0 + i * 60)], T0 + i * 60);
  await G.bundle(store, now);
  const full = await G.hour(store, '2026-10-15T06');
  assert.strictEqual(full.citiri.length, 60);
  assert.deepStrictEqual(full.citiri.map((c) => c.t), Array.from({ length: 60 }, (_, i) => T0 + i * 60));
  // ora curentă / recentă se citește din citirile pe minut
  assert.strictEqual((await G.hour(store, '2026-10-15T07')).citiri.length, 60);
  assert.strictEqual((await G.recent(store, now, 30)).length, 31);
  const inv = await G.inventory(store);
  assert.deepStrictEqual(inv.ore, ['2026-10-15T06']);
});

test('collect: salvează citirea; fără răspuns de la Tranzy nu scrie nimic', async () => {
  const { collect } = await import('../netlify/functions/gps-colectare.mjs');
  const store = createFakeBlobStore({ jitter: false });
  const sample = [{ id: 5, label: '1051', latitude: 47.15, longitude: 27.59, timestamp: new Date(T0 * 1000 - 20e3).toISOString(), speed: 31, route_id: 8, trip_id: '8_1', vehicle_type: 3 }];
  const realNow = Date.now;
  Date.now = () => T0 * 1000;
  try {
    const r = await collect(store, 'k', async () => ({ ok: true, json: async () => sample }), T0);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.vehicule, 1);
    const bad = await collect(store, 'k', async () => ({ ok: false, status: 403 }), T0 + 60);
    assert.strictEqual(bad.ok, false);
  } finally { Date.now = realNow; }
  assert.deepStrictEqual([...store.data.keys()], ['min/' + String(Math.floor(T0 / 60)).padStart(10, '0')]);
});

test('istoric: ?min, ?ora (validată) și inventarul', async () => {
  const G = await import('../netlify/lib/gps-store.mjs');
  const { respond } = await import('../netlify/functions/istoric.mjs');
  const store = createFakeBlobStore({ jitter: false });
  for (let i = 0; i < 10; i++) await G.save(store, [veh(1, T0 + i * 60)], T0 + i * 60);
  const now = T0 + 9 * 60;
  const r = await respond(store, 'https://x/live/istoric?min=5', now);
  assert.strictEqual((await r.json()).citiri.length, 6);
  assert.strictEqual((await respond(store, 'https://x/live/istoric?ora=azi', now)).status, 400);
  assert.strictEqual((await (await respond(store, 'https://x/live/istoric?ora=2026-10-15T06', now)).json()).citiri.length, 10);
  assert.deepStrictEqual(await (await respond(store, 'https://x/live/istoric', now)).json(), { ore: [], minute: 10 });
});
