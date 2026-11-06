'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oraLocala, fereastra, numeFisier } = require('../scripts/tomtom-trafic.js');

test('ora României, iarna (UTC+2) și vara (UTC+3)', () => {
  assert.equal(oraLocala(new Date('2026-11-10T05:10:00Z')).ora, '07:10');
  assert.equal(oraLocala(new Date('2027-04-06T04:10:00Z')).ora, '07:10');
  assert.equal(oraLocala(new Date('2026-11-10T05:10:00Z')).zi, 2);
});

test('ferestrele de vârf: 07:00–09:00 și 17:00–19:00, ora României', () => {
  assert.equal(fereastra(new Date('2026-11-10T04:10:00Z')), null); // 06:10
  assert.equal(fereastra(new Date('2026-11-10T05:10:00Z')), 'dimineata'); // 07:10
  assert.equal(fereastra(new Date('2026-11-10T06:59:00Z')), 'dimineata'); // 08:59
  assert.equal(fereastra(new Date('2026-11-10T07:00:00Z')), null); // 09:00
  assert.equal(fereastra(new Date('2026-11-10T15:10:00Z')), 'seara'); // 17:10
  assert.equal(fereastra(new Date('2027-04-06T05:10:00Z')), 'dimineata'); // vara: 08:10
});

test('o singură colectare pe fereastră și zi (numele fișierului nu depinde de minut)', () => {
  assert.equal(numeFisier(new Date('2026-11-10T05:10:00Z'), 'dimineata'), '2026-11-10_dimineata.json');
  assert.equal(numeFisier(new Date('2026-11-10T06:40:00Z'), 'dimineata'), '2026-11-10_dimineata.json');
  assert.equal(numeFisier(new Date('2026-11-10T15:10:00Z'), 'seara'), '2026-11-10_seara.json');
});

test('configurația: 26 de relații și punctele de viteză, fără câmpuri personale', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tomtom', 'config.json'), 'utf8'));
  assert.equal(cfg.relatii.length, 26);
  assert.ok(cfg.puncte_viteza.length >= 100);
  for (const r of cfg.relatii) { assert.equal(r.oc.length, 2); assert.equal(r.dc.length, 2); }
  assert.ok(!/participant|trip_id|key=/.test(JSON.stringify(cfg)));
});
