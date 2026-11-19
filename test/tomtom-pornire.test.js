'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('pornirea TomTom: doar marți–joi la 07 și 17 ora României, iarna și vara', async () => {
  const { trebuiePornit, porneste } = await import('../netlify/functions/tomtom-pornire.mjs');
  // iarna (UTC+2): marți 24 nov. 2026
  assert.strictEqual(trebuiePornit(new Date('2026-11-24T05:29:00Z')), true);   // 07:29
  assert.strictEqual(trebuiePornit(new Date('2026-11-24T06:29:00Z')), false);  // 08:29
  assert.strictEqual(trebuiePornit(new Date('2026-11-24T15:29:00Z')), true);   // 17:29
  assert.strictEqual(trebuiePornit(new Date('2026-11-24T16:29:00Z')), false);  // 18:29
  // vara (UTC+3): miercuri 14 apr. 2027
  assert.strictEqual(trebuiePornit(new Date('2027-04-14T04:29:00Z')), true);   // 07:29
  assert.strictEqual(trebuiePornit(new Date('2027-04-14T05:29:00Z')), false);  // 08:29
  assert.strictEqual(trebuiePornit(new Date('2027-04-14T14:29:00Z')), true);   // 17:29
  // luni și vineri nu; după 30 aprilie 2027 nu
  assert.strictEqual(trebuiePornit(new Date('2026-11-23T05:29:00Z')), false);
  assert.strictEqual(trebuiePornit(new Date('2026-11-27T05:29:00Z')), false);
  assert.strictEqual(trebuiePornit(new Date('2027-05-04T04:29:00Z')), false);
  let cerere;
  const r = await porneste('t', async (url, o) => { cerere = { url, o }; return { status: 204 }; });
  assert.deepStrictEqual(r, { ok: true, status: 204 });
  assert.match(cerere.url, /coveadrian83\/gis\/actions\/workflows\/tomtom-trafic\.yml\/dispatches$/);
  assert.strictEqual(JSON.parse(cerere.o.body).ref, 'main');
});
