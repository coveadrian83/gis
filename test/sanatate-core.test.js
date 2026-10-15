'use strict';
// Harta „Sănătatea transportului public”: public/transport/sanatate/core.js, pe o linie sintetică dreaptă de 6 km.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/transport/sanatate/core.js');

const LAT = 47.16, LNG0 = 27.55, KX = 111320 * Math.cos(LAT * Math.PI / 180);
const at = (m) => ({ lat: LAT, lng: LNG0 + m / KX });          // punct la m metri de la începutul liniei, spre est
// linia „X” (ruta 99, sensul 0): 6 km în 24 min (15 km/h), plecări la 6 min între 07:00 și 09:00, zile lucrătoare
const curse = [];
for (let t = 420; t <= 540; t += 6) curse.push([t, t + 24]);
const plan = {
  servicii: { LV: [0, 1, 2, 3, 4] },
  rute: { '99_0': { linie: 'X', tip: 'autobuz', retea: 'local', spre: 'Est', culoare: '#333', lungime: 6000,
    forma: [[LNG0, LAT], [LNG0 + 3000 / KX, LAT], [LNG0 + 6000 / KX, LAT]], curse: { LV: curse } } }
};
// joi, 15.10.2026, 08:00 la Iași (05:00 UTC)
const T = Date.UTC(2026, 9, 15, 5, 0, 0) / 1000;

test('localTime: ora și ziua la Iași', () => {
  assert.deepEqual(C.localTime(T), { min: 480, dow: 3 });
  assert.equal(C.localTime(Date.UTC(2026, 9, 17, 21, 30) / 1000).dow, 6);   // sâmbătă 21:30 UTC = duminică 00:30 la Iași
});

test('planned: vehicule pe traseu, interval, viteză; nimic duminica', () => {
  const p = C.planned(plan.rute['99_0'], plan.servicii, 3, 480);
  assert.equal(p.vehicule, 5);              // plecările de la 07:36 … 08:00 (07:36 + 24 = 08:00, încă pe traseu)
  assert.equal(p.interval, 6);
  assert.ok(Math.abs(p.viteza - 15) < 1e-9);
  assert.equal(C.planned(plan.rute['99_0'], plan.servicii, 6, 480).vehicule, 0);
});

test('project / slice: poziția pe traseu și porțiunea dintre două distanțe', () => {
  const sh = C.prepareShape(plan.rute['99_0'].forma);
  assert.ok(Math.abs(sh.len - 6000) < 1);
  const p = C.project(sh, LAT + 50 / 110540, at(2500).lng);
  assert.ok(Math.abs(p.d - 2500) < 1 && Math.abs(p.off - 50) < 1);
  const s = C.slice(sh, 2500, 3500);
  assert.equal(s.length, 3);                // capătul, vârful de la 3 km, capătul
  assert.ok(Math.abs(s[0][0] - at(2500).lng) < 1e-9);
});

// cinci minute de citiri (la 30 s) pentru vehiculele date ca [id, poziția la T (m), viteza m/s]
function track(vs, opts = {}) {
  const tr = new C.Tracker(plan);
  for (let k = -10; k <= 0; k++) {
    const t = T + k * 30;
    tr.add({ actualizat: t, vehicule: vs.map(([id, d0, v]) => ({ id, nr: String(id), ruta: '99', sens: opts.noSens ? null : '0', ts: t, v: v * 3.6, tip: 'autobuz', ...at(d0 + v * k * 30) })) });
  }
  return tr;
}

test('analyze: linie sănătoasă – vehicule la 6 min unul de altul (1,5 km), la viteza din orar', () => {
  const v = 15 / 3.6, A = C.analyze(track([[1, 600, v], [2, 2100, v], [3, 3600, v], [4, 5100, v]]));
  const l = A.linii['99_0'];
  assert.equal(l.vehicule, 4);
  assert.ok(Math.abs(l.viteza - 15) < 0.01);
  assert.equal(l.parti.serviciu, 0.8);
  assert.deepEqual(l.intervale.map((g) => Math.round(g * 10) / 10), [6, 6, 6]);
  assert.equal(l.parti.regularitate, 1);
  assert.equal(l.pluton + l.goluri + l.opriti, 0);
  assert.ok(l.scor >= 90, 'scor ' + l.scor);
  assert.equal(A.alerte.length, 0);
});

test('analyze: pluton, vehicul oprit și scorul care scade', () => {
  const v = 15 / 3.6;
  // 1 și 2 la 150 m (< 2 min la 15 km/h = 500 m) → pluton; 3 oprit de 5 minute la 4 km; doar 3 vehicule din 5 cerute
  const A = C.analyze(track([[1, 1500, v], [2, 1650, v], [3, 4000, 0]]));
  const l = A.linii['99_0'];
  assert.equal(l.pluton, 1);
  assert.equal(l.opriti, 1);
  assert.equal(l.parti.serviciu, 0.6);
  assert.ok(l.scor < 60, 'scor ' + l.scor);
  assert.deepEqual(A.alerte.map((a) => a.tip).sort(), ['oprit', 'pluton']);
  const veh = Object.fromEntries(A.vehicule.map((s) => [s.id, s]));
  assert.ok(veh[1].pluton && veh[2].pluton && !veh[3].pluton);
  assert.equal(veh[3].oprit, 300);
});

test('Tracker.match: fără sens raportat, vehiculul se potrivește pe traseul cel mai apropiat', () => {
  const A = C.analyze(track([[1, 1000, 4]], { noSens: true }));
  assert.equal(A.vehicule[0].key, '99_0');
  // departe de traseu (500 m) → fără linie
  const tr = new C.Tracker(plan);
  tr.add({ actualizat: T, vehicule: [{ id: 9, ruta: '99', sens: '0', ts: T, lat: LAT + 500 / 110540, lng: at(1000).lng }] });
  assert.equal(C.analyze(tr).retea.faraLinie, 1);
});

test('analyze: mult mai multe vehicule decât în orar → „de verificat”, fără scor și fără plutoane', () => {
  const vs = [];
  for (let i = 0; i < 12; i++) vs.push([i + 1, 400 + i * 200, 3]);
  const l = C.analyze(track(vs)).linii['99_0'];
  assert.equal(l.suspect, true);
  assert.equal(l.scor, null);
  assert.equal(l.pluton, 0);
});

test('speedBins: viteza pe tronsoane de 250 m', () => {
  const b = C.speedBins(track([[1, 3000, 5]]));
  assert.ok(b.length >= 6);
  b.forEach((x) => assert.ok(Math.abs(x.viteza - 18) < 0.01));
  assert.equal(C.speedColor(18), '#9cc43b');
  assert.equal(C.speedColor(3), '#d8433b');
});

test('score / level / fmtMin', () => {
  assert.equal(C.score({ serviciu: 1, viteza: null, regularitate: 0.5 }), 75);
  assert.equal(C.score({}), null);
  assert.equal(C.level(85).nume, 'bun');
  assert.equal(C.level(null).nume, 'fără date');
  assert.equal(C.fmtMin(0.5), '30 s');
  assert.equal(C.fmtMin(2.25), '2,5 min');
});

test('analyze: serviciul pe toată linia – vehicule raportate pe sensul greșit nu scad scorul', () => {
  const r0 = plan.rute['99_0'];
  const plan2 = { servicii: plan.servicii, rute: { '99_0': r0, '99_1': { ...r0, spre: 'Vest', forma: r0.forma.slice().reverse() } } };
  // orarul cere 5 + 5; sursa raportă 8 vehicule pe sensul 0 și 2 pe sensul 1 → linia are tot serviciul
  const tr = new C.Tracker(plan2), vs = [];
  for (let i = 0; i < 8; i++) vs.push({ id: i, ruta: '99', sens: '0', ts: T, ...at(400 + i * 700) });
  for (let i = 8; i < 10; i++) vs.push({ id: i, ruta: '99', sens: '1', ts: T, ...at(6000 - 400 - (i - 8) * 2000) });
  tr.add({ actualizat: T, vehicule: vs });
  const A = C.analyze(tr);
  assert.equal(A.linii['99_1'].parti.serviciu, 1);
  assert.equal(A.linii['99_1'].linieVehicule, 10);
  assert.equal(A.retea.serviciu, 1);
  assert.equal(A.alerte.filter((a) => a.tip === 'lipsa').length, 0);
});

test('vehicule garate: pe o șină de depou sau oprite departe de traseu – nu sunt în serviciu, nici oprite pe linie', () => {
  // depoul: o șină paralelă la 60 m nord de traseu, între 2 și 3 km
  const plan2 = { ...plan, depouri: [[[at(2000).lng, LAT + 60 / 110540], [at(3000).lng, LAT + 60 / 110540]]] };
  const tr = new C.Tracker(plan2);
  for (let k = -10; k <= 0; k++) {
    const t = T + k * 30;
    tr.add({ actualizat: t, vehicule: [
      { id: 1, ruta: '99', sens: '0', ts: t, tip: 'tramvai', lat: LAT + 55 / 110540, lng: at(2500).lng },   // pe șina depoului
      { id: 2, ruta: '99', sens: '0', ts: t, tip: 'autobuz', lat: LAT + 80 / 110540, lng: at(4500).lng },   // parcat la 80 m
      { id: 3, ruta: '99', sens: '0', ts: t, tip: 'autobuz', ...at(1500) }                                  // oprit pe linie
    ] });
  }
  const A = C.analyze(tr), st = Object.fromEntries(A.vehicule.map((s) => [s.id, s]));
  assert.equal(st[1].depou, true);
  assert.equal(st[2].depou, true);
  assert.equal(st[3].depou, false);
  assert.equal(A.retea.garate, 2);
  assert.equal(A.linii['99_0'].vehicule, 1);
  assert.equal(A.linii['99_0'].opriti, 1);
  assert.deepEqual(A.alerte.filter((a) => a.tip === 'oprit').map((a) => a.id), ['3']);
});
