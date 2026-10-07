/*
 * Min15Core – calculul accesibilității pietonale („15 minute. Pentru cine?”), fără dependențe de browser.
 *
 * Adaptat după https://github.com/martincantcode/15-minutes (© 2026 Martin Bangratz, licență MIT):
 * citirea rețelei binare, căutarea celui mai apropiat nod, Dijkstra pe timp de mers și desenarea porțiunilor
 * atinse. Adăugat pentru studiul Iași: spațiu de lucru reutilizabil (multe căutări la rând), numărarea
 * facilităților, point-in-polygon pentru zonele MVA–MVI și analiza pe zone (puncte pe grilă regulată).
 *
 * Încărcat în browser (window.Min15Core) și în Node (require) – aceleași rezultate în pagină și în scripturi.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Min15Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R_LAT = 110540, R_LON = 111320;   // metri pe grad (echirectangular, suficient la scara orașului)
  var STATION = 6, BENCH = 5, AMENITY_CATS = [0, 1, 2, 3, 4];
  var MODES = { 1: 'tren', 2: 'tramvai', 3: 'autobuz' };
  var REF = { speed: 1.4, avoid: false };   // profilul de referință: 1,4 m/s, scări permise

  // ---------------------------------------------------------------- rețeaua
  function buildAdjacency(nN, nE, eu, ev) {
    var deg = new Uint32Array(nN + 1), e, i;
    for (e = 0; e < nE; e++) { deg[eu[e]]++; deg[ev[e]]++; }
    var adjStart = new Uint32Array(nN + 1);
    for (i = 0; i < nN; i++) adjStart[i + 1] = adjStart[i] + deg[i];
    var fill = adjStart.slice(0, nN), adjEdge = new Uint32Array(2 * nE);
    for (e = 0; e < nE; e++) { adjEdge[fill[eu[e]]++] = e; adjEdge[fill[ev[e]]++] = e; }
    return { adjStart: adjStart, adjEdge: adjEdge };
  }

  function merc(lon, lat) {
    return [lon / 360 + 0.5, 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)];
  }

  // graph.bin, versiunea 1 (formatul este descris în scripts/export_15min.py)
  function parseGraph(buf) {
    var h = new Uint32Array(buf, 0, 4);
    if (h[0] !== 1) throw new Error('Versiune necunoscută a fișierului de rețea');
    var nN = h[1], nE = h[2], nS = h[3], off = 16, i, e, m;
    var ll = new Int32Array(buf, off, 2 * nN); off += 8 * nN;
    var eu = new Uint32Array(buf, off, nE); off += 4 * nE;
    var ev = new Uint32Array(buf, off, nE); off += 4 * nE;
    var elf = new Uint32Array(buf, off, nE); off += 4 * nE;
    var sst = new Uint32Array(buf, off, nE + 1); off += 4 * (nE + 1);
    var sp = new Int32Array(buf, off, 2 * nS);
    var lon = new Float64Array(nN), lat = new Float64Array(nN), mx = new Float64Array(nN), my = new Float64Array(nN);
    for (i = 0; i < nN; i++) {
      lon[i] = ll[2 * i] / 1e5; lat[i] = ll[2 * i + 1] / 1e5;
      m = merc(lon[i], lat[i]); mx[i] = m[0]; my[i] = m[1];
    }
    var smx = new Float64Array(nS), smy = new Float64Array(nS);
    for (i = 0; i < nS; i++) { m = merc(sp[2 * i] / 1e5, sp[2 * i + 1] / 1e5); smx[i] = m[0]; smy[i] = m[1]; }
    var elen = new Float32Array(nE), eflag = new Uint8Array(nE);
    for (e = 0; e < nE; e++) { elen[e] = (elf[e] >>> 2) / 10; eflag[e] = elf[e] & 3; }
    var adj = buildAdjacency(nN, nE, eu, ev);
    return { nN: nN, nE: nE, lon: lon, lat: lat, mx: mx, my: my, eu: eu, ev: ev, elen: elen, eflag: eflag,
      sst: sst, smx: smx, smy: smy, adjStart: adj.adjStart, adjEdge: adj.adjEdge };
  }

  function buildGrid(g) {
    var cellLat = 0.001, cellLon = 0.0015, i;
    var minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (i = 0; i < g.nN; i++) {
      if (g.lon[i] < minLon) minLon = g.lon[i]; if (g.lon[i] > maxLon) maxLon = g.lon[i];
      if (g.lat[i] < minLat) minLat = g.lat[i]; if (g.lat[i] > maxLat) maxLat = g.lat[i];
    }
    var W = Math.floor((maxLon - minLon) / cellLon) + 1, H = Math.floor((maxLat - minLat) / cellLat) + 1;
    var head = new Int32Array(W * H).fill(-1), next = new Int32Array(g.nN);
    for (i = 0; i < g.nN; i++) {
      var c = Math.floor((g.lat[i] - minLat) / cellLat) * W + Math.floor((g.lon[i] - minLon) / cellLon);
      next[i] = head[c]; head[c] = i;
    }
    return { minLon: minLon, minLat: minLat, cellLon: cellLon, cellLat: cellLat, W: W, H: H, head: head, next: next };
  }

  // cel mai apropiat nod de un punct; { node: -1 } dacă nu există niciunul în aproximativ maxRing celule
  function nearestNode(g, grid, lon, lat, maxRing) {
    if (maxRing === undefined) maxRing = 8;
    var cx = Math.floor((lon - grid.minLon) / grid.cellLon), cy = Math.floor((lat - grid.minLat) / grid.cellLat);
    var cosL = Math.cos(lat * Math.PI / 180);
    var minCell = Math.min(grid.cellLat * R_LAT, grid.cellLon * cosL * R_LON);
    var best = -1, bestD = Infinity;
    for (var r = 0; r <= maxRing; r++) {
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        var x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= grid.W || y >= grid.H) continue;
        for (var i = grid.head[y * grid.W + x]; i !== -1; i = grid.next[i]) {
          var d = Math.hypot((g.lon[i] - lon) * cosL * R_LON, (g.lat[i] - lat) * R_LAT);
          if (d < bestD || (d === bestD && i < best)) { bestD = d; best = i; }
        }
      }
      if (best !== -1 && bestD <= r * minCell) break;
    }
    return { node: best, dist: bestD };
  }

  // ---------------------------------------------------------------- căutarea
  // Spațiu de lucru reutilizabil: după fiecare căutare se resetează doar nodurile atinse,
  // astfel încât sute de căutări la rând (analiza pe zone) nu realocă tablouri de mărimea rețelei.
  function workspace(g) {
    return { dist: new Float64Array(g.nN).fill(Infinity), touched: new Uint32Array(g.nN), nt: 0, ht: [], hn: [] };
  }

  // Dijkstra pe timp de mers; se oprește la T secunde. Viteza în m/s. Întoarce secundele pe nod (Infinity = neatins).
  function dijkstra(g, src, startSeconds, speed, avoidSteps, T, ws) {
    ws = ws || workspace(g);
    var dist = ws.dist, touched = ws.touched, ht = ws.ht, hn = ws.hn, i;
    for (i = 0; i < ws.nt; i++) dist[touched[i]] = Infinity;
    ws.nt = 0; ht.length = 0; hn.length = 0;
    function push(t, n) {
      var k = ht.length; ht.push(t); hn.push(n);
      while (k > 0) { var p = (k - 1) >> 1; if (ht[p] <= t) break; ht[k] = ht[p]; hn[k] = hn[p]; k = p; }
      ht[k] = t; hn[k] = n;
    }
    function pop() {
      var lt = ht.pop(), ln = hn.pop(), L = ht.length;
      if (L === 0) return;
      var k = 0;
      for (;;) {
        var c = 2 * k + 1; if (c >= L) break;
        if (c + 1 < L && ht[c + 1] < ht[c]) c++;
        if (ht[c] >= lt) break;
        ht[k] = ht[c]; hn[k] = hn[c]; k = c;
      }
      ht[k] = lt; hn[k] = ln;
    }
    function set(n, t) { if (dist[n] === Infinity) touched[ws.nt++] = n; dist[n] = t; }
    set(src, startSeconds); push(startSeconds, src);
    while (ht.length) {
      var t = ht[0], n = hn[0]; pop();
      if (t > dist[n]) continue;
      if (t > T) break;
      for (var k = g.adjStart[n]; k < g.adjStart[n + 1]; k++) {
        var e = g.adjEdge[k];
        if (avoidSteps && (g.eflag[e] & 1)) continue;
        var m = g.eu[e] === n ? g.ev[e] : g.eu[e];
        var nt = t + g.elen[e] / speed;
        if (nt < dist[m]) { set(m, nt); push(nt, m); }
      }
    }
    return dist;
  }

  // muchiile atinse măcar parțial: { e, fromLow, frac (cât din muchie), tt (0..1 timp de mers) }
  function collectReach(g, dist, T, speed, avoidSteps) {
    var items = [], lengthM = 0;
    for (var e = 0; e < g.nE; e++) {
      if (avoidSteps && (g.eflag[e] & 1)) continue;
      var du = dist[g.eu[e]], dv = dist[g.ev[e]];
      var fromLow = du <= dv, a = fromLow ? du : dv, b = fromLow ? dv : du;
      if (a > T) continue;
      var frac = 1, tt;
      if (b <= T) tt = b / T;
      else { frac = Math.min(1, (T - a) / (g.elen[e] / speed)); tt = 1; }
      items.push({ e: e, fromLow: fromLow, frac: frac, tt: tt });
      lengthM += g.elen[e] * frac;
    }
    return { items: items, lengthM: lengthM };
  }

  // muchia ca drum [x0, y0, x1, y1, …] în unități Mercator, de la nodul mic la cel mare (sau invers)
  function edgePath(g, e, reverse) {
    var u = g.eu[e], v = g.ev[e], pts = [g.mx[u], g.my[u]], s;
    for (s = g.sst[e]; s < g.sst[e + 1]; s++) pts.push(g.smx[s], g.smy[s]);
    pts.push(g.mx[v], g.my[v]);
    if (!reverse) return pts;
    var out = [];
    for (var i = pts.length - 2; i >= 0; i -= 2) out.push(pts[i], pts[i + 1]);
    return out;
  }

  // primii `frac` (0..1) din lungimea unui drum
  function cutPath(pts, frac) {
    if (frac >= 1) return pts;
    var total = 0, i;
    for (i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    var left = frac * total, out = [pts[0], pts[1]];
    for (i = 2; i < pts.length; i += 2) {
      var seg = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      if (seg >= left) {
        var f = seg > 0 ? left / seg : 0;
        out.push(pts[i - 2] + (pts[i] - pts[i - 2]) * f, pts[i - 1] + (pts[i + 1] - pts[i - 1]) * f);
        return out;
      }
      left -= seg; out.push(pts[i], pts[i + 1]);
    }
    return out;
  }

  // ---------------------------------------------------------------- facilitățile
  // fiecare facilitate: cel mai apropiat nod și distanța în linie dreaptă până la el
  function snapPois(g, grid, pts) {
    var node = new Int32Array(pts.length), snap = new Float32Array(pts.length);
    for (var i = 0; i < pts.length; i++) {
      var r = nearestNode(g, grid, pts[i][0], pts[i][1], 6);
      node[i] = r.node; snap[i] = r.node < 0 ? Infinity : r.dist;
    }
    return { node: node, snap: snap };
  }

  // O stație este „utilizabilă” fără scări doar dacă OSM o marchează wheelchair=yes (cod 1).
  function stationUsable(p, avoid) { return !avoid || p[3] === 1; }

  /* Numără facilitățile atinse dintr-o căutare.
   * Întoarce { cats[7], amen (suma celor 5 categorii), present (câte din cele 5 categorii există),
   *            stUsable, stByWc[4], stByMode{1,2,3}, inside (Uint8Array, opțional) }. */
  function countReach(pois, dist, speed, T, avoid, wantInside) {
    var pts = pois.pts, n = pts.length, cats = new Array(pois.cats.length).fill(0);
    var stByWc = [0, 0, 0, 0], stByMode = { 1: 0, 2: 0, 3: 0 }, stUsable = 0;
    var inside = wantInside ? new Uint8Array(n) : null;
    for (var i = 0; i < n; i++) {
      var node = pois.snap.node[i];
      if (node < 0) continue;
      if (dist[node] + pois.snap.snap[i] / speed > T) continue;
      var p = pts[i], c = p[2];
      cats[c]++;
      if (inside) inside[i] = 1;
      if (c === STATION) {
        stByWc[p[3]]++;
        if (p[4]) stByMode[p[4]]++;
        if (stationUsable(p, avoid)) stUsable++;
      }
    }
    var amen = 0, present = 0;
    AMENITY_CATS.forEach(function (c) { amen += cats[c]; if (cats[c] > 0) present++; });
    return { cats: cats, amen: amen, present: present, stUsable: stUsable, stByWc: stByWc, stByMode: stByMode, inside: inside };
  }

  /* O evaluare completă dintr-un punct: punct → nod → Dijkstra → numărare.
   * ctx = { g, grid, pois, ws }. Întoarce null dacă nu există rețea la cel mult maxSnap metri. */
  function evaluatePoint(ctx, lon, lat, profile, T, maxSnap) {
    var snap = nearestNode(ctx.g, ctx.grid, lon, lat, 8);
    if (snap.node < 0 || snap.dist > (maxSnap || 500)) return null;
    var dist = dijkstra(ctx.g, snap.node, snap.dist / profile.speed, profile.speed, profile.avoid, T, ctx.ws);
    var r = countReach(ctx.pois, dist, profile.speed, T, profile.avoid, false);
    r.snapDist = snap.dist;
    return r;
  }

  // ---------------------------------------------------------------- zonele
  function ringContains(ring, x, y) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function polygonsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') return [geometry.coordinates];
    if (geometry.type === 'MultiPolygon') return geometry.coordinates;
    return [];
  }
  function pointInGeometry(geometry, lon, lat) {
    return polygonsOf(geometry).some(function (poly) {
      if (!ringContains(poly[0], lon, lat)) return false;
      for (var h = 1; h < poly.length; h++) if (ringContains(poly[h], lon, lat)) return false;
      return true;
    });
  }
  function geometryBbox(geometry) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    polygonsOf(geometry).forEach(function (poly) {
      poly[0].forEach(function (c) {
        if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
      });
    });
    return b;
  }

  // Puncte pe o grilă regulată (spacingM metri) în interiorul geometriei; grila este ancorată în (0,0)
  // a fiecărei zone, deci rezultatele sunt reproductibile.
  function gridPoints(geometry, spacingM) {
    var b = geometryBbox(geometry), out = [];
    if (!isFinite(b[0])) return out;
    var midLat = (b[1] + b[3]) / 2;
    var dLat = spacingM / R_LAT, dLon = spacingM / (R_LON * Math.cos(midLat * Math.PI / 180));
    for (var lat = b[1] + dLat / 2; lat < b[3]; lat += dLat) {
      for (var lon = b[0] + dLon / 2; lon < b[2]; lon += dLon) {
        if (pointInGeometry(geometry, lon, lat)) out.push([lon, lat]);
      }
    }
    return out;
  }

  // reducere uniformă la cel mult max puncte (păstrează acoperirea spațială a grilei)
  function thin(points, max) {
    if (!max || points.length <= max) return points;
    var out = [], step = points.length / max;
    for (var i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
    return out;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /* Analiza unei zone: pentru fiecare punct al grilei (legat de rețea la cel mult opts.maxSnap metri),
   * facilitățile atinse în T minute cu profilul ales și cu profilul de referință (1,4 m/s, cu scări).
   * opts = { minutes, profile:{speed, avoid}, spacing (m), maxPoints, maxSnap (m) } */
  function analyzeZone(ctx, feature, opts) {
    var T = opts.minutes * 60, prof = opts.profile;
    var all = gridPoints(feature.geometry, opts.spacing || 400);
    var pts = thin(all, opts.maxPoints || 80);
    var amenP = [], amenR = [], full = 0, fullR = 0, stP = 0, stR = 0, used = 0, skipped = 0, catsP = [0, 0, 0, 0, 0];
    for (var i = 0; i < pts.length; i++) {
      var rp = evaluatePoint(ctx, pts[i][0], pts[i][1], prof, T, opts.maxSnap || 150);
      if (!rp) { skipped++; continue; }
      var rr = (prof.speed === REF.speed && !prof.avoid) ? rp : evaluatePoint(ctx, pts[i][0], pts[i][1], REF, T, opts.maxSnap || 150);
      used++;
      amenP.push(rp.amen); amenR.push(rr.amen);
      if (rp.present === 5) full++;
      if (rr.present === 5) fullR++;
      stP += rp.stUsable; stR += rr.stUsable;
      AMENITY_CATS.forEach(function (c) { if (rp.cats[c] > 0) catsP[c]++; });
    }
    var sum = function (a) { return a.reduce(function (s, v) { return s + v; }, 0); };
    var mP = used ? sum(amenP) / used : null, mR = used ? sum(amenR) / used : null;
    var sortedP = amenP.slice().sort(function (a, b) { return a - b; });
    var p = feature.properties || {};
    return {
      zone_id: p.zone_id || p.id || '', zone_name: p.zone_name || p.name || p.denumire || '',
      points: used, skipped: skipped, grid_points: all.length,
      amen_mean: mP, amen_mean_ref: mR, amen_median: quantile(sortedP, 0.5), amen_p25: quantile(sortedP, 0.25),
      loss_pct: mR ? (1 - mP / mR) * 100 : null,
      full_share: used ? full / used * 100 : null, full_share_ref: used ? fullR / used * 100 : null,
      stations_mean: used ? stP / used : null, stations_mean_ref: used ? stR / used : null,
      cat_share: catsP.map(function (c) { return used ? c / used * 100 : null; })
    };
  }

  var CSV_COLUMNS = [
    ['zone_id', 'zona_id'], ['zone_name', 'zona'], ['points', 'puncte_analizate'], ['skipped', 'puncte_fara_retea'],
    ['amen_mean', 'facilitati_medie_profil'], ['amen_mean_ref', 'facilitati_medie_referinta'],
    ['amen_median', 'facilitati_mediana_profil'], ['amen_p25', 'facilitati_p25_profil'], ['loss_pct', 'pierdere_pct'],
    ['full_share', 'puncte_cu_toate_5_categorii_pct'], ['full_share_ref', 'puncte_cu_toate_5_categorii_ref_pct'],
    ['stations_mean', 'statii_medie_profil'], ['stations_mean_ref', 'statii_medie_referinta']
  ];
  function zonesCsv(rows, cats) {
    var head = CSV_COLUMNS.map(function (c) { return c[1]; })
      .concat(AMENITY_CATS.map(function (c) { return 'acces_' + slug(cats[c]) + '_pct'; }));
    var esc = function (v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return (Math.round(v * 10) / 10).toString();
      var s = String(v); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [head.join(',')];
    rows.forEach(function (r) {
      lines.push(CSV_COLUMNS.map(function (c) { return esc(r[c[0]]); }).concat(r.cat_share.map(esc)).join(','));
    });
    return lines.join('\n') + '\n';
  }
  function slug(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  return {
    R_LAT: R_LAT, R_LON: R_LON, STATION: STATION, BENCH: BENCH, AMENITY_CATS: AMENITY_CATS, MODES: MODES, REF: REF,
    merc: merc, parseGraph: parseGraph, buildAdjacency: buildAdjacency, buildGrid: buildGrid, nearestNode: nearestNode,
    workspace: workspace, dijkstra: dijkstra, collectReach: collectReach, edgePath: edgePath, cutPath: cutPath,
    snapPois: snapPois, stationUsable: stationUsable, countReach: countReach, evaluatePoint: evaluatePoint,
    pointInGeometry: pointInGeometry, geometryBbox: geometryBbox, gridPoints: gridPoints, thin: thin,
    quantile: quantile, analyzeZone: analyzeZone, zonesCsv: zonesCsv
  };
});
