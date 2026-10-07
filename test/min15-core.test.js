'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/15min/core.js');

/* Rețea sintetică în formatul graph.bin (versiunea 1), în jurul Pieței Unirii:
 *
 *   0 ──100 m── 1 ──100 m── 2
 *               │ scări 50 m (flag 1)
 *               3 ──100 m── 4 ──(rampă, flag 2) 60 m── 5
 *   și un ocol fără scări 1 → 6 → 3 de 2 × 150 m.
 */
const LON0 = 27.58, LAT0 = 47.16, DLON = 1 / (C.R_LON * Math.cos(LAT0 * Math.PI / 180)), DLAT = 1 / C.R_LAT;
const P = (xm, ym) => [LON0 + xm * DLON, LAT0 + ym * DLAT];
const NODES = [P(0, 0), P(100, 0), P(200, 0), P(100, -50), P(200, -50), P(260, -50), P(150, -25)];
const EDGES = [[0, 1, 100, 0], [1, 2, 100, 0], [1, 3, 50, 1], [3, 4, 100, 0], [4, 5, 60, 2], [1, 6, 150, 0], [6, 3, 150, 0]];

function buildBin() {
  const nN = NODES.length, nE = EDGES.length, nS = 1;
  const buf = new ArrayBuffer(16 + 8 * nN + 12 * nE + 4 * (nE + 1) + 8 * nS);
  new Uint32Array(buf, 0, 4).set([1, nN, nE, nS]);
  let off = 16;
  const ll = new Int32Array(buf, off, 2 * nN); off += 8 * nN;
  NODES.forEach(([lon, lat], i) => { ll[2 * i] = Math.round(lon * 1e5); ll[2 * i + 1] = Math.round(lat * 1e5); });
  const eu = new Uint32Array(buf, off, nE); off += 4 * nE;
  const ev = new Uint32Array(buf, off, nE); off += 4 * nE;
  const lf = new Uint32Array(buf, off, nE); off += 4 * nE;
  EDGES.forEach(([u, v, len, flag], e) => { eu[e] = u; ev[e] = v; lf[e] = (Math.round(len * 10) << 2) | flag; });
  const sst = new Uint32Array(buf, off, nE + 1); off += 4 * (nE + 1);
  for (let e = 0; e <= nE; e++) sst[e] = e > 5 ? 1 : 0;   // un punct intermediar pe muchia 5 (1 → 6)
  const mid = P(125, -15);
  new Int32Array(buf, off, 2).set([Math.round(mid[0] * 1e5), Math.round(mid[1] * 1e5)]);
  return buf;
}

const g = C.parseGraph(buildBin());
const grid = C.buildGrid(g);
const W = (speed, avoid, extra) => C.profile(Object.assign({ speed, avoid }, extra || {}));

test('citirea rețelei binare: noduri, lungimi, scări, puncte intermediare', () => {
  assert.equal(g.nN, 7);
  assert.equal(g.nE, 7);
  assert.equal(g.elen[0], 100);
  assert.deepEqual(Array.from(g.eflag), [0, 0, 1, 0, 2, 0, 0]);
  assert.equal(C.edgePath(g, 5, false).length, 6);   // capăt + punct intermediar + capăt
  assert.throws(() => C.parseGraph(new Uint32Array([9, 0, 0, 0]).buffer), /Versiune/);
});

test('cel mai apropiat nod', () => {
  const [lon, lat] = P(195, 8);
  const r = C.nearestNode(g, grid, lon, lat);
  assert.equal(r.node, 2);
  assert.ok(Math.abs(r.dist - Math.hypot(5, 8)) < 1.5);
});

test('Dijkstra: scările scurtează drumul, evitarea lor obligă la ocol; rampa rămâne practicabilă', () => {
  const ws = C.workspace(g);
  const withSteps = C.dijkstra(g, 0, 0, W(1, false), 10000, ws);
  assert.equal(withSteps[3], 150);                   // 100 + scări 50
  assert.equal(withSteps[5], 310);                   // … + 100 + rampă 60
  const noSteps = C.dijkstra(g, 0, 0, W(1, true), 10000, ws);
  assert.equal(noSteps[3], 400);                     // 100 + ocol 300
  assert.equal(noSteps[5], 560);                     // rampa (flag 2) nu blochează
  const slow = C.dijkstra(g, 0, 0, W(0.5, false), 10000, ws);
  assert.equal(slow[1], 200);
});

test('spațiul de lucru reutilizat nu păstrează rezultate din căutarea anterioară', () => {
  const ws = C.workspace(g);
  C.dijkstra(g, 0, 0, W(1, false), 10000, ws);
  const d = C.dijkstra(g, 5, 0, W(1, false), 70, ws);   // din 5, doar 60 m până la 4
  assert.equal(d[4], 60);
  assert.equal(d[0], Infinity);
  assert.equal(d[1], Infinity);
});

test('limita de timp și porțiunea de muchie atinsă', () => {
  const d = C.dijkstra(g, 0, 0, W(1, false), 150, C.workspace(g));
  const reach = C.collectReach(g, d, 150, W(1, false));
  const e12 = reach.items.find(it => it.e === 1);
  assert.ok(e12, 'muchia 1–2 este atinsă parțial');
  assert.ok(Math.abs(e12.frac - 0.5) < 1e-6);
  assert.ok(Math.abs(reach.lengthM - (100 + 50 + 50 + 50)) < 1e-3);   // 0–1, jumătate 1–2, scări, o treime 1–6
  const cut = C.cutPath([0, 0, 10, 0, 10, 10], 0.75);
  assert.deepEqual(cut, [0, 0, 10, 0, 10, 5]);
});

test('numărarea facilităților și a stațiilor (inclusiv utilizabile fără scări)', () => {
  const pts = [
    [...P(200, 5), 0, 0, 0],       // alimentație lângă nodul 2 (200 m)
    [...P(100, -55), 1, 0, 0],     // sănătate lângă nodul 3
    [...P(260, -50), 2, 0, 0],     // educație la nodul 5
    [...P(0, 3), 6, 1, 2],         // stație tramvai fără trepte
    [...P(200, -50), 6, 0, 3],     // stație autobuz fără etichetă
    [...P(5000, 5000), 3, 0, 0]    // departe de orice stradă
  ];
  const pois = { cats: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], pts, snap: C.snapPois(g, grid, pts) };
  const ctxW = C.workspace(g);
  const all = C.countReach(pois, C.dijkstra(g, 0, 0, W(1, false), 400, ctxW), W(1, false), 400, true);
  assert.deepEqual(all.cats.slice(0, 3), [1, 1, 1]);
  assert.equal(all.cats[3], 0);
  assert.equal(all.amen, 3);
  assert.equal(all.present, 3);
  assert.equal(all.cats[6], 2);
  assert.equal(all.stUsable, 2);
  assert.deepEqual(all.stByMode, { 1: 0, 2: 1, 3: 1 });
  assert.deepEqual(Array.from(all.inside), [1, 1, 1, 1, 1, 0]);
  const avoid = C.countReach(pois, C.dijkstra(g, 0, 0, W(1, true), 400, ctxW), W(1, true), 400, false);
  assert.equal(avoid.cats[1], 0, 'nodul 3 este la 400 m pe ocol + 5 m de legătură');
  assert.equal(avoid.stUsable, 1, 'doar stația wheelchair=yes contează fără scări');
});

test('point-in-polygon cu gaură, MultiPolygon și grilă de puncte', () => {
  const sq = (x0, y0, s) => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
  const poly = { type: 'Polygon', coordinates: [sq(0, 0, 10), sq(4, 4, 2)] };
  assert.ok(C.pointInGeometry(poly, 1, 1));
  assert.ok(!C.pointInGeometry(poly, 5, 5));
  assert.ok(!C.pointInGeometry(poly, 11, 1));
  const multi = { type: 'MultiPolygon', coordinates: [[sq(0, 0, 1)], [[...sq(5, 5, 1)]]] };
  assert.ok(C.pointInGeometry(multi, 5.5, 5.5));
  const zone = { type: 'Polygon', coordinates: [sq(LON0, LAT0, 0.01)] };
  const pts = C.gridPoints(zone, 200);
  assert.ok(pts.length > 15 && pts.length < 40, String(pts.length));
  assert.ok(pts.every(p => C.pointInGeometry(zone, p[0], p[1])));
  assert.equal(C.thin(pts, 10).length, 10);
});

test('analiza pe zonă: profil lent vs. referință și export CSV', () => {
  const pts = [[...P(200, 2), 0, 0, 0], [...P(255, -50), 2, 0, 0], [...P(0, 0), 3, 0, 0]];
  const pois = { cats: ['Alimentație', 'Sănătate', 'Educație', 'Parcuri', 'Cafenele', 'Bănci', 'Stații'], pts, snap: C.snapPois(g, grid, pts) };
  const ctx = { g, grid, pois, ws: C.workspace(g) };
  const [x0, y0] = P(-20, -70), [x1, y1] = P(280, 20);
  const feature = { properties: { zone_id: 'IAS-Z15', zone_name: 'Centru' },
    geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] } };
  const r = C.analyzeZone(ctx, feature, { minutes: 5, profile: { speed: 0.8, avoid: true }, spacing: 50, maxSnap: 150 });
  assert.equal(r.zone_id, 'IAS-Z15');
  assert.ok(r.points > 0);
  assert.ok(r.amen_mean <= r.amen_mean_ref);
  assert.ok(r.loss_pct >= 0);
  const csv = C.zonesCsv([r], pois.cats);
  assert.match(csv.split('\n')[0], /^zona_id,zona,puncte_analizate/);
  assert.match(csv.split('\n')[0], /acces_alimentatie_pct/);
  assert.match(csv.split('\n')[1], /^IAS-Z15,Centru,/);
});

/* elev.bin sintetic pentru rețeaua de mai sus: nodul 2 este pe un deal (muchia 1–2 urcă 10 m în 100 m),
 * lungimile echivalente sunt cele pe care le-ar scrie scripts/elevatie_15min.py. */
function buildElev() {
  const nN = NODES.length, nE = EDGES.length;
  const buf = new ArrayBuffer(12 + 8 * nE + 2 * nN + 4 * nE + nE + 1);
  new Uint32Array(buf, 0, 3).set([1, nN, nE]);
  let off = 12;
  const lfw = new Float32Array(buf, off, nE); off += 4 * nE;
  const lbw = new Float32Array(buf, off, nE); off += 4 * nE;
  const ele = new Int16Array(buf, off, nN); off += 2 * nN;
  const up = new Uint16Array(buf, off, nE); off += 2 * nE;
  const dn = new Uint16Array(buf, off, nE); off += 2 * nE;
  const grd = new Uint8Array(buf, off, nE);
  EDGES.forEach(([, , len], e) => { lfw[e] = len; lbw[e] = len; grd[e] = 1; });
  lfw[1] = 100 / 0.70; lbw[1] = 100 / 1.19; up[1] = 100; grd[1] = 10;   // +10 %: urcare lentă, coborâre rapidă
  lfw[2] = 50 / 0.45; lbw[2] = 50 / 0.55; grd[2] = C.STAIRS_GRADE;       // scări care urcă
  ele.set([600, 600, 700, 650, 650, 650, 620]);
  return buf;
}

test('panta: elev.bin, timpi asimetrici la urcare și coborâre, scări mai lente', () => {
  const ge = C.parseElev(buildElev(), C.parseGraph(buildBin()));
  assert.equal(ge.ele[2], 70);
  assert.equal(ge.up[1], 10);
  const ws = C.workspace(ge);
  const flat = C.dijkstra(ge, 1, 0, W(1, false), 10000, ws);
  assert.equal(flat[2], 100, 'fără pantă: ca înainte');
  const upHill = C.dijkstra(ge, 1, 0, W(1, false, { slope: true }), 10000, ws);
  assert.ok(Math.abs(upHill[2] - 100 / 0.70) < 1e-3, 'urcarea durează mai mult');
  assert.ok(Math.abs(upHill[3] - 50 / 0.45) < 1e-3, 'scările se urcă mai încet decât se merge pe plat');
  const downHill = C.dijkstra(ge, 2, 0, W(1, false, { slope: true }), 10000, ws);
  assert.ok(Math.abs(downHill[1] - 100 / 1.19) < 1e-3, 'coborârea ușoară este puțin mai rapidă');
  assert.ok(C.dijkstra(ge, 1, 0, W(1, false, { slope: true }), 10000, ws)[3] > C.dijkstra(ge, 3, 0, W(1, false, { slope: true }), 10000, ws)[1]);
});

test('panta maximă acceptată blochează muchiile abrupte, dar nu și scările (acelea depind de „evită scările”)', () => {
  const ge = C.parseElev(buildElev(), C.parseGraph(buildBin()));
  const ws = C.workspace(ge);
  const lim = C.dijkstra(ge, 0, 0, W(1, false, { maxGrade: 8 }), 10000, ws);
  assert.equal(lim[2], Infinity, 'muchia de 10 % este blocată');
  assert.equal(lim[3], 150, 'scările rămân folosibile');
  const reach = C.collectReach(ge, lim, 10000, W(1, false, { maxGrade: 8 }));
  assert.ok(!reach.items.some(it => it.e === 1));
  assert.equal(C.dijkstra(ge, 0, 0, W(1, true, { maxGrade: 12 }), 10000, ws)[2], 200);
  assert.ok(C.sameProfile(C.REF, { speed: 1.4, avoid: false }));
  assert.ok(!C.sameProfile(C.REF, { speed: 1.4, avoid: false, slope: true }));
  assert.throws(() => C.parseElev(buildElev(), { nN: 3, nE: 7 }), /nu corespunde/);
});

test('partea atinsă dintr-o muchie ține cont de sensul urcării', () => {
  const ge = C.parseElev(buildElev(), C.parseGraph(buildBin()));
  const prof = W(1, false, { slope: true });
  const d = C.dijkstra(ge, 1, 0, prof, 50, C.workspace(ge));
  const e12 = C.collectReach(ge, d, 50, prof).items.find(it => it.e === 1);
  assert.ok(Math.abs(e12.frac - 50 / (100 / 0.70)) < 1e-6, 'în 50 s urci doar 35 % din muchia de 10 %');
});
