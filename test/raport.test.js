'use strict';
// Raportul zilnic: public/transport/raport/agregare.js (rezumatul zilei) și netlify/lib/raport.mjs (store + index),
// pe o linie sintetică dreaptă de 6 km (aceeași ca în sanatate-core.test.js) și un cartier care acoperă prima jumătate.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/transport/raport/agregare.js');
const { createFakeBlobStore } = require('./fake-blobs.js');

const LAT = 47.16, LNG0 = 27.55, KX = 111320 * Math.cos(LAT * Math.PI / 180);
const lngAt = (m) => LNG0 + m / KX;
const curse = [];
for (let t = 420; t <= 540; t += 6) curse.push([t, t + 24]);
const plan = {
  servicii: { LV: [0, 1, 2, 3, 4] },
  rute: { '99_0': { linie: 'X', tip: 'autobuz', retea: 'local', spre: 'Est', culoare: '#333', lungime: 6000,
    forma: [[LNG0, LAT], [lngAt(3000), LAT], [lngAt(6000), LAT]], curse: { LV: curse } } }
};
const zones = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { zone_id: 'Z1', zone_name: 'Vest' },
  geometry: { type: 'Polygon', coordinates: [[[LNG0 - 0.01, LAT - 0.01], [lngAt(3000), LAT - 0.01], [lngAt(3000), LAT + 0.01], [LNG0 - 0.01, LAT + 0.01], [LNG0 - 0.01, LAT - 0.01]]] } }] };
// joi 15.10.2026, 08:00 la Iași = 05:00 UTC
const T0 = Date.UTC(2026, 9, 15, 5, 0, 0) / 1000;

/* Citiri la fiecare minut, 08:00–08:40: vehiculul 1 pleacă de la capăt la 08:02 și merge 15 km/h (o cursă de 24 min),
 * vehiculul 2 stă 10 minute la 2 km (în cartierul Z1), apoi merge. */
function records() {
  const out = [];
  for (let m = 0; m <= 40; m++) {
    const t = T0 + m * 60, d1 = m < 2 ? 100 : Math.min(6000, 100 + (m - 2) * 250), d2 = m < 10 ? 2000 : Math.min(6000, 2000 + (m - 10) * 250);
    out.push({ t, v: [[1, '99', 0, Math.round(LAT * 1e5), Math.round(lngAt(d1) * 1e5), t, 15, 1, 'A1'],
      [2, '99', 0, Math.round(LAT * 1e5), Math.round(lngAt(d2) * 1e5), t, 0, 1, 'A2']] });
  }
  return out;
}

test('hoursOfDay / localDate: ziua locală (vară: 21:00 UTC → 20:59 UTC)', () => {
  const h = G.hoursOfDay('2026-10-15');
  assert.equal(h.length, 24);
  assert.equal(h[0], '2026-10-14T21');
  assert.equal(h[23], '2026-10-15T20');
  assert.equal(G.hoursOfDay('2026-12-15')[0], '2026-12-14T22');   // iarna: UTC+2
  assert.equal(G.localDate(T0), '2026-10-15');
});

test('aggregateDay: cronologie, cursa reconstituită, tronsoane, cartier, punct negru', () => {
  const D = G.aggregateDay(plan, zones, records(), { zi: '2026-10-15' });
  assert.equal(D.citiri, 41);
  assert.equal(D.cronologie.length, 9);                          // 08:00, 08:05 … 08:40
  assert.equal(D.cronologie[0][0], 480);
  // cursa vehiculului 1: ultima poziție la capătul de plecare 08:02, prima la sosire (> 5700 m) la 08:25 → 23 min
  const c = D.curse.find((t) => t[1] === 482);
  assert.ok(c, JSON.stringify(D.curse));
  assert.equal(c[0], '99_0');
  assert.equal(c[2], 23);
  assert.equal(c[3], 24);
  // tronsoanele (cu ≥ 3 observații în mișcare: de la 2 km, unde trec ambele vehicule): în mișcare 15 km/h; tronsonul
  // opririi vehiculului 2 (la 2000 m) are minutele pierdute
  const s = D.tronsoane['99_0'];
  assert.ok(s.benzi[2].length >= 14, JSON.stringify(s.benzi[2]));
  const b12 = s.benzi[2].find((x) => x[0] === 12), stop = s.benzi[2].slice().sort((x, y) => y[2] - x[2])[0];
  assert.ok(Math.abs(b12[1] - 15) < 0.5, 'viteza ' + b12[1]);
  assert.equal(b12[2], 0);
  assert.ok([7, 8].includes(stop[0]) && stop[2] >= 8 && stop[1] < 5, JSON.stringify(stop));
  assert.equal(s.ref[12], 15);
  // cartierul Z1: vehicule-minut, inclusiv opririle vehiculului 2
  const z = D.cartiere.Z1.ore[8];
  assert.ok(z[0] > 10 && z[2] >= 6, JSON.stringify(z));
  // punctul negru: la 2 km, linia X
  assert.ok(D.puncte.length >= 1);
  assert.ok(Math.abs(D.puncte[0][1] - lngAt(2000)) < 0.003);
  assert.equal(D.puncte[0][3], 'X');
  assert.equal(D.rezumat.curse, D.curse.length);
  // liniile pe ore
  assert.ok(D.linii['autobuz|X'].ore[8][5] > 1);
});

test('exporturi CSV: antet + rânduri, ghilimele unde trebuie', () => {
  const D = G.aggregateDay(plan, zones, records(), { zi: '2026-10-15' });
  const t = G.EXPORTS.curse(D, plan).split('\n');
  assert.equal(t[0], 'zi,linie,sens_spre,route_sens,plecare,durata_min,durata_orar_min,raport');
  assert.ok(t[1].startsWith('2026-10-15,X,Est,99_0,08:02,23,24,'));
  assert.equal(G.csv([['a,b', 'c"d']]), '"a,b","c""d"\n');
  Object.keys(G.EXPORTS).forEach((k) => assert.ok(G.EXPORTS[k](D, plan).split('\n').length >= 2, k));
});

test('raport.mjs: ziua de azi parțială, ieri finală, indexul; /live/raport', async () => {
  const GS = await import('../netlify/lib/gps-store.mjs');
  const R = await import('../netlify/lib/raport.mjs');
  const { respond } = await import('../netlify/functions/raport.mjs');
  const store = createFakeBlobStore({ jitter: false });
  for (const r of records()) await store.setJSON('min/' + String(Math.floor(r.t / 60)).padStart(10, '0'), r);
  const now = T0 + 45 * 60;
  const zile = await R.run(store, plan, zones, now);
  assert.deepEqual(zile, ['2026-10-14', '2026-10-15']);
  const idx = await store.get('raport/index');
  assert.deepEqual(idx.zile.map((z) => [z.zi, z.final]), [['2026-10-15', false]]);   // ieri: fără date, nu intră în index
  assert.equal(idx.zile[0].dow, 4);
  // a doua rulare: ieri e deja final → doar azi
  assert.deepEqual(await R.run(store, plan, zones, now + 3600), ['2026-10-15']);
  const r = await respond(store, 'https://x/live/raport?zi=2026-10-15');
  assert.equal((await r.json()).curse.length >= 1, true);
  assert.equal((await respond(store, 'https://x/live/raport?zi=ieri')).status, 400);
  assert.equal((await respond(store, 'https://x/live/raport?zi=2020-01-01')).status, 404);
  assert.equal((await (await respond(store, 'https://x/live/raport')).json()).zile.length, 1);
  // a doua zi: azi devine final
  await R.run(store, plan, zones, now + 86400);
  assert.equal((await store.get('raport/zi/2026-10-15')).final, true);
});
