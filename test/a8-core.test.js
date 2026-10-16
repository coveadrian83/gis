'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/a8/core.js');

test('loturile acoperă tot traseul, în ordine', () => {
  assert.equal(C.LOTURI.length, C.NODURI.length - 1);
  assert.ok(Math.abs(C.KM_TOTAL - 302) < 1, 'A8 are ~302 km în România');
  const ids = new Set(C.LOTURI.map((l) => l.id));
  assert.equal(ids.size, C.LOTURI.length);
  for (const t of Object.values(C.TINTE_CAL)) for (const id of t.ids) assert.ok(ids.has(id), id);
});

test('simularea e deterministă pentru același seed', () => {
  const run = () => { const s = C.stareInitiala(42), rng = C.rngStare(s); while (s.sem < s.orizont) C.pas(s, rng); return s; };
  const a = run(), b = run();
  assert.deepEqual(C.rezultat(a), C.rezultat(b));
  assert.equal(a.sem, 8);
  assert.ok(a.terminat);
  assert.ok(a.deficit[2030] != null);
});

test('mâna de cărți: 4 cărți disponibile, fără duplicate, cel puțin una de buget', () => {
  const s = C.stareInitiala(7), m = C.mana(s);
  assert.equal(m.length, 4);
  assert.equal(new Set(m.map((c) => c.id)).size, 4);
  assert.ok(m.some((c) => c.tip === 'buget'));
  C.aplicaCarte(s, 'avize', C.rngStare(s));
  assert.ok(!C.cartiDisponibile(s).some((c) => c.id === 'avize'), 'o carte permanentă nu mai revine');
});

test('deficitul: banii naționali peste bază intră în deficit', () => {
  const s = C.stareInitiala(1);
  assert.ok(Number.isFinite(C.deficitAn(s, 2027)));
  s.natCheltuit[2027] = 2 * C.BAZA_NATIONAL + 22.01;           // ≈1% din PIB peste bază
  assert.ok(Math.abs(C.deficitAn(s, 2027) - (C.TINTA[2027] + 1)) < 0.02);
});

test('strategiile: mai multe pârghii => mai mulți km; A8 completă până în 2030 rămâne improbabilă', () => {
  const r = (k) => C.estimeaza(C.stareStrategie(k, 1), 300, 3);
  const i = r('inertie'), p = r('program'), t = r('totul');
  assert.ok(i.kmMediu < p.kmMediu && p.kmMediu < t.kmMediu);
  assert.ok(p.complet < 0.05);
  assert.ok(t.iasiUngheni > i.iasiUngheni);
});

test('calendarul: scenariile pesimiste termină mai târziu decât cele optimiste', () => {
  const opt = C.calendar('stabil', 'generos', 'rapid', 150, 5), pes = C.calendar('criza', 'austeritate', 'blocaje', 150, 5);
  assert.ok(opt.complet.p50 < pes.complet.p50);
  assert.ok(opt.complet.p10 <= opt.complet.p50 && opt.complet.p50 <= opt.complet.p90);
  assert.equal(C.dataGata(2031), 'S2 2030');
  assert.equal(C.dataGata(2031.5), 'S1 2031');
  assert.equal(C.dataGata(Infinity), 'după 2040');
});

test('Pipirig – Leghin pornește doar după ordinul de începere; deblocările MVA îl emit imediat', () => {
  const s = C.stareInitiala(11);
  assert.equal(C.lot(s, '2C').stare, 'neactivat');
  C.aplicaCarte(s, 'deblocari', C.rngStare(s));
  assert.equal(C.lot(s, '2C').stare, 'proiectare');
});

test('prioritizarea: în planul MVA, banii naționali merg întâi la Est', () => {
  const s = C.stareInitiala(5);
  s.prioritate = 'mva';
  for (const id of ['T2', 'T4']) C.lot(s, id).stare = 'proiectare';
  s.safeA8 = 0; s.pt = 0; s.national = 0.5;          // bani puțini: doar 0,5 mld. lei pe semestru
  const rng = C.rngStare(s);
  C.pas(s, rng);
  // T4 e primul în ordinea MVA și primește banii; ultimele loturi montane rămân neplătite
  assert.ok(C.lot(s, 'T4').cost < 3.5);
  assert.equal(C.lot(s, '1C').cost, 4.5);
  assert.equal(C.lot(s, '2B').cost, 5.97);
});

test('segmentele prioritare se numără la km deschiși înainte de finalul lotului', () => {
  const s = C.stareInitiala(3);
  C.lot(s, 'T1').etapa = 0;
  assert.equal(C.rezultat(s).km, 5.5);
});

test('scenariul MVA termină mai devreme decât scenariul realist', () => {
  const mva = C.SCENARII.find((x) => x.id === 'mva');
  const a = C.calendar(mva.politic, mva.buget, mva.procedural, 150, 9, mva.prioritate);
  const b = C.calendar('alternanta', 'program', 'actual', 150, 9);
  assert.ok(a.complet.p50 < b.complet.p50);
});
