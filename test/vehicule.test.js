'use strict';
// Funcția Netlify /live/vehicule (netlify/functions/vehicule.mjs): poziții Tranzy → forma compactă a hărții.
const test = require('node:test');
const assert = require('node:assert');

const now = Date.now();
const sample = [
  { id: 1, label: '1051', latitude: 47.15, longitude: 27.59, timestamp: new Date(now - 20e3).toISOString(), speed: 31, route_id: 8, trip_id: '8_1', vehicle_type: 3 },
  { id: 2, label: '2001', latitude: 47.16, longitude: 27.58, timestamp: new Date(now - 30e3).toISOString(), speed: 0, route_id: 1, trip_id: null, vehicle_type: 0 },
  { id: 3, label: 'vechi', latitude: 47.17, longitude: 27.57, timestamp: '2023-03-10T05:53:32.000Z', speed: 0, route_id: null, trip_id: null, vehicle_type: 3 },
];

test('simplify: câmpurile hărții, sensul din trip_id, fără vehiculele fără semnal recent', async () => {
  const { simplify } = await import('../netlify/functions/vehicule.mjs');
  const out = simplify(sample, now);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], { id: 1, nr: '1051', lat: 47.15, lng: 27.59, ts: Math.round((now - 20e3) / 1000), v: 31, ruta: '8', sens: '1', tip: 'autobuz' });
  assert.strictEqual(out[1].tip, 'tramvai');
  assert.strictEqual(out[1].sens, null);
});

test('handler: fără cheie → 503; cu cheie → datele, apoi din cache', async () => {
  const { serve: handler } = await import('../netlify/functions/vehicule.mjs');
  delete process.env.TRANZY_API_KEY;
  assert.strictEqual((await handler()).status, 503);
  process.env.TRANZY_API_KEY = 'test';
  let calls = 0, headers = null;
  const fake = async (_url, opts) => { calls++; headers = opts.headers; return { ok: true, json: async () => sample }; };
  const r = await handler(null, null, fake);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(headers['X-API-KEY'], 'test');
  assert.strictEqual(headers['X-Agency-Id'], '1');
  assert.strictEqual((await r.json()).vehicule.length, 2);
  await handler(null, null, fake);
  assert.strictEqual(calls, 1);
  delete process.env.TRANZY_API_KEY;
});

test('handler: cheia copiată cu spații / ghilimele e curățată', async () => {
  const mod = await import('../netlify/functions/vehicule.mjs?curat');
  process.env.TRANZY_API_KEY = ' "abc123"\n';
  let key = null;
  await mod.serve(null, null, async (_u, o) => { key = o.headers['X-API-KEY']; return { ok: false, status: 403, json: async () => ({}) }; });
  assert.strictEqual(key, 'abc123');
  delete process.env.TRANZY_API_KEY;
});

test('pe pauză: /live/vehicule răspunde 503 fără să contacteze Tranzy', async () => {
  const { default: handler } = await import('../netlify/functions/vehicule.mjs');
  const { PAUZA } = await import('../netlify/lib/pauza.mjs');
  if (!PAUZA) return;
  process.env.TRANZY_API_KEY = 'test';
  const r = await handler(null, null);
  assert.strictEqual(r.status, 503);
  assert.match((await r.json()).eroare, /pauză/);
  delete process.env.TRANZY_API_KEY;
});
