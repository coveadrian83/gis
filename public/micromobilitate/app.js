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

  var G = null, grid = null, POIS = null, poiMx = null, poiMy = null;
  var wsA = null, wsB = null, wsC = null;
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
      legal: $('legal').checked, slope: hasSlope() && $('slope').checked, vehicle: vehicle };
  }
  // timpii pe segmente pentru un vehicul (păstrați până se schimbă setările)
  function times(k, v0, legal, slope) {
    var key = k + '|' + v0.toFixed(4) + '|' + (legal ? 1 : 0) + '|' + (slope ? 1 : 0);
    if (!timesCache[key]) {
      if (Object.keys(timesCache).length > 24) timesCache = {};
      timesCache[key] = k === 'walk' ? M.walkTimes(G, WALK, slope) : M.edgeTimes(G, M.VEHICLES[k], { v0: v0, legal: legal, slope: slope });
    }
    return timesCache[key];
  }
  function profileFor(k, v0, legal, slope) { return M.coreProfile(times(k, v0, legal, slope), 1.2); }
  function describe(s) {
    return veh().name + ', ' + fmt(s.v0 * 3.6) + ' km/h' + (s.legal ? ', după Codul rutier' : ', fără restricții') + (s.slope ? ', cu pantă' : ', teren plat');
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
    var tm = times(vehicle, s.v0, s.legal, s.slope);
    var pA = profileFor(vehicle, s.v0, s.legal, s.slope), pF = profileFor(vehicle, s.v0, false, s.slope), pW = profileFor('walk', WALK, false, s.slope);
    var start = snap.dist / pA.access;
    var dA = C.dijkstra(G, snap.node, start, pA, T, wsA), dF = C.dijkstra(G, snap.node, start, pF, T, wsB);
    var rA = C.collectReach(G, dA, T, pA), rF = C.collectReach(G, dF, T, pF);
    var cA = C.countReach(POIS, dA, pA, T, true), cF = C.countReach(POIS, dF, pF, T, false);
    var dW = C.dijkstra(G, snap.node, start, pW, T, wsC), cW = C.countReach(POIS, dW, pW, T, false), rW = C.collectReach(G, dW, T, pW);
    state = { T: T, reachA: rA, reachF: rF, inA: cA.inside, dA: dA, tm: tm, legal: s.legal };
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
    var rows = C.AMENITY_CATS.map(function (c) {
      return '<tr><td><span class="dot" style="background:' + CAT_COLORS[c] + '"></span>' + POIS.cats[c] + '</td><td>' + cA.cats[c] + '</td><td>' + cF.cats[c] + '</td><td>' + cW.cats[c] + '</td></tr>';
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
      (s.legal ? '<div class="note">' + fmt(push) + '% din rețeaua atinsă se parcurge pe jos, cu vehiculul de mână (trotuare, zone pietonale, contrasens' + (veh().rules === 'scooter' ? ', străzi peste 50 km/h fără pistă' : '') + ').</div>' : '') +
      '<table><thead><tr><th></th><th>Vehicul</th><th>Fără restr.</th><th>Pe jos</th></tr></thead><tbody>' + rows +
      '<tr><td><b>Total facilități</b></td><td><b>' + cA.amen + '</b></td><td>' + cF.amen + '</td><td>' + cW.amen + '</td></tr>' + extra + '</tbody></table>' +
      '<div class="note">' + cA.present + ' din 5 categorii prezente. ' + (gain !== null ? 'De ' + fmt(gain, 1) + ' ori mai multe facilități decât pe jos (1,4 m/s)' : '') +
      (s.legal && lost > 0 ? '; regulile de circulație și lipsa pistelor reduc numărul cu ' + lost + '% față de varianta fără restricții.' : '.') + '</div>';
  }

  // același punct, toate vehiculele (cu regulile alese) și mersul pe jos
  function showCompare(snap, T, s) {
    var run = function (prof) {
      var d = C.dijkstra(G, snap.node, snap.dist / prof.access, prof, T, wsC);
      return C.countReach(POIS, d, prof, T, false);
    };
    var walk = run(profileFor('walk', WALK, false, s.slope));
    var rows = ['<tr><td>Pe jos (1,4 m/s)</td><td>' + walk.amen + '</td><td>1×</td><td>' + walk.cats[STATION] + '</td></tr>'];
    M.ORDER.forEach(function (k) {
      var v = M.VEHICLES[k], v0 = k === vehicle ? s.v0 : v.v0;
      [true, false].forEach(function (legal) {
        var r = run(profileFor(k, v0, legal, s.slope));
        var cur = k === vehicle && legal === s.legal;
        var cls = (cur ? 'cur ' : '') + (legal ? '' : 'free');
        rows.push('<tr' + (cls.trim() ? ' class="' + cls.trim() + '"' : '') + '><td>' + esc(v.name) + ' · ' + fmt(v0 * 3.6) + ' km/h' + (legal ? '' : ' <small>fără restricții</small>') +
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
    if (!state) return;
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
    if ($('showPush').checked && state.legal && pushed.length && z >= 13) {
      ctx.beginPath(); ctx.strokeStyle = '#15171a'; ctx.lineWidth = Math.max(1, width * 0.5); ctx.setLineDash([3, 4]);
      strokeEdges(ctx, X, Y, pushed); ctx.stroke(); ctx.setLineDash([]);
    }
    var showAm = $('showAm').checked, showSt = $('showSt').checked, showPark = $('showPark').checked;
    var pts = POIS.pts;
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
  }

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
    var ctx = { g: G, grid: grid, pois: POIS, ws: C.workspace(G) };
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
    $('zoneTable').innerHTML = '<thead><tr><th>Zona</th><th>Facilități<br>vehicul / ' + refName + '</th><th>Dif.</th><th>5/5</th><th>Stații</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var st = zoneStyle({ properties: { zone_id: r.zone_id } });
        return '<tr data-id="' + esc(r.zone_id) + '"><td><span class="sw" style="background:' + (st.fillColor || 'transparent') + '"></span>' + esc(r.zone_name) +
          '</td><td>' + fmt(r.amen_mean) + ' / ' + fmt(r.amen_mean_ref) + '</td><td>' + (r.gain_pct === null ? '–' : (r.gain_pct > 0 ? '+' : '') + fmt(r.gain_pct) + '%') +
          '</td><td>' + (r.full_share === null ? '–' : fmt(r.full_share) + '%') + '</td><td>' + fmt(r.stations_mean, 1) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  function zonesCsv() {
    var o = zoneResults;
    var head = ['zona_id', 'zona', 'vehicul', 'viteza_kmh', 'reguli', 'referinta', 'minute', 'puncte_analizate', 'facilitati_medie_vehicul',
      'facilitati_medie_referinta', 'diferenta_pct', 'facilitati_mediana', 'puncte_cu_toate_5_categorii_pct', 'statii_medie'];
    var num = function (v) { return v === null || v === undefined || !isFinite(v) ? '' : String(Math.round(v * 10) / 10); };
    var txt = function (v) { var t = String(v); return /[",;\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    var lines = [head.join(',')];
    o.rows.forEach(function (r) {
      lines.push([txt(r.zone_id), txt(r.zone_name), o.s.vehicle, num(o.s.v0 * 3.6), o.s.legal ? 'cod_rutier' : 'fara_restrictii',
        o.refKind === 'walk' ? 'pe_jos_1.4ms' : 'fara_restrictii', o.s.minutes, r.points, num(r.amen_mean), num(r.amen_mean_ref),
        num(r.gain_pct), num(r.amen_median), num(r.full_share), num(r.stations_mean)].join(','));
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

  // ---------------------------------------------------------------- link partajabil
  var hashTimer;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      var s = settings();
      var q = new URLSearchParams({ lat: origin.lat.toFixed(5), lng: origin.lng.toFixed(5), min: s.minutes, v: vehicle,
        kmh: $('speed').value, lg: s.legal ? 1 : 0, pa: $('slope').checked ? 1 : 0, z: map.getZoom() });
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
  ['legal', 'slope'].forEach(function (id) { $(id).addEventListener('change', schedule); });
  ['showAm', 'showSt', 'showPark', 'showPush', 'showInfra'].forEach(function (id) { $(id).addEventListener('change', draw); });
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
  Promise.all([getOk('meta.json', 'json'), getOk('graph.bin', 'arrayBuffer'), getOk('micro.bin', 'arrayBuffer'), getOk('pois.json', 'json'), elevReq]).then(function (res) {
    var meta = res[0];
    G = C.parseGraph(res[1]); grid = C.buildGrid(G);
    M.parseMicro(res[2], G);
    if (res[4]) {
      try { C.parseElev(res[4], G); $('slopeBox').hidden = false; }
      catch (err) { console.warn('Panta nu s-a putut încărca:', err); delete G.lfw; delete G.up; }
    }
    wsA = C.workspace(G); wsB = C.workspace(G); wsC = C.workspace(G);
    var pts = res[3].pts;
    POIS = { cats: res[3].cats, pts: pts, snap: C.snapPois(G, grid, pts) };
    poiMx = new Float64Array(pts.length); poiMy = new Float64Array(pts.length);
    pts.forEach(function (p, i) { var m = C.merc(p[0], p[1]); poiMx[i] = m[0]; poiMy[i] = m[1]; });
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
