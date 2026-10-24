'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/15min/core.js');
const M = require('../public/micromobilitate/micro.js');

/* Rețea sintetică (graph.bin, versiunea 1) cu atributele din micro.bin:
 *
 *   0 ──bulevard 60 km/h, 400 m── 1
 *   │                             │
 *   stradă locală 300 m           stradă locală 300 m (sens unic 1 → 3? nu: 3 → 1, vezi mai jos)
 *   │                             │
 *   2 ──────pistă 400 m────────── 3 ──trotuar 100 m── 4 ──scări 20 m── 5 ──autostradă 200 m── 6
 */
const LON0 = 27.58, LAT0 = 47.16, DLON = 1 / (C.R_LON * Math.cos(LAT0 * Math.PI / 180)), DLAT = 1 / C.R_LAT;
const P = (xm, ym) => [LON0 + xm * DLON, LAT0 + ym * DLAT];
const NODES = [P(0, 0), P(400, 0), P(0, -300), P(400, -300), P(500, -300), P(520, -300), P(720, -300)];
const { CLS } = M;
// [u, v, lungime, flag scări, clasă, flaguri micro, limită km/h]
const EDGES = [
  [0, 1, 400, 0, CLS.PRIMARY, 0, 60],
  [0, 2, 300, 0, CLS.LOCAL, 0, 0],
  [1, 3, 300, 0, CLS.LOCAL, 2 << 5, 50],     // sens unic pentru vehicule: doar 3 → 1 (nod mare → nod mic)
  [2, 3, 400, 0, CLS.CYCLEWAY, M.F_NOFOOT, 0],
  [3, 4, 100, 0, CLS.FOOTWAY, 0, 0],
  [4, 5, 20, 1, CLS.STEPS, 0, 0],
  [5, 6, 200, 0, CLS.MOTORWAY, M.F_NOFOOT, 0]
];

function buildGraph() {
  const nN = NODES.length, nE = EDGES.length;
  const buf = new ArrayBuffer(16 + 8 * nN + 12 * nE + 4 * (nE + 1));
  new Uint32Array(buf, 0, 4).set([1, nN, nE, 0]);
  let off = 16;
  const ll = new Int32Array(buf, off, 2 * nN); off += 8 * nN;
  NODES.forEach(([lon, lat], i) => { ll[2 * i] = Math.round(lon * 1e5); ll[2 * i + 1] = Math.round(lat * 1e5); });
  const eu = new Uint32Array(buf, off, nE); off += 4 * nE;
  const ev = new Uint32Array(buf, off, nE); off += 4 * nE;
  const lf = new Uint32Array(buf, off, nE);
  EDGES.forEach(([u, v, len, flag], e) => { eu[e] = u; ev[e] = v; lf[e] = (Math.round(len * 10) << 2) | flag; });
  const g = C.parseGraph(buf);
  const mb = new ArrayBuffer(8 + 3 * nE);
  new Uint32Array(mb, 0, 2).set([1, nE]);
  const b = new Uint8Array(mb, 8);
  EDGES.forEach((x, e) => { b[e] = x[4]; b[nE + e] = x[5]; b[2 * nE + e] = x[6]; });
  return M.parseMicro(mb, g);
}
const g = buildGraph();
const V = M.VEHICLES;
const flat = (k, legal) => M.edgeTimes(g, V[k], { v0: V[k].v0, legal, slope: false });

test('micro.bin: citire și verificarea numărului de muchii', () => {
  assert.equal(g.cls[3], CLS.CYCLEWAY);
  assert.equal(M.oneway(g, 2), 2);
  const bad = new ArrayBuffer(8 + 3); new Uint32Array(bad, 0, 2).set([1, 1]);
  assert.throws(() => M.parseMicro(bad, g), /nu corespunde/);
});

test('trotineta: bulevardul de 60 km/h fără pistă se parcurge doar pe jos; bicicleta circulă', () => {
  assert.equal(M.legalMode(g, 0, V.scooter, true), M.PUSH);
  assert.equal(M.legalMode(g, 0, V.bike, true), M.RIDE);
  assert.equal(M.legalMode(g, 0, V.scooter, false), M.RIDE);
  // cu bandă pentru biciclete, trotineta are voie
  g.mflag[0] |= M.F_LANE;
  assert.equal(M.legalMode(g, 0, V.scooter, true), M.RIDE);
  g.mflag[0] &= ~M.F_LANE;
  // fără limită etichetată, strada locală e considerată de 50 km/h; drumul național de 90 km/h
  assert.equal(M.speedLimit(g, 1), 50);
  g.cls[1] = CLS.TRUNK;
  assert.equal(M.speedLimit(g, 1), 90);
  assert.equal(M.legalMode(g, 1, V.scooter, true), M.PUSH);
  g.cls[1] = CLS.LOCAL;
});

test('trotuarul, scările, autostrada', () => {
  assert.equal(M.legalMode(g, 4, V.bike, true), M.PUSH);
  assert.equal(M.legalMode(g, 4, V.scooter, true), M.PUSH);
  assert.equal(M.legalMode(g, 4, V.bike, false), M.RIDE);
  assert.equal(M.legalMode(g, 5, V.bike, true), M.PUSH);
  assert.equal(M.legalMode(g, 5, V.segway, true), M.NO);   // Segway-ul nu se cară pe scări
  for (const k of M.ORDER) for (const legal of [true, false]) assert.equal(M.legalMode(g, 6, V[k], legal), M.NO);
  // alee comună (bicycle=yes): bicicleta da, trotineta nu (nu e pistă)
  g.cls[4] = CLS.SHARED;
  assert.equal(M.legalMode(g, 4, V.bike, true), M.RIDE);
  assert.equal(M.legalMode(g, 4, V.scooter, true), M.PUSH);
  g.cls[4] = CLS.FOOTWAY;
});

test('timpii: pe vehicul, pe jos cu vehiculul de mână, sensul unic', () => {
  const t = flat('bike', true);
  assert.ok(Math.abs(t.tf[1] - 300 / V.bike.v0) < 1e-6);
  assert.equal(t.mf[1], M.RIDE);
  // sensul unic 3 → 1: de la nodul mic (1) la cel mare (3) bicicleta se împinge pe trotuar
  assert.equal(t.mb[2], M.RIDE);
  assert.equal(t.mf[2], M.PUSH);
  assert.ok(Math.abs(t.tf[2] - 300 / M.WALK_PUSH) < 1e-6);
  // trotuarul și scările (cu vehiculul în brațe: +50 %)
  assert.ok(Math.abs(t.tf[4] - 100 / M.WALK_PUSH) < 1e-6);
  assert.ok(Math.abs(t.tf[5] - 20 / M.WALK_PUSH * 1.5) < 1e-6);
  assert.equal(t.tf[6], Infinity);
  // fără restricții: sensul unic nu mai contează
  const f = flat('bike', false);
  assert.equal(f.mf[2], M.RIDE);
  // Segway: scările blochează complet
  const s = flat('segway', true);
  assert.equal(s.tf[5], Infinity);
  assert.equal(s.tb[5], Infinity);
});

test('mersul pe jos: nu pe pista de biciclete fără foot=yes și nu pe autostradă', () => {
  const w = M.walkTimes(g, 1.4, false);
  assert.equal(w.tf[3], Infinity);
  assert.equal(w.tf[6], Infinity);
  assert.ok(Math.abs(w.tf[0] - 400 / 1.4) < 1e-6);
});

test('viteza pe pantă: scade la urcare, crește la vale până la limită; pedelecul urcă mai repede', () => {
  for (const k of M.ORDER) {
    const v = V[k], pw = M.powers(v, v.v0);
    assert.ok(Math.abs(M.speedOnGrade(v, pw, 0) - Math.min(v.v0, v.vCap)) < 1e-3, k + ' pe plat');
    let prev = Infinity;
    for (let s = -0.1; s <= 0.2001; s += 0.01) {
      const sp = M.speedOnGrade(v, pw, s);
      assert.ok(sp <= prev + 1e-9, k + ' monoton la ' + s.toFixed(2));
      assert.ok(sp <= Math.min(v.vDown, v.vCap) + 1e-9);
      prev = sp;
    }
  }
  const bike = M.speedOnGrade(V.bike, M.powers(V.bike, 15 / 3.6), 0.08);
  const ebike = M.speedOnGrade(V.ebike, M.powers(V.ebike, 15 / 3.6), 0.08);
  assert.ok(ebike > bike * 1.5, 'pedelec ' + ebike + ' vs bicicletă ' + bike);
  // trotineta nu depășește 25 km/h nici la vale
  assert.ok(M.speedOnGrade(V.scooter, M.powers(V.scooter, 25 / 3.6), -0.1) <= 25 / 3.6 + 1e-9);
});

test('timpul pe o muchie cu pantă: dus-întors mai lent decât pe plat, urcarea mai lentă decât coborârea', () => {
  const v = V.bike, pw = M.powers(v, v.v0);
  const up = M.rideTime(v, pw, 300, 15, 0, 1), down = M.rideTime(v, pw, 300, 0, 15, 1), plain = M.rideTime(v, pw, 300, 0, 0, 1);
  assert.ok(up > plain && down < plain && up + down > 2 * plain);
  assert.ok(M.rideTime(v, pw, 300, 0, 0, 0.5) === 2 * plain);   // piatră cubică / neasfaltat
});

test('integrarea cu Min15Core: trotineta ocolește bulevardul pe pistă, bicicleta merge direct', () => {
  const grid = C.buildGrid(g), ws = C.workspace(g);
  const bike = M.coreProfile(flat('bike', true)), scooter = M.coreProfile(flat('scooter', true));
  const db = C.dijkstra(g, 0, 0, bike, 3600, ws).slice();
  assert.ok(Math.abs(db[1] - 400 / V.bike.v0) < 1e-6);   // direct pe bulevard
  const ds = C.dijkstra(g, 0, 0, scooter, 3600, ws).slice();
  // trotineta: 0 → 2 → 3 (stradă + pistă) apoi 3 → 1 în sensul permis = 1000 m pe vehicul
  assert.ok(Math.abs(ds[1] - 1000 / V.scooter.v0) < 1e-6, String(ds[1]));
  assert.equal(ds[6], Infinity);
  // muchiile interzise în ambele sensuri nu apar ca atinse
  const reach = C.collectReach(g, ds, 3600, scooter);
  assert.ok(!reach.items.some((it) => it.e === 6));
  // profilul trece prin Min15Core.profile și se compară corect
  const p = C.profile(scooter);
  assert.equal(p.tf, scooter.tf);
  assert.equal(p.access, 1.2);
  assert.ok(C.sameProfile(p, scooter));
  assert.ok(!C.sameProfile(p, bike));
  // ultimii metri până la facilitate se fac pe jos (access), nu cu „viteza” 1 a profilului
  const pts = [[NODES[1][0], NODES[1][1] + 12 * DLAT, 0, 0, 0]];
  const pois = { cats: ['A'], pts, snap: C.snapPois(g, grid, pts) };
  const T = db[1] + 12 / 1.2 + 0.5;
  assert.equal(C.countReach(pois, db, bike, T, false).cats[0], 1);
  assert.equal(C.countReach(pois, db, bike, T - 1, false).cats[0], 0);
});

test('rețeaua confortabilă: bulevardul fără pistă se parcurge pe jos, cel cu bandă rămâne pe vehicul', () => {
  assert.equal(M.legalMode(g, 0, V.bike, true, true), M.PUSH);
  assert.equal(M.legalMode(g, 1, V.bike, true, true), M.RIDE);   // stradă locală
  assert.equal(M.legalMode(g, 3, V.bike, true, true), M.RIDE);   // pistă
  g.mflag[0] |= M.F_LANE;
  assert.equal(M.legalMode(g, 0, V.bike, true, true), M.RIDE);
  g.mflag[0] &= ~M.F_LANE;
  const t = M.edgeTimes(g, V.bike, { v0: V.bike.v0, legal: true, comfort: true, slope: false });
  assert.equal(t.mf[0], M.PUSH);
  // fără legal, opțiunea nu are efect
  assert.equal(M.edgeTimes(g, V.bike, { v0: V.bike.v0, legal: false, comfort: true }).mf[0], M.RIDE);
});

test('parcarea la destinație: doar facilitățile cu o parcare la cel mult 100 m', () => {
  const pts = [P(0, 0).concat([0]), P(80, 0).concat([5]), P(300, 0).concat([1]), P(60, 50).concat([2])];
  assert.deepEqual(Array.from(M.parkingNearby(pts, 5, 100)), [1, 1, 0, 1]);
});

test('bicicletă + transport public: urcare, așteptare, coborâre, fără întoarcere în sens opus', () => {
  const grid = C.buildGrid(g);
  // o linie 2 → 3 → 6 (stațiile lângă nodurile 2, 3 și 6), interval 10 min
  const tr = { stops: [NODES[2].concat(['A']), NODES[3].concat(['B']), NODES[6].concat(['C'])],
    patterns: [{ r: 'X', m: 3, h: 600, s: [0, 1, 2], t: [0, 120, 300] }] };
  const tp = M.prepareTransit(tr, g, grid, C.nearestNode);
  assert.deepEqual(Array.from(tp.node), [2, 3, 6]);
  const dVeh = new Float64Array(g.nN).fill(Infinity);
  dVeh[2] = 100; dVeh[3] = 500;
  const arr = M.transitArrivals(tp, dVeh, 3600, { park: 60 });
  // urcare la A: 100 + 60 + 300 (jumătate din interval) = 460; B: 460 + 120 = 580; C: 460 + 300 = 760
  assert.equal(arr.arrive[0], Infinity);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 2, a + ' ≈ ' + b);   // stațiile sunt la < 1 m de noduri
  near(arr.arrive[1], 580);
  near(arr.arrive[2], 760);
  assert.deepEqual(arr.lines, ['X']);
  // în timpul disponibil scurt nu se mai ajunge la C
  assert.equal(M.transitArrivals(tp, dVeh, 700, { park: 60 }).arrive[2], Infinity);
  const src = M.transitSources(tp, arr, 3600, 1.4);
  assert.deepEqual(src.map((x) => x[0]), [3, 6]);
  near(src[0][1], 580); near(src[1][1], 760);
});

test('lipsurile: segmentele interzise pe drumul cel mai rapid fără restricții primesc puncte', () => {
  const grid = C.buildGrid(g);
  const pts = [NODES[1].concat([0, 0, 0])];   // o facilitate la nodul 1
  const pois = { cats: ['A'], pts, snap: C.snapPois(g, grid, pts) };
  const free = M.edgeTimes(g, V.scooter, { v0: V.scooter.v0, legal: false });
  const rules = M.edgeTimes(g, V.scooter, { v0: V.scooter.v0, legal: true });
  const s = M.gapScores(g, free, rules, [[0, 0]], pois, 3600, { cats: [0] });
  assert.equal(s[0], 1);              // bulevardul de 60 km/h: drumul direct, interzis trotinetei
  assert.equal(s[1], 0);
  const bikeRules = M.edgeTimes(g, V.bike, { v0: V.bike.v0, legal: true });
  assert.equal(M.gapScores(g, M.edgeTimes(g, V.bike, { v0: V.bike.v0, legal: false }), bikeRules, [[0, 0]], pois, 3600, { cats: [0] })[0], 0);
});

test('scorul de risc: tipul drumului, viteza, benzile, șinele, autobuzele, banda pentru biciclete', () => {
  const save = { mflag: g.mflag.slice(), maxspeed: g.maxspeed.slice() };
  g.lanes = new Uint8Array(g.nE); g.tram = new Uint8Array(g.nE); g.bus = new Float32Array(g.nE);
  // bulevardul (primary, 60 km/h): 4 + 2 = 6 puncte → clasa 5
  assert.equal(M.riskPoints(g, 0), 6);
  assert.equal(M.riskBand(g, 0), 5);
  g.maxspeed[0] = 50; assert.equal(M.riskBand(g, 0), 4);          // 4 puncte
  g.mflag[0] |= M.F_LANE; assert.equal(M.riskPoints(g, 0), 3);    // bandă: −1
  g.tram[0] = 1; g.bus[0] = 20; g.lanes[0] = 4; assert.equal(M.riskPoints(g, 0), 6);
  assert.equal(M.riskBand(g, 3), 1);                               // pistă
  assert.equal(M.riskBand(g, 1), 2);                               // stradă locală
  g.maxspeed[1] = 30; assert.equal(M.riskBand(g, 1), 1);           // zonă de 30 km/h
  g.mflag.set(save.mflag); g.maxspeed.set(save.maxspeed);
  g.lanes = null; g.tram = null; g.bus = null;
});

test('rețeaua sigură: segmentele peste pragul de risc se parcurg pe jos (pistele rămân)', () => {
  M.riskBands(g);
  assert.equal(g.risk[0], 5);
  assert.equal(M.legalMode(g, 0, V.bike, true, 2), M.PUSH);
  assert.equal(M.legalMode(g, 1, V.bike, true, 2), M.RIDE);
  assert.equal(M.legalMode(g, 3, V.bike, true, 2), M.RIDE);
  const t = M.edgeTimes(g, V.bike, { v0: V.bike.v0, legal: true, maxRisk: 2 });
  assert.equal(t.mf[0], M.PUSH);
  delete g.risk;
});

test('șinele de tramvai, accidentele legate de stradă și tabelul de validare', () => {
  // o șină de-a lungul bulevardului 0 → 1, la 3 m
  M.markTram(g, [[[NODES[0][0], NODES[0][1] + 3 * DLAT], [NODES[1][0], NODES[1][1] + 3 * DLAT]]], 8);
  assert.equal(g.tram[0], 1);
  assert.equal(g.tram[1], 0);
  // accidente: unul la 5 m de bulevard (grav), unul la 5 m de strada locală, unul departe
  const mid = (a, b, dy) => [(NODES[a][0] + NODES[b][0]) / 2, (NODES[a][1] + NODES[b][1]) / 2 + dy * DLAT];
  const pts = [mid(0, 1, 5).concat([2024, 1, 1, 0, 0]), mid(0, 2, 0).concat([2025, 2, 0, 0, 0]), [27.7, 47.3, 2024, 1, 0, 0, 0]];
  const sn = M.snapAccidents(g, pts, 30);
  assert.deepEqual(Array.from(sn), [0, 1, -1]);
  M.riskBands(g);
  const rows = M.riskTable(g, pts, sn);
  const by = (b) => rows.find((r) => r.band === b);
  assert.equal(by(5).acc, 1); assert.equal(by(5).ksi, 1);
  assert.equal(by(2).acc, 1);
  assert.ok(Math.abs(by(5).km - 0.4) < 1e-6);
  assert.equal(M.riskTable(g, pts, sn, (p) => p[3] === 2).find((r) => r.band === 5).acc, 0);
  delete g.risk; g.tram = null;
});
