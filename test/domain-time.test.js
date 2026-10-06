'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Domain = require('../public/shared/domain.js');
const time = require('../server/time.js');
const { percentile, describe, volumeClass } = require('../server/stats.js');

test('durata și trecerea peste miezul nopții', () => {
  assert.deepEqual(Domain.durationMinutes('07:15', '07:58'), { minutes: 43, overnight: false });
  assert.deepEqual(Domain.durationMinutes('23:40', '00:20'), { minutes: 40, overnight: true });
  assert.equal(Domain.durationMinutes('25:00', '07:00'), null);
  assert.equal(Domain.timeBand('07:42'), '07:00–07:59');
});

test('ora Bucureștiului, inclusiv schimbarea orei (25 oct 2026)', () => {
  assert.equal(new Date(time.localToEpoch('2026-10-06', 12 * 60)).toISOString(), '2026-10-06T09:00:00.000Z');
  assert.equal(new Date(time.localToEpoch('2026-10-26', 12 * 60)).toISOString(), '2026-10-26T10:00:00.000Z');
  assert.equal(time.localDate(Date.parse('2026-10-06T22:30:00Z')), '2026-10-07');
  assert.equal(time.addDays('2026-10-01', -7), '2026-09-24');
  assert.equal(time.isValidDate('2026-02-30'), false);
});

test('percentile (interpolare liniară) și clase de volum', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 0.5), 5.5);
  assert.ok(Math.abs(percentile(s, 0.9) - 9.1) < 1e-9);
  const d = describe([30, 10, 20]);
  assert.equal(d.median, 20);
  assert.equal(d.p90_minus_median, 8);
  assert.equal(volumeClass(9).code, 'SIGNAL');
  assert.equal(volumeClass(10).code, 'LOW');
  assert.equal(volumeClass(50).code, 'ROBUST');
});
