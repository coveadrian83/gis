/* „15 minute pe două roți” – Iași. Interfața: harta, comenzile, statisticile și analiza pe zone.
 * Regulile și vitezele sunt în micro.js (MicroCore), căutarea și numărarea în ../15min/core.js (Min15Core).
 * Construită pe harta pietonală, adaptare după https://github.com/martincantcode/15-minutes (licență MIT). */
(function () {
  'use strict';
  var C = window.Min15Core, M = window.MicroCore;
  var DATA_DIR = 'data/iasi/';
  var ZONES_URL = '../data/iasi_17_zone_mva_mvi.geojson';
  var WALK = 1.4;   // m/s, referința pe jos
  var CAT_COLORS = ['#5b9a3c', '#d9534f', '#7b5ea7', '#2e8b57', '#e8a13a', '#0f6e8c', '#15171a', '#d6336c'];
  var PARK = 5, STATION = C.STATION, RENTAL = 7;
  var PALETTE = ['#0b4f6c', '#1f9e9a', '#9bc53d', '#f2c14e', '#e8743b'];
  var INFRA = { cycleway: '#1a9850', lane: '#91cf60', fast: '#d73027', foot: '#9e9e9e' };

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('status');
  var fmt = function (v, d) { return v === null || v === undefined || !isFinite(v) ? '–' : v.toLocaleString('ro-RO', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var kmh = function (ms) { return fmt(ms * 3.6, 0) + ' km/h'; };
  function esc(s) { return String(s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------------------------------------------------------- harta
  var map = L.map('map', { zoomControl: true, maxZoom: 19 }).setView([47.16485, 27.58186], 13);
  map.createPane('zones').style.zIndex = 350;
  var baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contribuitorii OpenStreetMap</a>'
  }).addTo(map);
  var streetBase = false, tileErrors = 0;
  baseLayer.on('tileerror', function () { if (++tileErrors >= 8) useStreetBase(); });
  function useStreetBase() {
    if (streetBase) return;
    streetBase = true;
    map.removeLayer(baseLayer);
    map.attributionControl.addAttribution('&copy; contribuitorii OpenStreetMap');
    $('baseNote').textContent = 'Harta de fundal nu este disponibilă, așa că este afișată rețeaua de străzi.';
    draw();
  }
  var canvas = document.createElement('canvas');
  canvas.className = 'leaflet-zoom-hide';
  canvas.style.cssText = 'position:absolute;pointer-events:none';
  map.getPanes().overlayPane.appendChild(canvas);

  var G = null, grid = null, POIS_ALL = null, POIS_PARK = null, PARKFLAG = null, TRANSIT = null, EDGE_NAMES = null;
  var PARK_RADIUS = 100, PARK_AND_RIDE = 60;   // m; s pentru legarea vehiculului la stație
  var wsA = null, wsB = null, wsC = null, wsD = null, GAPS = null, SURVEY = null, SURVEY_EDGE = null;
  // clasele stratului „străzi din chestionar” (respondenți care au numit strada), ca în harta Masterplanului
  var MODE_RISK = { 3: 2, 4: 3 };
  var MODE_LABEL = { 2: 'rețeaua confortabilă', 3: 'rețeaua sigură (risc 1–2)', 4: 'risc cel mult 3' };
  var RISK_COLORS = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'];
  var ACC = null, ACC_EDGE = null;
  var SURVEY_CLASSES = [[1, '#b2182b', 1], [11, '#f46d43', 2], [31, '#fdae61', 3], [61, '#e6e600', 3.5], [121, '#a6d96a', 4.5], [251, '#4d9221', 6]];
  var ZONES = null, zoneLayer = null, zoneResults = null, zoneRunning = false;
  var origin = L.latLng(47.16485, 27.58186), state = null, queued = false;
  var marker = L.marker(origin, { draggable: true }).addTo(map);
  var vehicle = 'bike', timesCache = {};

  // ---------------------------------------------------------------- culori
  function mix(c1, c2, f) {
    var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
    var ch = function (s) { return (a >> s & 255) + ((b >> s & 255) - (a >> s & 255)) * f; };
    return 'rgb(' + (ch(16) | 0) + ',' + (ch(8) | 0) + ',' + (ch(0) | 0) + ')';
  }
  function colorAt(t, pal) {
    pal = pal || PALETTE;
    var x = Math.min(0.9999, Math.max(0, t)) * (pal.length - 1), i = Math.floor(x);
    return mix(pal[i], pal[i + 1], x - i);
  }
  var NB = 12, BIN_COLORS = [];
  for (var bi = 0; bi < NB; bi++) BIN_COLORS.push(colorAt((bi + 0.5) / NB));
  var grad = []; for (var gi = 0; gi <= 10; gi++) grad.push(colorAt(gi / 10));
  $('legend').style.background = 'linear-gradient(to right, ' + grad.join(',') + ')';

  // ---------------------------------------------------------------- vehiculele
  $('vehicles').innerHTML = M.ORDER.map(function (k) {
    var v = M.VEHICLES[k];
    return '<button type="button" data-v="' + k + '">' + esc(v.name) + '<small>' + kmh(v.v0) + ' · max ' + kmh(v.vCap) + '</small></button>';
  }).join('');
  function veh() { return M.VEHICLES[vehicle]; }
  function setVehicle(k, keepSpeed) {
    if (!M.VEHICLES[k]) return;
    vehicle = k;
    var v = veh(), s = $('speed');
    s.min = Math.round(v.vMin * 3.6); s.max = Math.round(v.vMax * 3.6);
    if (!keepSpeed) s.value = Math.round(v.v0 * 3.6);
    else s.value = Math.max(+s.min, Math.min(+s.max, +s.value));
  }

  function hasSlope() { return !!(G && G.up); }
  function settings() {
    return { T: $('minutes').value * 60, minutes: +$('minutes').value, v0: $('speed').value / 3.6,
      legal: $('legal').checked, comfort: $('legal').checked && $('network').value === '2', slope: hasSlope() && $('slope').checked,
      transit: !!TRANSIT && $('transit').checked, onlyPark: $('onlyPark').checked, vehicle: vehicle,
      mode: !$('legal').checked ? 0 : (G && G.risk ? +$('network').value : Math.min(2, +$('network').value)) };
  }
  // facilitățile numărate: toate sau doar cele cu parcare de biciclete în apropiere
  function activePois() { return $('onlyPark').checked && POIS_PARK ? POIS_PARK : POIS_ALL; }
  // un set de facilități pentru Min15Core (cu coordonatele Mercator pentru desen); keep(p, i) filtrează
  function poisView(cats, pts, snap, keep) {
    var idx = [];
    pts.forEach(function (p, i) { if (!keep || keep(p, i)) idx.push(i); });
    var v = { cats: cats, pts: idx.map(function (i) { return pts[i]; }), snap: { node: new Int32Array(idx.length), snap: new Float32Array(idx.length) },
      mx: new Float64Array(idx.length), my: new Float64Array(idx.length) };
    idx.forEach(function (i, k) {
      v.snap.node[k] = snap.node[i]; v.snap.snap[k] = snap.snap[i];
      var m = C.merc(pts[i][0], pts[i][1]); v.mx[k] = m[0]; v.my[k] = m[1];
    });
    return v;
  }
  /* timpii pe segmente pentru un vehicul (păstrați până se schimbă setările);
   * mode: 0 = fără restricții, 1 = după Codul rutier, 2 = doar rețeaua confortabilă, 3 / 4 = doar segmentele cu
   * risc cel mult 2 / 3 (MODE_RISK) */
  function times(k, v0, mode, slope) {
    var key = k + '|' + v0.toFixed(4) + '|' + mode + '|' + (slope ? 1 : 0);
    if (!timesCache[key]) {
      if (Object.keys(timesCache).length > 24) timesCache = {};
      timesCache[key] = k === 'walk' ? M.walkTimes(G, WALK, slope)
        : M.edgeTimes(G, M.VEHICLES[k], { v0: v0, legal: mode > 0, comfort: mode === 2, maxRisk: MODE_RISK[mode] || 0, slope: slope });
    }
    return timesCache[key];
  }
  function profileFor(k, v0, mode, slope) { return M.coreProfile(times(k, v0, mode, slope), 1.2); }
  function describe(s) {
    return veh().name + ', ' + fmt(s.v0 * 3.6) + ' km/h' + (MODE_LABEL[s.mode] ? ', ' + MODE_LABEL[s.mode] : s.legal ? ', după Codul rutier' : ', fără restricții') +
      (s.slope ? ', cu pantă' : ', teren plat') + (s.onlyPark ? ', doar facilitățile cu parcare' : '');
  }
  function labels() {
    var s = settings(), v = veh();
    $('minOut').textContent = s.minutes;
    $('legendEnd').textContent = s.minutes + ' min';
    $('spdOut').textContent = fmt(s.v0 * 3.6) + ' km/h (' + fmt(s.v0, 1) + ' m/s)';
    $('spdNote').textContent = v.rules === 'scooter'
      ? 'Viteza maximă constructivă: ' + kmh(v.vCap) + '. Urcările încetinesc după puterea motorului (' + v.motor + ' W).'
      : (v.motor ? 'Asistența de 250 W se oprește la 25 km/h; urcările sunt mai ușoare decât pe bicicleta clasică.' : 'La urcare, viteza scade după puterea ciclistului; la coborâre, maximum ' + kmh(v.vDown) + '.');
    $('ruleNote').textContent = !s.legal ? 'Fără restricții: oriunde se poate merge, pe vehicul, în ambele sensuri (comparație, nu recomandare).'
      : v.rules === 'scooter' ? 'Trotineta: pe piste; fără pistă, doar pe străzile cu limita ≤ 50 km/h; nu pe trotuar – acolo se împinge.'
      : 'Bicicleta: pe piste și pe carosabil, în sensul de circulație; pe trotuare și în zonele pietonale se împinge.';
    Array.prototype.forEach.call(document.querySelectorAll('#vehicles button'), function (b) { b.classList.toggle('on', b.dataset.v === vehicle); });
  }
  function schedule() {
    labels();
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; compute(); });
  }

  // ---------------------------------------------------------------- calcul pentru punctul ales
  function compute() {
    if (!G) return;
    var s = settings(), T = s.T;
    writeHash();
    showZoneHere();
    var snap = C.nearestNode(G, grid, origin.lng, origin.lat, 8);
    if (snap.node < 0 || snap.dist > 500) {
      state = null; $('stats').innerHTML = ''; $('compare').innerHTML = '';
      statusEl.className = 'err'; statusEl.textContent = 'Nu există străzi la mai puțin de 500 m de acest punct. Alegeți un loc în interiorul zonei acoperite.';
      draw(); return;
    }
    statusEl.className = ''; statusEl.textContent = '';
    var P = activePois();
    var tm = times(vehicle, s.v0, s.mode, s.slope);
    var pA = profileFor(vehicle, s.v0, s.mode, s.slope), pF = profileFor(vehicle, s.v0, 0, s.slope), pW = profileFor('walk', WALK, 0, s.slope);
    var start = snap.dist / pA.access;
    var dA = C.dijkstra(G, snap.node, start, pA, T, wsA), dF = C.dijkstra(G, snap.node, start, pF, T, wsB);
    var rA = C.collectReach(G, dA, T, pA), rF = C.collectReach(G, dF, T, pF);
    var cA = C.countReach(P, dA, pA, T, true), cF = C.countReach(P, dF, pF, T, false);
    var dW = C.dijkstra(G, snap.node, start, pW, T, wsC), cW = C.countReach(P, dW, pW, T, false), rW = C.collectReach(G, dW, T, pW);
    // bicicletă + transport public: pe vehicul până la stație, parcare, așteptare, călătorie, apoi pe jos
    var tp = null;
    if (s.transit) {
      var arr = M.transitArrivals(TRANSIT, dA, T, { park: PARK_AND_RIDE, access: pA.access });
      var dT = C.dijkstraMulti(G, M.transitSources(TRANSIT, arr, T, WALK), pW, T, wsD).slice();
      var dC = new Float64Array(G.nN);
      for (var n = 0; n < G.nN; n++) dC[n] = Math.min(dA[n], dT[n]);
      var cC = C.countReach(P, dC, pA, T, true);
      tp = { arr: arr, reach: C.collectReach(G, dT, T, pW), count: cC };
      cA = cC;   // facilitățile de pe hartă: cu sau fără transportul public
    }
    state = { T: T, reachA: rA, reachF: rF, inA: cA.inside, dA: dA, tm: tm, legal: s.legal, pois: P, tp: tp };
    showStats(s, rA, rF, rW, cA, cF, cW, snap);
    showCompare(snap, T, s);
    draw();
  }

  function pushShare(reach, tm) {
    var ride = 0, push = 0;
    reach.items.forEach(function (it) {
      var m = it.fromLow ? tm.mf[it.e] : tm.mb[it.e], L = G.elen[it.e] * it.frac;
      if (m === M.PUSH) push += L; else ride += L;
    });
    return ride + push > 0 ? push / (ride + push) * 100 : 0;
  }

  function showStats(s, rA, rF, rW, cA, cF, cW, snap) {
    var km = function (m) { return fmt(m / 1000, 1); };
    var P = state.pois;
    var rows = C.AMENITY_CATS.map(function (c) {
      return '<tr><td><span class="dot" style="background:' + CAT_COLORS[c] + '"></span>' + P.cats[c] + '</td><td>' + cA.cats[c] + '</td><td>' + cF.cats[c] + '</td><td>' + cW.cats[c] + '</td></tr>';
    }).join('');
    var extra = [[PARK, 'Parcări pentru biciclete'], [RENTAL, 'Închiriere biciclete / trotinete'], [STATION, 'Stații de transport public']].map(function (x) {
      return '<tr><td><span class="dot" style="background:' + CAT_COLORS[x[0]] + '"></span>' + x[1] + '</td><td>' + cA.cats[x[0]] + '</td><td>' + cF.cats[x[0]] + '</td><td>' + cW.cats[x[0]] + '</td></tr>';
    }).join('');
    var gain = cW.amen > 0 ? Math.round(cA.amen / cW.amen * 10) / 10 : null;
    var lost = cF.amen > 0 ? Math.round((1 - cA.amen / cF.amen) * 100) : 0;
    var push = pushShare(rA, state.tm);
    var elev = hasSlope() ? 'Altitudinea punctului: ' + fmt(G.ele[snap.node]) + ' m. ' : '';
    $('stats').innerHTML = '<div class="note">' + elev + 'Setări: ' + describe(s) + '.</div>' +
      '<div><b>' + km(rA.lengthM) + ' km</b> de rețea atinsă (fără restricții: ' + km(rF.lengthM) + ' km; pe jos: ' + km(rW.lengthM) + ' km)</div>' +
      (state.tp ? '<div class="note tpnote"><span class="keyline tp"></span> Cu transportul public (vehiculul rămâne la stație, ' + PARK_AND_RIDE / 60 + ' min pentru parcare, așteptare = jumătate din intervalul la vârf, fără transbordare): ' +
        (state.tp.arr.lines.length ? 'linii folosite: ' + esc(state.tp.arr.lines.slice(0, 18).join(', ')) + (state.tp.arr.lines.length > 18 ? ' …' : '') + '. Coloana „Vehicul” include și facilitățile atinse așa.' : 'nicio linie nu aduce un câștig în timpul ales.') + '</div>' : '') +
      (s.legal ? '<div class="note">' + fmt(push) + '% din rețeaua atinsă se parcurge pe jos, cu vehiculul de mână (trotuare, zone pietonale, contrasens' + (veh().rules === 'scooter' ? ', străzi peste 50 km/h fără pistă' : '') + ').</div>' : '') +
      '<table><thead><tr><th></th><th>Vehicul</th><th>Fără restr.</th><th>Pe jos</th></tr></thead><tbody>' + rows +
      '<tr><td><b>Total facilități</b></td><td><b>' + cA.amen + '</b></td><td>' + cF.amen + '</td><td>' + cW.amen + '</td></tr>' + extra + '</tbody></table>' +
      '<div class="note">' + cA.present + ' din 5 categorii prezente. ' + (gain !== null ? 'De ' + fmt(gain, 1) + ' ori mai multe facilități decât pe jos (1,4 m/s)' : '') +
      (s.legal && lost > 0 ? '; regulile de circulație și lipsa pistelor reduc numărul cu ' + lost + '% față de varianta fără restricții.' : '.') + '</div>' + parkLine(cA);
  }

  // câte dintre facilitățile atinse au o parcare de biciclete la cel mult PARK_RADIUS metri
  function parkLine(cA) {
    if (!PARKFLAG || $('onlyPark').checked) return '';
    var all = 0, withPark = 0, pts = POIS_ALL.pts;
    for (var i = 0; i < pts.length; i++) {
      if (!cA.inside[i] || pts[i][2] > 4) continue;
      all++; if (PARKFLAG[i]) withPark++;
    }
    return '<div class="note"><b>Parcare la destinație</b>: ' + withPark + ' din ' + all + ' facilități atinse (' + fmt(all ? withPark / all * 100 : 0) +
      '%) au o parcare de biciclete cartografiată la cel mult ' + PARK_RADIUS + ' m. OpenStreetMap are doar ' + POIS_ALL.pts.filter(function (p) { return p[2] === PARK; }).length +
      ' parcări de biciclete în zonă – completarea lor schimbă direct acest indicator.</div>';
  }

  // același punct, toate vehiculele (cu regulile alese) și mersul pe jos
  function showCompare(snap, T, s) {
    var run = function (prof) {
      var d = C.dijkstra(G, snap.node, snap.dist / prof.access, prof, T, wsC);
      return C.countReach(state.pois, d, prof, T, false);
    };
    var walk = run(profileFor('walk', WALK, 0, s.slope));
    var rows = ['<tr><td>Pe jos (1,4 m/s)</td><td>' + walk.amen + '</td><td>1×</td><td>' + walk.cats[STATION] + '</td></tr>'];
    M.ORDER.forEach(function (k) {
      var v = M.VEHICLES[k], v0 = k === vehicle ? s.v0 : v.v0;
      [true, false].forEach(function (legal) {
        var r = run(profileFor(k, v0, legal ? (s.mode || 1) : 0, s.slope));
        var cur = k === vehicle && legal === s.legal;
        var cls = (cur ? 'cur ' : '') + (legal ? '' : 'free');
        rows.push('<tr' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + '><td>' + esc(v.name) + ' · ' + fmt(v0 * 3.6) + ' km/h' + (legal ? (MODE_LABEL[s.mode] ? ' <small>' + MODE_LABEL[s.mode] + '</small>' : '') : ' <small>fără restricții</small>') +
          '</td><td>' + r.amen + '</td><td>' + (walk.amen ? fmt(r.amen / walk.amen, 1) + '×' : '–') + '</td><td>' + r.cats[STATION] + '</td></tr>');
      });
    });
    $('compare').innerHTML = '<h3>Același punct, ' + (T / 60) + ' minute' + (s.slope ? ', cu pantă' : '') + '</h3>' +
      '<table><thead><tr><th>Mod</th><th>Facilități</th><th>vs. pe jos</th><th>Stații</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      '<div class="note">Rândurile „fără restricții” arată potențialul dacă infrastructura ar permite peste tot circulația vehiculului.</div>';
  }

  function showZoneHere() {
    if (!ZONES) { $('zoneHere').textContent = ''; return; }
    var f = ZONES.features.filter(function (z) { return C.pointInGeometry(z.geometry, origin.lng, origin.lat); })[0];
    $('zoneHere').innerHTML = f ? 'Punctul este în zona <b>' + esc(f.properties.zone_name) + '</b> (' + esc(f.properties.zone_id) + ').' : 'Punctul este în afara celor 17 zone MVA–MVI.';
  }

  // ---------------------------------------------------------------- desenare
  function inView(e, box) {
    var u = G.eu[e], v = G.ev[e], ux = G.mx[u], uy = G.my[u], vx = G.mx[v], vy = G.my[v];
    return !((ux < box[0] && vx < box[0]) || (ux > box[1] && vx > box[1]) || (uy < box[2] && vy < box[2]) || (uy > box[3] && vy > box[3]));
  }
  function strokeEdges(ctx, X, Y, list) {
    list.forEach(function (it) {
      var pts = C.edgePath(G, it.e, it.fromLow === false);
      if (it.frac !== undefined && it.frac < 1) pts = C.cutPath(pts, it.frac);
      ctx.moveTo(X(pts[0]), Y(pts[1]));
      for (var i = 2; i < pts.length; i += 2) ctx.lineTo(X(pts[i]), Y(pts[i + 1]));
    });
  }
  function infraClass(e) {
    var c = G.cls[e], f = G.mflag[e];
    if (c === M.CLS.CYCLEWAY) return 'cycleway';
    if (c >= M.CLS.LOCAL && c <= M.CLS.TRUNK) {
      if (f & M.F_LANE) return 'lane';
      if (M.speedLimit(G, e) > M.URBAN_LIMIT) return 'fast';
      return null;
    }
    if (c === M.CLS.FOOTWAY || c === M.CLS.NOBIKE) return 'foot';
    return null;
  }

  function draw() {
    var size = map.getSize(), dpr = window.devicePixelRatio || 1;
    canvas.width = size.x * dpr; canvas.height = size.y * dpr;
    canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    if (!G) return;
    var z = map.getZoom(), S = 256 * Math.pow(2, z), tl = map.getPixelBounds().min;
    var X = function (v) { return v * S - tl.x; }, Y = function (v) { return v * S - tl.y; };
    var box = [tl.x / S, (tl.x + size.x) / S, tl.y / S, (tl.y + size.y) / S];
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var e;
    if (streetBase && z >= 12) {
      ctx.beginPath(); ctx.strokeStyle = 'rgba(110,110,110,0.35)'; ctx.lineWidth = 1;
      var all = [];
      for (e = 0; e < G.nE; e++) if (inView(e, box)) all.push({ e: e });
      strokeEdges(ctx, X, Y, all); ctx.stroke();
    }
    if ($('showInfra').checked && z >= 12) {
      var groups = { foot: [], fast: [], lane: [], cycleway: [] };
      for (e = 0; e < G.nE; e++) {
        var k = infraClass(e);
        if (k && inView(e, box)) groups[k].push({ e: e });
      }
      ['foot', 'fast', 'lane', 'cycleway'].forEach(function (k) {
        ctx.beginPath(); ctx.strokeStyle = INFRA[k]; ctx.globalAlpha = k === 'foot' ? 0.45 : 0.75;
        ctx.lineWidth = Math.max(3, Math.min(8, 2 + (z - 12) * 1.1));
        strokeEdges(ctx, X, Y, groups[k]); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    if (SURVEY && $('showSurvey').checked && z >= 11) drawSurvey(ctx, X, Y, box, z);
    if (G.risk && $('showRisk').checked && z >= 11) drawRisk(ctx, X, Y, box, z);
    // lipsurile din rețea: grosimea și opacitatea după scor
    if (GAPS && $('showGaps').checked && z >= 11) {
      var top = GAPS.top, max = GAPS.max;
      [[0.5, 1], [0.25, 0.5], [0, 0.25]].reverse().forEach(function (band) {
        var list = top.filter(function (e) { var r = GAPS.score[e] / max; return r > band[0] && r <= band[1] && inView(e, box); }).map(function (e) { return { e: e }; });
        if (!list.length) return;
        ctx.beginPath(); ctx.strokeStyle = '#7b2cbf'; ctx.globalAlpha = 0.35 + band[1] * 0.5;
        ctx.lineWidth = Math.max(3, Math.min(12, (2 + (z - 11)) * (0.6 + band[1])));
        strokeEdges(ctx, X, Y, list); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    if (!state) { drawAccidents(ctx, X, Y, size, z); return; }
    var width = Math.max(1.5, Math.min(5, 1.2 + (z - 12) * 0.5));
    // fără restricții, în gri: doar unde vehiculul, cu regulile alese, nu ajunge
    if (state.legal) {
      var fracA = new Map(state.reachA.items.map(function (it) { return [it.e, it.frac]; }));
      ctx.beginPath(); ctx.strokeStyle = 'rgba(90,90,90,0.5)'; ctx.lineWidth = Math.max(1, width * 0.7);
      strokeEdges(ctx, X, Y, state.reachF.items.filter(function (it) { return (fracA.get(it.e) || 0) < it.frac - 1e-6 && inView(it.e, box); }));
      ctx.stroke();
    }
    var bins = [], pushed = [];
    for (var b = 0; b < NB; b++) bins.push([]);
    state.reachA.items.forEach(function (it) {
      if (!inView(it.e, box)) return;
      bins[Math.min(NB - 1, Math.floor(it.tt * NB))].push(it);
      if ((it.fromLow ? state.tm.mf[it.e] : state.tm.mb[it.e]) === M.PUSH) pushed.push(it);
    });
    ctx.lineWidth = width;
    bins.forEach(function (list, k) {
      if (!list.length) return;
      ctx.beginPath(); ctx.strokeStyle = BIN_COLORS[k];
      strokeEdges(ctx, X, Y, list); ctx.stroke();
    });
    // continuarea pe jos de la stațiile de coborâre (bicicletă + transport public)
    if (state.tp) {
      ctx.beginPath(); ctx.strokeStyle = '#7b5ea7'; ctx.lineWidth = Math.max(1.5, width * 0.8); ctx.globalAlpha = 0.85;
      strokeEdges(ctx, X, Y, state.tp.reach.items.filter(function (it) { return inView(it.e, box); }));
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    if ($('showPush').checked && state.legal && pushed.length && z >= 13) {
      ctx.beginPath(); ctx.strokeStyle = '#15171a'; ctx.lineWidth = Math.max(1, width * 0.5); ctx.setLineDash([3, 4]);
      strokeEdges(ctx, X, Y, pushed); ctx.stroke(); ctx.setLineDash([]);
    }
    var showAm = $('showAm').checked, showSt = $('showSt').checked, showPark = $('showPark').checked;
    var pts = state.pois.pts, poiMx = state.pois.mx, poiMy = state.pois.my;
    for (var i = 0; i < pts.length; i++) {
      if (!state.inA[i]) continue;
      var c = pts[i][2], x = X(poiMx[i]), y = Y(poiMy[i]);
      if (x < -10 || y < -10 || x > size.x + 10 || y > size.y + 10) continue;
      if (c === STATION) {
        if (!showSt) continue;
        ctx.beginPath(); ctx.arc(x, y, pts[i][4] === 3 ? 4 : 6, 0, 6.2832);
        ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = CAT_COLORS[STATION]; ctx.stroke();
      } else if (c === PARK || c === RENTAL) {
        if (!showPark) continue;
        ctx.beginPath(); ctx.rect(x - 3.5, y - 3.5, 7, 7);
        ctx.fillStyle = CAT_COLORS[c]; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
      } else if (showAm) {
        ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.2832);
        ctx.fillStyle = CAT_COLORS[c]; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    drawAccidents(ctx, X, Y, size, z);
  }

  // ---------------------------------------------------------------- siguranța
  function initSafety(tram, acc) {
    if (tram) M.markTram(G, tram.linii);
    if (TRANSIT) M.markBus(G, TRANSIT);
    M.riskBands(G);
    timesCache = {};
    $('riskKey').innerHTML = RISK_COLORS.map(function (c, i) { return '<span style="background:' + c + '"></span>' + (i + 1); }).join(' ');
    if (acc) {
      ACC = acc;
      ACC_EDGE = M.snapAccidents(G, acc.puncte, 30);
      $('accToggle').hidden = false;
    }
    renderRiskValidation();
  }
  function drawRisk(ctx, X, Y, box, z) {
    var groups = [[], [], [], [], []];
    for (var e = 0; e < G.nE; e++) {
      var c = G.cls[e];
      if (c === M.CLS.FOOTWAY || c === M.CLS.STEPS || c === M.CLS.NOBIKE || c === M.CLS.MOTORWAY) continue;
      if (c === M.CLS.PATH && z < 14) continue;   // aleile și drumurile de pământ doar de aproape
      if (inView(e, box)) groups[G.risk[e] - 1].push({ e: e });
    }
    groups.forEach(function (list, k) {
      if (!list.length) return;
      ctx.beginPath(); ctx.strokeStyle = RISK_COLORS[k]; ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(2, Math.min(7, 1 + (z - 11) * (0.6 + k * 0.15)));
      strokeEdges(ctx, X, Y, list); ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }
  function drawAccidents(ctx, X, Y, size, z) {
    if (!ACC || !$('showAcc').checked || z < 11) return;
    var kind = +$('accKind').value, r0 = Math.max(2, (z - 10) * 0.8);
    [0, 1, 2].forEach(function (sev) {   // cele grave deasupra
      ACC.puncte.forEach(function (p) {
        if (p[4] !== sev || (kind && p[3] !== kind)) return;
        var m = C.merc(p[0], p[1]), x = X(m[0]), y = Y(m[1]);
        if (x < -10 || y < -10 || x > size.x + 10 || y > size.y + 10) return;
        ctx.beginPath(); ctx.arc(x, y, r0 * [1, 1.6, 2][sev], 0, 6.2832);
        ctx.fillStyle = ['#f28e2b', '#d62728', '#15171a'][sev]; ctx.globalAlpha = sev ? 0.95 : 0.7; ctx.fill();
        ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.stroke();
      });
    });
  }
  function renderRiskValidation() {
    if (!G.risk) return;
    var kind = ACC ? +$('accKind').value : 0;
    var rows = ACC ? M.riskTable(G, ACC.puncte, ACC_EDGE, function (p) { return !kind || p[3] === kind; })
      : M.riskTable(G, [], new Int32Array(0));
    var km = rows.reduce(function (a, r) { return a + r.km; }, 0);
    var html = '<table><thead><tr><th>Risc</th><th>km</th><th>% rețea</th>' + (ACC ? '<th>Accidente</th><th>la 100 km</th><th>grave+mortale</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr><td><span class="dot" style="background:' + RISK_COLORS[r.band - 1] + '"></span>' + r.band + '</td><td>' + fmt(r.km) + '</td><td>' + fmt(r.km / km * 100, 1) + '%</td>' +
          (ACC ? '<td>' + r.acc + '</td><td>' + fmt(r.accPer100, 1) + '</td><td>' + r.ksi + (r.acc ? ' (' + fmt(r.ksiShare) + '%)' : '') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
    if (ACC) {
      var R = ACC.rezumat, b = R['Bicicletă'], t = R['Trotinetă'];
      var falls = function (x) { return x.mod['cadere din vehicul'] || 0; };
      html += '<p class="note"><b>Cum se citește</b>: km de piste, alei și străzi pe fiecare clasă (în tot pătratul exportat, inclusiv drumurile de câmp) și accidentele legate de cea mai apropiată stradă (≤ 30 m). <b>Fără expunere</b> (câți bicicliști trec pe acolo) tabelul nu este un risc: clasa 2 are mulți km de drumuri liniștite pe care se circulă puțin, clasa 5 drumuri mari pe care bicicliștii le evită. Accidentele grave sunt prea puține (' +
        rows.reduce(function (a, r) { return a + r.ksi; }, 0) + ') pentru o validare statistică.</p>' +
        '<p class="note"><b>Limita datelor Poliției</b>: exportul nu are categoria vehiculelor, deci un accident apare aici doar dacă biciclistul / trotinetistul a fost găsit vinovat (cauza „abateri bicicliști” / „abateri conducători trotinete”). Accidentele în care un șofer a lovit un biciclist lipsesc. Din cele găsite, căderile sunt ' +
        fmt(falls(b) / b.total * 100) + '% la bicicletă și ' + fmt(falls(t) / t.total * 100) + '% la trotinetă – ele spun mai mult despre starea pistelor și a carosabilului (șine, borduri, gropi) decât despre trafic. ' +
        b.total + ' accidente cu bicicletă și ' + t.total + ' cu trotinetă în ' + ACC.perioada[0].slice(0, 4) + '–' + ACC.perioada[1].slice(0, 4) + ' (până la ' + ACC.perioada[1].split('-').reverse().join('.') + ').</p>';
    }
    $('riskValidation').innerHTML = html;
  }
  ['showRisk', 'showAcc'].forEach(function (id) { $(id).addEventListener('change', draw); });
  $('accKind').addEventListener('change', function () { renderRiskValidation(); draw(); });

  // ---------------------------------------------------------------- zonele MVA–MVI
  var METRICS = {
    amen_mean: { label: 'facilități medii', pal: ['#f1f7f4', '#9bd0b8', '#1f9e9a', '#0b4f6c'], d: 0 },
    gain_pct: { label: 'diferența față de referință (%)', pal: ['#fff5eb', '#fdbe85', '#e8743b', '#a63603'], d: 0 },
    full_share: { label: 'puncte 5/5 (%)', pal: ['#f1f7f4', '#9bd0b8', '#1f9e9a', '#0b4f6c'], d: 0 },
    stations_mean: { label: 'stații medii', pal: ['#f3f0f7', '#bcb0d8', '#7b5ea7', '#3f2a6b'], d: 1 }
  };
  function zoneStyle(f) {
    var base = { pane: 'zones', color: '#3a3a3a', weight: 1.2, opacity: 0.7, dashArray: '4 3', fillOpacity: 0 };
    if (!zoneResults) return base;
    var key = $('metric').value, r = zoneResults.byId[f.properties.zone_id], v = r && r[key];
    if (v === null || v === undefined) return base;
    var rng = zoneResults.range[key], t = rng[1] > rng[0] ? (v - rng[0]) / (rng[1] - rng[0]) : 0.5;
    base.fillColor = colorAt(t, METRICS[key].pal); base.fillOpacity = 0.45;
    return base;
  }
  function loadZones() {
    return fetch(ZONES_URL).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (gj) {
      ZONES = gj;
      zoneLayer = L.geoJSON(gj, { pane: 'zones', interactive: false, style: zoneStyle });
      gj.features.forEach(function (f) {
        var b = C.geometryBbox(f.geometry);
        f._bounds = L.latLngBounds([b[1], b[0]], [b[3], b[2]]);
      });
      if ($('showZones').checked) zoneLayer.addTo(map);
      showZoneHere();
    }).catch(function (err) {
      console.warn('Zonele nu s-au încărcat', err);
      $('zonesBox').hidden = true; $('showZones').parentNode.hidden = true;
    });
  }

  function runZones() {
    if (!G || !ZONES || zoneRunning) return;
    zoneRunning = true;
    var s = settings(), refKind = $('zoneRef').value;
    var prof = profileFor(vehicle, s.v0, s.legal, s.slope);
    var ref = refKind === 'walk' ? profileFor('walk', WALK, false, s.slope) : profileFor(vehicle, s.v0, false, s.slope);
    var opts = { minutes: s.minutes, profile: prof, ref: ref, spacing: +$('spacing').value, maxPoints: +$('maxPoints').value, maxSnap: 150 };
    var ctx = { g: G, grid: grid, pois: activePois(), ws: C.workspace(G) };
    var rows = [], feats = ZONES.features.slice(), i = 0, t0 = Date.now();
    $('runZones').disabled = true; $('csvZones').disabled = true;
    (function step() {
      if (i >= feats.length) { finish(); return; }
      $('zonesStatus').textContent = 'Se calculează zona ' + (i + 1) + ' din ' + feats.length + ' (' + feats[i].properties.zone_name + ')…';
      setTimeout(function () {
        var r = C.analyzeZone(ctx, feats[i], opts);
        r.gain_pct = r.amen_mean_ref ? (r.amen_mean / r.amen_mean_ref - 1) * 100 : null;
        rows.push(r);
        i++; step();
      }, 0);
    })();
    function finish() {
      zoneRunning = false;
      $('runZones').disabled = false; $('csvZones').disabled = false;
      var range = {};
      Object.keys(METRICS).forEach(function (k) {
        var vals = rows.map(function (r) { return r[k]; }).filter(function (v) { return v !== null && isFinite(v); });
        range[k] = vals.length ? [Math.min.apply(null, vals), Math.max.apply(null, vals)] : [0, 0];
      });
      var byId = {}; rows.forEach(function (r) { byId[r.zone_id] = r; });
      zoneResults = { rows: rows, byId: byId, range: range, s: s, refKind: refKind, spacing: opts.spacing };
      var pts = rows.reduce(function (a, r) { return a + r.points; }, 0);
      $('zonesStatus').textContent = 'Calculat în ' + fmt((Date.now() - t0) / 1000, 1) + ' s: ' + pts + ' puncte, ' + s.minutes + ' min, ' +
        describe(s) + ', grilă ' + opts.spacing + ' m; comparat cu ' + (refKind === 'walk' ? 'mersul pe jos' : 'varianta fără restricții') + '.';
      $('zonesResult').hidden = false;
      if (!$('showZones').checked) { $('showZones').checked = true; zoneLayer.addTo(map); }
      renderZones();
    }
  }

  function renderZones() {
    if (!zoneResults) return;
    var key = $('metric').value, m = METRICS[key], rng = zoneResults.range[key];
    zoneLayer.setStyle(zoneStyle);
    $('zoneLegend').innerHTML = '<span>' + fmt(rng[0], m.d) + '</span><span class="bar" style="background:linear-gradient(to right,' + m.pal.join(',') + ')"></span><span>' + fmt(rng[1], m.d) + '</span>';
    var rows = zoneResults.rows.slice().sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (va === null) return 1; if (vb === null) return -1;
      return va - vb;   // cele mai slab deservite zone primele
    });
    var refName = zoneResults.refKind === 'walk' ? 'pe jos' : 'fără restr.';
    var sz = SURVEY && SURVEY.zone;
    $('zoneTable').innerHTML = '<thead><tr><th>Zona</th><th>Facilități<br>vehicul / ' + refName + '</th><th>Dif.</th><th>5/5</th><th>Stații</th>' +
      (sz ? '<th title="Respondenții chestionarului velo care locuiesc în zonă și folosesc bicicleta cel puțin o dată pe săptămână">Velo*</th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (r) {
        var st = zoneStyle({ properties: { zone_id: r.zone_id } });
        return '<tr data-id="' + esc(r.zone_id) + '"><td><span class="sw" style="background:' + (st.fillColor || 'transparent') + '"></span>' + esc(r.zone_name) +
          '</td><td>' + fmt(r.amen_mean) + ' / ' + fmt(r.amen_mean_ref) + '</td><td>' + (r.gain_pct === null ? '–' : (r.gain_pct > 0 ? '+' : '') + fmt(r.gain_pct) + '%') +
          '</td><td>' + (r.full_share === null ? '–' : fmt(r.full_share) + '%') + '</td><td>' + fmt(r.stations_mean, 1) + '</td>' +
          (sz ? '<td>' + (sz[r.zone_id] ? fmt(sz[r.zone_id].frecvent_pct) + '% <small>(n=' + sz[r.zone_id].respondenti + ')</small>' : '–') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody>';
  }
  function zonesCsv() {
    var o = zoneResults;
    var head = ['zona_id', 'zona', 'vehicul', 'viteza_kmh', 'reguli', 'referinta', 'minute', 'puncte_analizate', 'facilitati_medie_vehicul',
      'facilitati_medie_referinta', 'diferenta_pct', 'facilitati_mediana', 'puncte_cu_toate_5_categorii_pct', 'statii_medie',
      'chestionar_respondenti', 'chestionar_folosesc_bicicleta_pct', 'chestionar_saptamanal_pct', 'chestionar_mod_principal_bicicleta_pct'];
    var num = function (v) { return v === null || v === undefined || !isFinite(v) ? '' : String(Math.round(v * 10) / 10); };
    var txt = function (v) { var t = String(v); return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    var lines = [head.join(',')];
    o.rows.forEach(function (r) {
      lines.push([txt(r.zone_id), txt(r.zone_name), o.s.vehicle, num(o.s.v0 * 3.6), o.s.legal ? 'cod_rutier' : 'fara_restrictii',
        o.refKind === 'walk' ? 'pe_jos_1.4ms' : 'fara_restrictii', o.s.minutes, r.points, num(r.amen_mean), num(r.amen_mean_ref),
        num(r.gain_pct), num(r.amen_median), num(r.full_share), num(r.stations_mean)].concat((function (z) {
          return z ? [z.respondenti, num(z.bicicleta_pct), num(z.frecvent_pct), num(z.mod_bicicleta_pct)] : ['', '', '', ''];
        })(SURVEY && SURVEY.zone && SURVEY.zone[r.zone_id])).join(','));
    });
    return lines.join('\n') + '\n';
  }
  $('zoneTable').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-id]');
    if (!tr || !ZONES) return;
    var f = ZONES.features.filter(function (z) { return z.properties.zone_id === tr.dataset.id; })[0];
    if (f) map.fitBounds(f._bounds, { padding: [20, 20] });
  });
  $('csvZones').addEventListener('click', function () {
    if (!zoneResults) return;
    var o = zoneResults;
    var blob = new Blob(['﻿' + zonesCsv()], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'iasi_micro15_zone_' + o.s.vehicle + '_' + Math.round(o.s.v0 * 3.6) + 'kmh_' + o.s.minutes + 'min' +
      (o.s.legal ? '' : '_fara_restrictii') + (o.s.slope ? '_panta' : '') + '_vs_' + o.refKind + '_grila' + o.spacing + 'm.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('runZones').addEventListener('click', runZones);
  $('metric').addEventListener('change', renderZones);
  $('showZones').addEventListener('change', function () {
    if (!zoneLayer) return;
    if ($('showZones').checked) zoneLayer.addTo(map); else map.removeLayer(zoneLayer);
  });


  // ---------------------------------------------------------------- lipsurile din rețea
  function runGaps() {
    if (!G || !ZONES) return;
    var s = settings();
    if (!s.legal) { $('gapsStatus').textContent = 'Bifați „Respectă regulile de circulație”: lipsurile se măsoară față de varianta fără restricții.'; return; }
    var T = s.T, spacing = +$('gapSpacing').value, free = times(vehicle, s.v0, 0, s.slope), rules = times(vehicle, s.v0, s.mode, s.slope);
    var origins = [];
    ZONES.features.forEach(function (f) {
      C.thin(C.gridPoints(f.geometry, spacing), 25).forEach(function (pt) {
        var r = C.nearestNode(G, grid, pt[0], pt[1], 8);
        if (r.node >= 0 && r.dist <= 150) origins.push([r.node, r.dist]);
      });
    });
    $('runGaps').disabled = true; $('csvGaps').disabled = true;
    var score = new Float64Array(G.nE), i = 0, chunk = 10, t0 = Date.now(), P = activePois();
    (function step() {
      if (i >= origins.length) { finish(); return; }
      $('gapsStatus').textContent = 'Se calculează: ' + i + ' din ' + origins.length + ' puncte…';
      setTimeout(function () {
        var part = M.gapScores(G, free, rules, origins.slice(i, i + chunk), P, T, { access: 1.2 });
        var n = Math.min(chunk, origins.length - i);
        for (var e = 0; e < G.nE; e++) score[e] += part[e] * n;
        i += chunk; step();
      }, 0);
    })();
    function finish() {
      for (var e = 0; e < G.nE; e++) score[e] /= Math.max(1, origins.length);
      var top = [];
      for (e = 0; e < G.nE; e++) if (score[e] > 0) top.push(e);
      top.sort(function (a, b) { return score[b] - score[a]; });
      top = top.slice(0, 600);
      GAPS = { score: score, top: top, max: top.length ? score[top[0]] : 1, s: s, origins: origins.length, spacing: spacing };
      $('runGaps').disabled = false; $('csvGaps').disabled = !top.length;
      $('gapToggle').hidden = !top.length;
      $('gapsStatus').textContent = 'Calculat în ' + fmt((Date.now() - t0) / 1000, 1) + ' s din ' + origins.length + ' puncte: ' + describe(s) + ', ' + s.minutes +
        ' min. Scor = facilități pe punct pentru care drumul cel mai rapid trece pe acolo fără să poată fi parcurs legal pe vehicul.';
      loadNames().then(renderGaps);
      draw();
    }
  }
  function loadNames() {
    if (EDGE_NAMES) return Promise.resolve(EDGE_NAMES);
    return fetch(DATA_DIR + 'edges.json').then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      EDGE_NAMES = new Array(G.nE);
      if (d && d.edges === G.nE) d.name.forEach(function (x) { EDGE_NAMES[x[0]] = d.names[x[1]]; });
      return EDGE_NAMES;
    }).catch(function () { EDGE_NAMES = new Array(G.nE); return EDGE_NAMES; });
  }
  var CLS_LABEL = ['pistă', 'alee comună', 'alee', 'stradă locală', 'stradă terțiară', 'stradă secundară', 'stradă principală', 'drum național', 'autostradă', 'trotuar / pietonal', 'scări', 'interzis bicicletelor'];
  // de ce nu se poate circula legal pe segment (pentru vehiculul și setările lipsurilor)
  function gapReason(e) {
    var c = G.cls[e], v = M.VEHICLES[GAPS.s.vehicle];
    if (c === M.CLS.FOOTWAY || c === M.CLS.NOBIKE) return 'trotuar / zonă pietonală';
    if (c === M.CLS.STEPS) return 'scări';
    if (M.oneway(G, e)) {
      var mode = M.legalMode(G, e, v, true, GAPS.s.mode === 2 ? true : (MODE_RISK[GAPS.s.mode] || false));
      if (mode === M.RIDE) return 'sens unic fără contrasens';
    }
    if (v.rules === 'scooter' && c >= M.CLS.LOCAL && c <= M.CLS.TRUNK && M.speedLimit(G, e) > M.URBAN_LIMIT) return '> 50 km/h fără pistă';
    if (GAPS.s.mode === 2 && !M.comfortable(G, e)) return CLS_LABEL[c] + ' fără pistă';
    if (MODE_RISK[GAPS.s.mode] && G.risk && G.risk[e] > MODE_RISK[GAPS.s.mode]) return 'risc ' + G.risk[e] + ' (' + CLS_LABEL[c] + ')';
    if (c === M.CLS.SHARED || c === M.CLS.PATH) return 'alee (nu e pistă)';
    return CLS_LABEL[c];
  }
  // segmentele cu același nume și același motiv se adună (o stradă e de obicei împărțită în multe segmente)
  function gapGroups() {
    var groups = {}, list = [];
    GAPS.top.forEach(function (e) {
      var name = EDGE_NAMES[e] || '(fără nume)', reason = gapReason(e), key = name + '|' + reason;
      var g = groups[key];
      if (!g) { g = groups[key] = { name: name, reason: reason, score: 0, len: 0, edges: [] }; list.push(g); }
      g.score = Math.max(g.score, GAPS.score[e]); g.len += G.elen[e]; g.edges.push(e);
    });
    list.forEach(function (g) {
      var d = SURVEY && SURVEY.byName[g.name];
      g.parcurse = d ? d.parcurse : 0; g.dorite = d ? d.dorite : 0; g.demand = g.parcurse + g.dorite;
    });
    // prioritatea combinată: scorul rețelei și cererea declarată, fiecare raportat la maximul din listă
    var maxS = Math.max.apply(null, list.map(function (g) { return g.score; }).concat([1e-9]));
    var maxD = Math.max.apply(null, list.map(function (g) { return g.demand; }).concat([1]));
    list.forEach(function (g) { g.priority = g.score / maxS + g.demand / maxD; });
    var by = SURVEY && $('gapSort').value === 'both' ? 'priority' : 'score';
    return list.sort(function (a, b) { return b[by] - a[by]; });
  }
  function renderGaps() {
    if (!GAPS) return;
    var list = gapGroups().slice(0, 25);
    GAPS.groups = list;
    $('gapTable').innerHTML = '<thead><tr><th>Stradă / segment</th><th>Motiv</th><th>m</th><th>Scor</th>' +
      (SURVEY ? '<th title="Respondenți care au numit strada: parcursă cel mai des / dorită pentru biciclete și pietoni">Chest.</th>' : '') + '</tr></thead><tbody>' +
      list.map(function (g, k) {
        return '<tr data-k="' + k + '"><td>' + esc(g.name) + '</td><td>' + esc(g.reason) + '</td><td>' + fmt(g.len) + '</td><td>' + fmt(g.score, 1) + '</td>' +
          (SURVEY ? '<td>' + (g.demand ? g.parcurse + ' / ' + g.dorite : '–') + '</td>' : '') + '</tr>';
      }).join('') + '</tbody>';
  }
  $('gapTable').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-k]');
    if (!tr || !GAPS || !GAPS.groups) return;
    var g = GAPS.groups[+tr.dataset.k], b = L.latLngBounds([]);
    g.edges.forEach(function (e) { b.extend([G.lat[G.eu[e]], G.lon[G.eu[e]]]); b.extend([G.lat[G.ev[e]], G.lon[G.ev[e]]]); });
    if (!$('showGaps').checked) { $('showGaps').checked = true; }
    map.fitBounds(b.pad(0.6), { maxZoom: 17 });
  });
  $('csvGaps').addEventListener('click', function () {
    if (!GAPS) return;
    var t = function (v) { var x = String(v); return /[",;\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var lines = ['segment,strada,motiv,clasa,limita_kmh,lungime_m,scor,chestionar_parcurse,chestionar_dorite,lat,lon'];
    GAPS.top.forEach(function (e) {
      var d = SURVEY && EDGE_NAMES && SURVEY.byName[EDGE_NAMES[e]];
      lines.push([e, t(EDGE_NAMES && EDGE_NAMES[e] || ''), t(gapReason(e)), t(CLS_LABEL[G.cls[e]]), G.maxspeed[e] || '', Math.round(G.elen[e]),
        Math.round(GAPS.score[e] * 100) / 100, d ? d.parcurse : 0, d ? d.dorite : 0,
        ((G.lat[G.eu[e]] + G.lat[G.ev[e]]) / 2).toFixed(5), ((G.lon[G.eu[e]] + G.lon[G.ev[e]]) / 2).toFixed(5)].join(','));
    });
    var blob = new Blob(['﻿' + lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'iasi_micro15_lipsuri_' + GAPS.s.vehicle + (GAPS.s.mode === 2 ? '_confortabil' : MODE_RISK[GAPS.s.mode] ? '_risc' + MODE_RISK[GAPS.s.mode] : '') + '_' + GAPS.s.minutes + 'min.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('runGaps').addEventListener('click', runGaps);
  $('gapSort').addEventListener('change', renderGaps);

  // ---------------------------------------------------------------- chestionarul velo (Masterplan 2022–2023)
  function initSurvey(ch) {
    SURVEY = ch;
    SURVEY.byName = {};
    ch.strazi.forEach(function (x) { SURVEY.byName[x.nume] = x; });
    $('surveyToggle').hidden = false; $('surveyBox').hidden = false; $('gapSortRow').hidden = false;
    $('gapSort').value = 'both';
    $('surveyKey').innerHTML = SURVEY_CLASSES.map(function (c, i) {
      var hi = i + 1 < SURVEY_CLASSES.length ? SURVEY_CLASSES[i + 1][0] - 1 : null;
      return '<span style="background:' + c[1] + ';height:' + Math.max(2, c[2]) + 'px"></span>' + c[0] + (hi ? '–' + hi : '+');
    }).join(' ');
    var S = ch.sumar, M2 = ch.sumar_multiplu, n = ch.raspunsuri;
    var pct = function (obj, key) { return fmt((obj[key] || 0) / n * 100) + '%'; };
    var row = function (label, value) { return '<tr><td>' + label + '</td><td>' + value + '</td></tr>'; };
    var top = ch.strazi.slice(0, 8).map(function (x) { return esc(x.nume) + ' (' + x.parcurse + ')'; }).join(', ');
    var wanted = ch.strazi.slice().sort(function (a, b) { return b.dorite - a.dorite; }).slice(0, 6).map(function (x) { return esc(x.nume) + ' (' + x.dorite + ')'; }).join(', ');
    var fmtDate = function (d) { return d.split('-').reverse().join('.'); };
    $('surveySummary').innerHTML = '<p class="note">' + n.toLocaleString('ro-RO') + ' de răspunsuri, ' + fmtDate(ch.perioada[0]) + ' – ' + fmtDate(ch.perioada[1]) +
      '. Agregatele de mai jos; răspunsurile individuale nu sunt publicate.</p><table>' +
      row('Folosesc bicicleta', pct(S.bicicleta, 'DA')) +
      row('… zilnic sau de mai multe ori pe săptămână', fmt(((S.frecventa['Zilnic'] || 0) + (S.frecventa['De mai multe ori pe săptămână'] || 0)) / n * 100) + '%') +
      row('Bicicleta / trotineta e modul principal', pct(S.mod, 'Bicicletă/trotinetă')) +
      row('Mulțumiți de pistele din Iași', pct(S.multumit, 'DA') + ' (parțial ' + pct(S.multumit, 'PARȚIAL') + ')') +
      row('Se simt în siguranță ca bicicliști', pct(S.siguranta, 'DA')) +
      row('Ar merge cu bicicleta pe orice vreme, cu infrastructură bună', pct(S.vreme, 'DA')) +
      row('De acord cu redimensionarea străzilor pentru biciclete', pct(S.redimensionare, 'DA')) +
      row('De acord cu înlocuirea parcărilor de pe străzile principale cu benzi velo / de transport public', pct(S.parcare, 'DA')) +
      row('Cere siguranță / continuitate a traseelor', fmt((M2.aspecte['Siguranța în deplasare'] || 0) / n * 100) + '% / ' + fmt((M2.aspecte['Continuitate în deplasare'] || 0) / n * 100) + '%') +
      row('Problema nr. 1: „Nu există o rețea de piste”', fmt((M2.probleme['Nu există o rețea de piste pentru biciclete'] || 0) / n * 100) + '%') +
      '</table><p class="note"><b>Cele mai parcurse străzi</b> (respondenți): ' + top + '.</p><p class="note"><b>Dorite pentru biciclete și pietoni</b>: ' + wanted +
      '.</p><p class="note">Zona de domiciliu: ' + Object.keys(ch.zone).reduce(function (a, k) { return a + ch.zone[k].respondenti; }, 0) + ' respondenți în cele 17 zone, ' +
      Object.keys(ch.zm).reduce(function (a, k) { return a + ch.zm[k]; }, 0) + ' în comunele ZM (' + Object.keys(ch.zm).slice(0, 5).join(', ') + ' …). Procentele pe zone apar în analiza pe zone (coloana „Velo*”).</p>';
  }
  // pentru fiecare segment: câți respondenți au numit strada lui (după denumirea OSM din edges.json)
  function surveyEdges() {
    if (!SURVEY || !EDGE_NAMES) return null;
    if (!SURVEY_EDGE) {
      SURVEY_EDGE = { parcurse: new Uint16Array(G.nE), dorite: new Uint16Array(G.nE) };
      for (var e = 0; e < G.nE; e++) {
        var d = EDGE_NAMES[e] && SURVEY.byName[EDGE_NAMES[e]];
        if (d) { SURVEY_EDGE.parcurse[e] = d.parcurse; SURVEY_EDGE.dorite[e] = d.dorite; }
      }
    }
    return SURVEY_EDGE;
  }
  function drawSurvey(ctx, X, Y, box, z) {
    var se = surveyEdges();
    if (!se) return;
    var arr = se[$('surveyKind').value];
    for (var k = 0; k < SURVEY_CLASSES.length; k++) {
      var lo = SURVEY_CLASSES[k][0], hi = k + 1 < SURVEY_CLASSES.length ? SURVEY_CLASSES[k + 1][0] : Infinity, list = [];
      for (var e = 0; e < G.nE; e++) if (arr[e] >= lo && arr[e] < hi && inView(e, box)) list.push({ e: e });
      if (!list.length) continue;
      ctx.beginPath(); ctx.strokeStyle = SURVEY_CLASSES[k][1]; ctx.globalAlpha = 0.85;
      ctx.lineWidth = SURVEY_CLASSES[k][2] * Math.max(1, (z - 11) * 0.5);
      strokeEdges(ctx, X, Y, list); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  $('showSurvey').addEventListener('change', function () {
    if ($('showSurvey').checked) loadNames().then(draw); else draw();
  });
  $('surveyKind').addEventListener('change', draw);

  // ---------------------------------------------------------------- link partajabil
  var hashTimer;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      var s = settings();
      var q = new URLSearchParams({ lat: origin.lat.toFixed(5), lng: origin.lng.toFixed(5), min: s.minutes, v: vehicle,
        kmh: $('speed').value, lg: s.legal ? 1 : 0, net: $('network').value, tp: $('transit').checked ? 1 : 0,
        pk: $('onlyPark').checked ? 1 : 0, pa: $('slope').checked ? 1 : 0, z: map.getZoom() });
      try { history.replaceState(null, '', '#' + q.toString()); } catch (e) { /* unele browsere limitează */ }
    }, 300);
  }
  function applyHash(meta) {
    var q = new URLSearchParams(location.hash.slice(1));
    var num = function (k, lo, hi) { var v = parseFloat(q.get(k)); return isFinite(v) && v >= lo && v <= hi ? v : null; };
    var bb = meta.bbox, lat = num('lat', bb[1], bb[3]), lng = num('lng', bb[0], bb[2]), had = false;
    if (lat !== null && lng !== null) { origin = L.latLng(lat, lng); had = true; }
    if (M.VEHICLES[q.get('v')]) setVehicle(q.get('v'));
    var sp = num('kmh', 5, 30); if (sp !== null) { $('speed').value = sp; setVehicle(vehicle, true); }
    var m = num('min', 5, 30); if (m !== null) $('minutes').value = Math.round(m);
    if (q.get('lg') === '0') $('legal').checked = false;
    if (q.get('cf') === '1') $('network').value = '2';   // linkurile vechi
    if (/^[1-4]$/.test(q.get('net') || '')) $('network').value = q.get('net');
    if (q.get('tp') === '1') $('transit').checked = true;
    if (q.get('pk') === '1') $('onlyPark').checked = true;
    if (q.get('pa') === '0') $('slope').checked = false;
    labels();
    var z = num('z', 10, 19);
    return { zoom: z !== null ? z : 13, hadOrigin: had };
  }
  $('copyLink').addEventListener('click', function () {
    var done = function (msg) { $('copyMsg').textContent = msg; setTimeout(function () { $('copyMsg').textContent = ''; }, 3000); };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { done('Link copiat.'); }, function () { done('Copiați adresa din bara browserului.'); });
    else done('Copiați adresa din bara browserului.');
  });

  // ---------------------------------------------------------------- evenimente
  ['minutes', 'speed'].forEach(function (id) { $(id).addEventListener('input', schedule); });
  ['legal', 'slope', 'network', 'transit', 'onlyPark'].forEach(function (id) { $(id).addEventListener('change', schedule); });
  ['showAm', 'showSt', 'showPark', 'showPush', 'showInfra', 'showGaps'].forEach(function (id) { $(id).addEventListener('change', draw); });
  $('vehicles').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    setVehicle(b.dataset.v);
    schedule();
  });
  map.on('click', function (e) { origin = e.latlng; marker.setLatLng(origin); schedule(); });
  marker.on('drag', function () { origin = marker.getLatLng(); schedule(); });
  map.on('moveend resize zoomend', draw);

  // ---------------------------------------------------------------- încărcare
  function getOk(url, kind) {
    return fetch(DATA_DIR + url).then(function (r) { if (!r.ok) throw new Error(url + ' lipsește (' + r.status + ')'); return r[kind](); });
  }
  setVehicle('bike');
  labels();
  var elevReq = fetch(DATA_DIR + 'elev.bin').then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; });
  Promise.all([getOk('meta.json', 'json'), getOk('graph.bin', 'arrayBuffer'), getOk('micro.bin', 'arrayBuffer'), getOk('pois.json', 'json'), elevReq,
    fetch('data/transit.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('data/chestionar.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('data/tramvai.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('data/accidente.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })]).then(function (res) {
    var meta = res[0];
    G = C.parseGraph(res[1]); grid = C.buildGrid(G);
    M.parseMicro(res[2], G);
    if (res[4]) {
      try { C.parseElev(res[4], G); $('slopeBox').hidden = false; }
      catch (err) { console.warn('Panta nu s-a putut încărca:', err); delete G.lfw; delete G.up; }
    }
    wsA = C.workspace(G); wsB = C.workspace(G); wsC = C.workspace(G); wsD = C.workspace(G);
    var pts = res[3].pts;
    POIS_ALL = poisView(res[3].cats, pts, C.snapPois(G, grid, pts), null);
    PARKFLAG = M.parkingNearby(pts, PARK, PARK_RADIUS);
    // varianta „doar cu parcare”: facilitățile din cele 5 categorii fără parcare în apropiere nu se mai numără
    POIS_PARK = poisView(res[3].cats, pts, POIS_ALL.snap, function (p, i) { return p[2] > 4 || PARKFLAG[i]; });
    if (res[5]) { TRANSIT = M.prepareTransit(res[5], G, grid, C.nearestNode); $('transitBox').hidden = false; }
    if (res[6]) initSurvey(res[6]);
    initSafety(res[7], res[8]);
    origin = L.latLng(meta.start[0], meta.start[1]);
    var h = applyHash(meta);
    if (!h.hadOrigin) {
      var near = C.nearestNode(G, grid, origin.lng, origin.lat, 12);
      if (near.node >= 0) origin = L.latLng(G.lat[near.node], G.lon[near.node]);
    }
    marker.setLatLng(origin);
    map.setView(origin, h.zoom);
    var bb = meta.bbox;
    map.setMaxBounds([[bb[1] - 0.05, bb[0] - 0.08], [bb[3] + 0.05, bb[2] + 0.08]]);
    map.setMinZoom(10);
    var gen = meta.generated ? meta.generated.slice(0, 10).split('-').reverse().join('.') : '–';
    var inf = meta.infrastructure || {}, kc = inf.km_by_class || {};
    $('dataInfo').textContent = 'Date OpenStreetMap exportate la ' + gen + ': ' + fmt(meta.nodes) + ' noduri, ' + fmt(meta.edges) + ' segmente, ' +
      fmt(meta.pois) + ' facilități, parcări și stații. Piste pentru biciclete: ' + fmt(kc['pistă pentru biciclete'], 1) + ' km; străzi cu bandă / pistă: ' +
      fmt(inf.km_roads_with_bike_lane, 1) + ' km; străzi cu limită peste 50 km/h: ' + fmt(inf.km_roads_maxspeed_over_50, 1) + ' km (limita este etichetată pe ' +
      fmt(inf.km_roads_total ? inf.km_roads_maxspeed_tagged / inf.km_roads_total * 100 : null) + '% din străzi).' +
      (hasSlope() && meta.elevation ? ' Altitudini ' + fmt(meta.elevation.min_m) + '–' + fmt(meta.elevation.max_m) + ' m (Copernicus GLO-30).' : '');
    return loadZones().then(compute);
  }).catch(function (err) {
    console.error(err);
    statusEl.className = 'err';
    statusEl.textContent = 'Datele pentru Iași nu s-au putut încărca (' + err.message + '). Ele se generează cu scripts/export_micro15.py (vezi metodologia).';
  });
})();
