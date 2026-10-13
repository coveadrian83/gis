/*
 * MicroCore – regulile de circulație și vitezele pentru harta „15 minute pe două roți” (Iași): bicicletă,
 * bicicletă electrică (pedelec), trotinetă electrică, Segway cu ghidon. Fără dependențe de browser.
 *
 * Pentru fiecare segment al rețelei (graph.bin + micro.bin, scrise de scripts/export_micro15.py) și fiecare sens
 * se stabilește modul de parcurgere – pe vehicul, pe jos cu vehiculul de mână sau deloc – și timpul în secunde.
 * Timpii intră apoi în calculul comun al hărții pietonale (public/15min/core.js) ca profil { speed: 1, tf, tb }.
 *
 * Regulile (Codul rutier – OUG 195/2002 și Regulamentul aprobat prin HG 1391/2006; detalii și surse în
 * metodologie.html):
 *   - bicicleta (inclusiv cea cu pedalare asistată ≤ 250 W, asistență până la 25 km/h): pe piste și pe
 *     carosabil; nu pe autostrăzi; pe trotuare și în zonele pietonale doar unde sunt piste sau unde
 *     bicicleta este permisă – altfel se împinge, ca pieton;
 *   - trotineta electrică (≤ 25 km/h): pe pistele pentru biciclete; unde nu există, doar pe drumurile cu
 *     viteza maximă admisă de cel mult 50 km/h; nu pe trotuare;
 *   - sensul unic se respectă (cu excepțiile semnalizate pentru biciclete: oneway:bicycle=no, contrasens).
 * Varianta „fără restricții” ignoră regulile (orice segment practicabil, în ambele sensuri), ca să arate cât
 * pierde utilizatorul din cauza lipsei de infrastructură legală.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MicroCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // clasele și flagurile din micro.bin (aceleași valori ca în scripts/export_micro15.py)
  var CLS = { CYCLEWAY: 0, SHARED: 1, PATH: 2, LOCAL: 3, TERTIARY: 4, SECONDARY: 5, PRIMARY: 6, TRUNK: 7,
    MOTORWAY: 8, FOOTWAY: 9, STEPS: 10, NOBIKE: 11 };
  var F_LANE = 1, F_NOFOOT = 2, F_SETT = 4, F_UNPAVED = 8, OW_SHIFT = 5;
  var NO = 0, RIDE = 1, PUSH = 2;
  var G0 = 9.81, RHO = 1.2;
  var URBAN_LIMIT = 50;     // km/h, limita implicită în localități (OUG 195/2002, art. 49)
  var TRUNK_DEFAULT = 90;   // drum național fără limită etichetată: considerat în afara localității
  var MAX_GRADE = 0.35;

  /* Vehiculele. v0 = viteza de croazieră pe teren plat (m/s, implicit), vMin / vMax = limitele cursorului,
   * vCap = viteza maximă (constructivă / legală), vDown = viteza maximă la vale, m = masa vehicul + utilizator (kg),
   * crr = rezistența la rulare, cda = suprafața aerodinamică (m²), pClimb = puterea disponibilă la urcare (W)
   * – pentru bicicletă un multiplu al puterii de pe plat, pentru celelalte motorul (nominal) –, rules = setul de
   * reguli legale, carry = poate fi cărat pe scări, sett / unpaved = factorul de viteză pe piatră cubică / neasfaltat. */
  var VEHICLES = {
    bike: { name: 'Bicicletă', v0: 15 / 3.6, vMin: 8 / 3.6, vMax: 25 / 3.6, vCap: 40 / 3.6, vDown: 30 / 3.6, m: 95,
      crr: 0.008, cda: 0.6, climbMul: 2.5, motor: 0, rules: 'bicycle', carry: true, sett: 0.8, unpaved: 0.75 },
    ebike: { name: 'Bicicletă electrică', v0: 20 / 3.6, vMin: 10 / 3.6, vMax: 25 / 3.6, vCap: 25 / 3.6, vDown: 30 / 3.6,
      m: 105, crr: 0.008, cda: 0.6, climbMul: 2.5, riderFlat: 15 / 3.6, motor: 250, rules: 'bicycle', carry: true,
      sett: 0.85, unpaved: 0.8 },
    scooter: { name: 'Trotinetă electrică', v0: 18 / 3.6, vMin: 10 / 3.6, vMax: 25 / 3.6, vCap: 25 / 3.6, vDown: 25 / 3.6,
      m: 95, crr: 0.012, cda: 0.6, motor: 350, rules: 'scooter', carry: true, sett: 0.6, unpaved: 0.5 },
    segway: { name: 'Segway (cu ghidon)', v0: 15 / 3.6, vMin: 8 / 3.6, vMax: 20 / 3.6, vCap: 20 / 3.6, vDown: 20 / 3.6,
      m: 130, crr: 0.010, cda: 0.6, motor: 600, rules: 'scooter', carry: false, sett: 0.7, unpaved: 0.6 }
  };
  var ORDER = ['bike', 'ebike', 'scooter', 'segway'];
  var WALK_PUSH = 1.1;   // m/s, mersul pe jos cu vehiculul de mână
  var CARRY_STEPS = 1.5; // timpul pe scări crește cu 50 % când cari vehiculul

  // micro.bin: antet 2 × uint32 (versiune 1, muchii), apoi clasa, flagurile și limita de viteză (uint8 fiecare)
  function parseMicro(buf, g) {
    var h = new Uint32Array(buf, 0, 2);
    if (h[0] !== 1) throw new Error('Versiune necunoscută a fișierului micro.bin');
    if (h[1] !== g.nE) throw new Error('micro.bin nu corespunde rețelei');
    var nE = h[1];
    g.cls = new Uint8Array(buf, 8, nE);
    g.mflag = new Uint8Array(buf, 8 + nE, nE);
    g.maxspeed = new Uint8Array(buf, 8 + 2 * nE, nE);
    return g;
  }

  // limita de viteză folosită pentru regula trotinetelor (≤ 50 km/h)
  function speedLimit(g, e) {
    var v = g.maxspeed[e];
    if (v) return v;
    return g.cls[e] === CLS.TRUNK ? TRUNK_DEFAULT : URBAN_LIMIT;
  }

  /* Rețeaua „confortabilă” (pentru începători, copii de peste 14 ani, oricine evită traficul): pistele, aleile,
   * străzile locale, străzile cu bandă / pistă și străzile terțiare cu limita etichetată de cel mult 30 km/h. */
  function comfortable(g, e) {
    var c = g.cls[e];
    if (c === CLS.CYCLEWAY || c === CLS.SHARED || c === CLS.PATH || c === CLS.LOCAL) return true;
    if (c > CLS.LOCAL && c <= CLS.TRUNK) return !!(g.mflag[e] & F_LANE) || (c === CLS.TERTIARY && g.maxspeed[e] > 0 && g.maxspeed[e] <= 30);
    return false;
  }

  /* Modul legal pe segmentul e, indiferent de sens: RIDE, PUSH (vehiculul de mână, ca pieton) sau NO.
   * rules = 'bicycle' | 'scooter'; legal = false → „fără restricții” (orice segment, pe vehicul);
   * comfort = doar rețeaua confortabilă (în rest vehiculul se împinge pe trotuar). */
  function legalMode(g, e, veh, legal, comfort) {
    var c = g.cls[e], f = g.mflag[e], walkable = !(f & F_NOFOOT);
    if (c === CLS.MOTORWAY) return NO;
    if (c === CLS.STEPS) return veh.carry ? PUSH : NO;
    if (!legal) return RIDE;
    var push = walkable ? PUSH : NO;
    if (comfort && !comfortable(g, e)) return push;
    if (c === CLS.CYCLEWAY) return RIDE;
    if (veh.rules === 'bicycle') {
      if (c === CLS.SHARED || c === CLS.PATH) return RIDE;
      if (c >= CLS.LOCAL && c <= CLS.TRUNK) return RIDE;
      return push;   // trotuar, zonă pietonală, bicycle=no
    }
    // trotinetă electrică: pista pentru biciclete, altfel doar drumurile cu limita de cel mult 50 km/h
    if (c >= CLS.LOCAL && c <= CLS.TRUNK) return (f & F_LANE) || speedLimit(g, e) <= URBAN_LIMIT ? RIDE : push;
    return push;
  }

  // sensul unic pentru vehicule: 0 = ambele, 1 = doar nod mic → nod mare, 2 = doar invers
  function oneway(g, e) { return (g.mflag[e] >> OW_SHIFT) & 3; }

  // puterea (W) pe plat care dă viteza v pentru vehiculul veh
  function flatPower(veh, v) { return veh.m * G0 * veh.crr * v + 0.5 * RHO * veh.cda * v * v * v; }

  /* Setările pentru o viteză de croazieră v0 (m/s): puterea pe plat și puterea maximă la urcare.
   * Bicicleta: la urcare ciclistul poate da de climbMul ori puterea de pe plat. Pedelec: puterea ciclistului
   * (ca pe o bicicletă la riderFlat) plus motorul de 250 W. Trotinetă / Segway: motorul. */
  function powers(veh, v0) {
    var pFlat = flatPower(veh, v0), pClimb;
    if (veh.rules === 'bicycle' && veh.motor) pClimb = flatPower(VEHICLES.bike, veh.riderFlat) * veh.climbMul + veh.motor;
    else if (veh.motor) pClimb = veh.motor;
    else pClimb = pFlat * veh.climbMul;
    return { v0: v0, pFlat: pFlat, pClimb: Math.max(pFlat, pClimb) };
  }

  /* Viteza (m/s) pe panta s (urcare > 0, ca raport, ex. 0,05 = 5 %), fără îmbrăcăminte.
   * Puterea crește liniar de la puterea de pe plat (0 %) la puterea de urcare (de la 4 % în sus); la urcare viteza
   * nu depășește viteza de pe plat, la coborâre este limitată la vDown. Ecuația: P = m·g·(crr + s)·v + ½·ρ·CdA·v³. */
  function speedOnGrade(veh, pw, s) {
    s = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, s));
    var P = s > 0 ? pw.pFlat + (pw.pClimb - pw.pFlat) * Math.min(1, s / 0.04) : pw.pFlat;
    var F = veh.m * G0 * (veh.crr + s), k = 0.5 * RHO * veh.cda;
    var cap = s > 0 ? pw.v0 : Math.min(veh.vDown, veh.vCap);
    // la coborâre F poate fi negativă: f(v) = F·v + k·v³ scade întâi, apoi crește, deci taie o singură dată P
    var lo = 0, hi = 30;
    for (var i = 0; i < 50; i++) {
      var mid = (lo + hi) / 2;
      if (F * mid + k * mid * mid * mid > P) hi = mid; else lo = mid;
    }
    return Math.min(lo, cap, veh.vCap);
  }

  // factorul îmbrăcămintei (piatră cubică, neasfaltat) pentru vehicul
  function surfaceFactor(g, e, veh) {
    var f = g.mflag[e];
    if (f & F_UNPAVED) return veh.unpaved;
    if (f & F_SETT) return veh.sett;
    return 1;
  }

  /* Timpul pe vehicul (s) pe segmentul e într-un sens: urcarea climb și coborârea desc (m) sunt distribuite pe
   * segment cu aceeași pantă absolută G = (climb + desc) / L (o parte urcă, restul coboară). */
  function rideTime(veh, pw, L, climb, desc, surf) {
    var vFlat = Math.min(pw.v0, veh.vCap) * surf;
    var h = climb + desc;
    if (h < 0.5 || L <= 0) return L / vFlat;
    var G = Math.min(MAX_GRADE, h / L), Lu = L * climb / h;
    return Lu / (speedOnGrade(veh, pw, G) * surf) + (L - Lu) / (speedOnGrade(veh, pw, -G) * surf);
  }

  /* Timpii pe toate segmentele, pentru un vehicul.
   * opt = { v0 (m/s), legal (respectă regulile), comfort (doar rețeaua confortabilă; cu legal),
   *         slope (folosește panta din elev.bin, dacă există) }.
   * Întoarce { tf, tb (Float64Array, secunde; Infinity = interzis), mf, mb (Uint8Array: NO / RIDE / PUSH) }. */
  function edgeTimes(g, veh, opt) {
    var nE = g.nE, pw = powers(veh, opt.v0), slope = !!(opt.slope && g.up);
    var tf = new Float64Array(nE), tb = new Float64Array(nE), mf = new Uint8Array(nE), mb = new Uint8Array(nE);
    for (var e = 0; e < nE; e++) {
      var mode = legalMode(g, e, veh, opt.legal, opt.legal && opt.comfort), L = g.elen[e];
      var walkable = !(g.mflag[e] & F_NOFOOT) && g.cls[e] !== CLS.MOTORWAY && (veh.carry || !(g.eflag[e] & 1));
      // pe jos cu vehiculul de mână (lungimea echivalentă pe teren plat include panta și scările)
      var pf = walkable ? (slope ? g.lfw[e] : L) / WALK_PUSH : Infinity;
      var pb = walkable ? (slope ? g.lbw[e] : L) / WALK_PUSH : Infinity;
      if (g.eflag[e] & 1) { pf *= CARRY_STEPS; pb *= CARRY_STEPS; }
      if (mode === RIDE) {
        var surf = surfaceFactor(g, e, veh);
        var rf = rideTime(veh, pw, L, slope ? g.up[e] : 0, slope ? g.dn[e] : 0, surf);
        var rb = rideTime(veh, pw, L, slope ? g.dn[e] : 0, slope ? g.up[e] : 0, surf);
        var ow = opt.legal ? oneway(g, e) : 0;
        if (ow === 2) rf = Infinity;
        if (ow === 1) rb = Infinity;
        // pe o pantă foarte abruptă (sau în contrasens) e mai repede / singura opțiune să mergi pe jos
        if (rf <= pf) { tf[e] = rf; mf[e] = RIDE; } else { tf[e] = pf; mf[e] = pf < Infinity ? PUSH : NO; }
        if (rb <= pb) { tb[e] = rb; mb[e] = RIDE; } else { tb[e] = pb; mb[e] = pb < Infinity ? PUSH : NO; }
      } else if (mode === PUSH) {
        tf[e] = pf; tb[e] = pb; mf[e] = pf < Infinity ? PUSH : NO; mb[e] = pb < Infinity ? PUSH : NO;
      } else {
        tf[e] = tb[e] = Infinity;
      }
    }
    return { tf: tf, tb: tb, mf: mf, mb: mb };
  }

  /* Mersul pe jos pe aceeași rețea (referința): toate segmentele practicabile pe jos (nu pistele de biciclete
   * fără foot=yes, nu autostrăzile), cu panta după funcția lui Tobler (elev.bin) dacă slope. */
  function walkTimes(g, speed, slope) {
    var nE = g.nE, tf = new Float64Array(nE), tb = new Float64Array(nE), useSlope = !!(slope && g.lfw);
    for (var e = 0; e < nE; e++) {
      if ((g.mflag[e] & F_NOFOOT) || g.cls[e] === CLS.MOTORWAY) { tf[e] = tb[e] = Infinity; continue; }
      tf[e] = (useSlope ? g.lfw[e] : g.elen[e]) / speed;
      tb[e] = (useSlope ? g.lbw[e] : g.elen[e]) / speed;
    }
    return { tf: tf, tb: tb };
  }

  // profilul pentru Min15Core: timpii sunt deja în secunde, deci speed = 1; ultimii metri se fac pe jos
  function coreProfile(times, accessSpeed) {
    return { speed: 1, avoid: false, slope: false, maxGrade: 0, tf: times.tf, tb: times.tb, access: accessSpeed || 1.2 };
  }


  // ---------------------------------------------------------------- parcarea la destinație
  /* Pentru fiecare facilitate: există o parcare de biciclete (categoria parkCat) la cel mult radius metri, în linie
   * dreaptă? Întoarce Uint8Array (1 = da). Grilă simplă de ~radius metri, deci rapid și pentru mii de puncte. */
  function parkingNearby(pts, parkCat, radius) {
    var cell = radius / 111000, buckets = {}, out = new Uint8Array(pts.length), i;
    var key = function (x, y) { return x + ',' + y; };
    for (i = 0; i < pts.length; i++) {
      if (pts[i][2] !== parkCat) continue;
      var k = key(Math.floor(pts[i][0] / cell), Math.floor(pts[i][1] / cell));
      (buckets[k] || (buckets[k] = [])).push(pts[i]);
    }
    for (i = 0; i < pts.length; i++) {
      var p = pts[i], cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell), cosL = Math.cos(p[1] * Math.PI / 180);
      search: for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) {
        var list = buckets[key(cx + dx, cy + dy)];
        if (!list) continue;
        for (var j = 0; j < list.length; j++) {
          if (Math.hypot((list[j][0] - p[0]) * 111320 * cosL, (list[j][1] - p[1]) * 110540) <= radius) { out[i] = 1; break search; }
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- bicicletă + transport public
  /* transit.json (scripts/transit_micro15.py): stops [[lon, lat, nume]], patterns [{ r, m, h (interval, s), s [stații],
   * t [timp de la prima stație, s] }]. Stațiile se leagă de cel mai apropiat nod al rețelei. */
  function prepareTransit(tr, g, grid, nearest) {
    var node = new Int32Array(tr.stops.length), snap = new Float32Array(tr.stops.length);
    tr.stops.forEach(function (s, i) {
      var r = nearest(g, grid, s[0], s[1], 6);
      node[i] = r.node; snap[i] = r.node < 0 ? Infinity : r.dist;
    });
    return { stops: tr.stops, patterns: tr.patterns, node: node, snap: snap };
  }

  /* Park & ride: din timpii pe vehicul până la noduri (dVeh), sosirea la fiecare stație de coborâre:
   * vehicul până la stația de urcare + ultimii metri pe jos + parcare (park, s) + așteptare (jumătate din interval)
   * + călătoria, fără transbordare. Întoarce { arrive (Float64Array pe stații), lines (Set) }. */
  function transitArrivals(tp, dVeh, T, opt) {
    var park = opt.park === undefined ? 60 : opt.park, access = opt.access || 1.2;
    var arrive = new Float64Array(tp.stops.length).fill(Infinity), lines = {};
    tp.patterns.forEach(function (p) {
      var best = Infinity;   // cel mai devreme moment „echivalent” de plecare de la prima stație
      for (var k = 0; k < p.s.length; k++) {
        var st = p.s[k], n = tp.node[st];
        if (n >= 0) {
          var board = dVeh[n] + tp.snap[st] / access + park + p.h / 2;
          if (board - p.t[k] < best && board < T) best = board - p.t[k];
        }
        if (best < Infinity && k > 0) {
          var a = best + p.t[k];
          if (a < T && a < arrive[st]) { arrive[st] = a; lines[p.r] = 1; }
        }
      }
    });
    return { arrive: arrive, lines: Object.keys(lines) };
  }

  /* Sursele pentru continuarea pe jos de la stațiile de coborâre: [[nod, secunde], …] */
  function transitSources(tp, arr, T, walkSpeed) {
    var out = [];
    for (var i = 0; i < arr.arrive.length; i++) {
      if (arr.arrive[i] >= T || tp.node[i] < 0) continue;
      var t = arr.arrive[i] + tp.snap[i] / walkSpeed;
      if (t < T) out.push([tp.node[i], t]);
    }
    return out;
  }

  // ---------------------------------------------------------------- lipsurile din rețea
  // Dijkstra cu muchia de sosire în fiecare nod (pentru reconstruirea drumului); timpii din tf / tb.
  function dijkstraPred(g, sources, tf, tb, T, ws) {
    var nN = g.nN;
    if (!ws || ws.n !== nN) ws = { n: nN, dist: new Float64Array(nN), pred: new Int32Array(nN), touched: [], ht: [], hn: [] };
    var dist = ws.dist, pred = ws.pred, ht = ws.ht, hn = ws.hn, i;
    for (i = 0; i < ws.touched.length; i++) { dist[ws.touched[i]] = Infinity; pred[ws.touched[i]] = -1; }
    if (!ws.init) { dist.fill(Infinity); pred.fill(-1); ws.init = true; }
    ws.touched.length = 0; ht.length = 0; hn.length = 0;
    function push(t, n) {
      var k = ht.length; ht.push(t); hn.push(n);
      while (k > 0) { var q = (k - 1) >> 1; if (ht[q] <= t) break; ht[k] = ht[q]; hn[k] = hn[q]; k = q; }
      ht[k] = t; hn[k] = n;
    }
    function pop() {
      var lt = ht.pop(), ln = hn.pop(), L = ht.length;
      if (!L) return;
      var k = 0;
      for (;;) {
        var c = 2 * k + 1; if (c >= L) break;
        if (c + 1 < L && ht[c + 1] < ht[c]) c++;
        if (ht[c] >= lt) break;
        ht[k] = ht[c]; hn[k] = hn[c]; k = c;
      }
      ht[k] = lt; hn[k] = ln;
    }
    sources.forEach(function (s) { if (s[1] < dist[s[0]]) { if (dist[s[0]] === Infinity) ws.touched.push(s[0]); dist[s[0]] = s[1]; push(s[1], s[0]); } });
    while (ht.length) {
      var t = ht[0], n = hn[0]; pop();
      if (t > dist[n] || t > T) { if (t > T) break; continue; }
      for (var k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) {
        var e = g.adjEdge[k], fwd = g.eu[e] === n, m = fwd ? g.ev[e] : g.eu[e];
        var nt = t + (fwd ? tf[e] : tb[e]);
        if (nt < dist[m]) { if (dist[m] === Infinity) ws.touched.push(m); dist[m] = nt; pred[m] = e; push(nt, m); }
      }
    }
    return ws;
  }

  /* Lipsurile: din fiecare punct de pornire, drumurile cele mai rapide „fără restricții” până la facilitățile
   * atinse în T; fiecare segment parcurs pe un astfel de drum, în sensul în care regulile (sau rețeaua confortabilă)
   * nu permit circulația pe vehicul, primește un punct pentru fiecare facilitate. Un scor mare = o pistă / un
   * contrasens / o bandă acolo ar scurta multe deplasări. Întoarce Float64Array pe muchii (puncte / origine).
   * free = edgeTimes(..., legal: false), rules = edgeTimes(...) cu regulile alese (doar mf / mb contează). */
  function gapScores(g, free, rules, origins, pois, T, opt) {
    var score = new Float64Array(g.nE), ws = null, cats = (opt && opt.cats) || [0, 1, 2, 3, 4], access = (opt && opt.access) || 1.2;
    var want = {}; cats.forEach(function (c) { want[c] = 1; });
    origins.forEach(function (o) {
      ws = dijkstraPred(g, [[o[0], o[1] / access]], free.tf, free.tb, T, ws);
      for (var i = 0; i < pois.pts.length; i++) {
        if (!want[pois.pts[i][2]]) continue;
        var n = pois.snap.node[i];
        if (n < 0 || ws.dist[n] + pois.snap.snap[i] / access > T) continue;
        var guard = 0;
        while (ws.pred[n] >= 0 && guard++ < 100000) {
          var e = ws.pred[n], fwd = g.ev[e] === n;   // muchia parcursă de la eu la ev
          if ((fwd ? rules.mf[e] : rules.mb[e]) !== RIDE) score[e] += 1;
          n = fwd ? g.eu[e] : g.ev[e];
        }
      }
    });
    if (origins.length) for (var e = 0; e < g.nE; e++) score[e] /= origins.length;
    return score;
  }

  return {
    CLS: CLS, F_LANE: F_LANE, F_NOFOOT: F_NOFOOT, F_SETT: F_SETT, F_UNPAVED: F_UNPAVED, NO: NO, RIDE: RIDE, PUSH: PUSH,
    URBAN_LIMIT: URBAN_LIMIT, VEHICLES: VEHICLES, ORDER: ORDER, WALK_PUSH: WALK_PUSH,
    parseMicro: parseMicro, speedLimit: speedLimit, comfortable: comfortable, legalMode: legalMode,
    parkingNearby: parkingNearby, prepareTransit: prepareTransit, transitArrivals: transitArrivals, transitSources: transitSources,
    dijkstraPred: dijkstraPred, gapScores: gapScores, oneway: oneway, powers: powers,
    speedOnGrade: speedOnGrade, rideTime: rideTime, edgeTimes: edgeTimes, walkTimes: walkTimes, coreProfile: coreProfile
  };
});
