/* „15 minute. Pentru cine?” – Iași. Interfața: harta, comenzile, statisticile și analiza pe zone.
 * Calculul este în core.js (Min15Core). Adaptat după https://github.com/martincantcode/15-minutes (licență MIT). */
(function () {
  'use strict';
  var C = window.Min15Core;
  var DATA_DIR = 'data/iasi/';
  var ZONES_URL = '../data/iasi_17_zone_mva_mvi.geojson';
  var REF = C.REF;
  var CAT_COLORS = ['#5b9a3c', '#d9534f', '#7b5ea7', '#2e8b57', '#e8a13a', '#8a5a2b', '#15171a'];
  // stații după eticheta OSM wheelchair: 0 fără etichetă, 1 da, 2 parțial, 3 nu
  var STATION_COLORS = ['#aaaaaa', '#2e8b57', '#e8a13a', '#555555'];
  var PALETTE = ['#0b4f6c', '#1f9e9a', '#9bc53d', '#f2c14e', '#e8743b'];   // timp de mers, aproape → departe
  var PROFILES = [
    { name: 'Adult (1,4 m/s)', speed: 1.4, avoid: false, maxGrade: 0 },
    { name: 'Mers lent (1,1 m/s)', speed: 1.1, avoid: false, maxGrade: 0 },
    { name: 'Lent, fără scări', speed: 1.1, avoid: true, maxGrade: 0 },
    { name: 'Mobilitate redusă (0,8 m/s, fără scări)', speed: 0.8, avoid: true, maxGrade: 0 },
    { name: 'Scaun rulant / cărucior (1,0 m/s, fără scări, ≤ 8%)', speed: 1.0, avoid: true, maxGrade: 8 },
    { name: 'Mers rapid (1,8 m/s)', speed: 1.8, avoid: false, maxGrade: 0 }
  ];
  var GRADE_CLASSES = [[5, '#f2c14e'], [8, '#e8743b'], [12, '#b3261e']];   // pantă ≥ prag → culoare

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $('status');
  var fmt = function (v, d) { return v === null || v === undefined || !isFinite(v) ? '–' : v.toLocaleString('ro-RO', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };

  // ---------------------------------------------------------------- harta
  var map = L.map('map', { zoomControl: true, maxZoom: 19 }).setView([47.16485, 27.58186], 14);
  map.createPane('zones').style.zIndex = 350;   // sub rețeaua colorată (overlayPane = 400)
  var baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contribuitorii OpenStreetMap</a>'
  }).addTo(map);
  var streetBase = false, tileErrors = 0;
  // Dacă harta de fundal nu se încarcă, se desenează chiar rețeaua de străzi ca fundal.
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

  var G = null, grid = null, POIS = null, META = null, poiMx = null, poiMy = null;
  var wsAdj = null, wsRef = null, wsCmp = null;
  var ZONES = null, zoneLayer = null, zoneResults = null, zoneRunning = false;
  var origin = L.latLng(47.16485, 27.58186), state = null, queued = false;
  var marker = L.marker(origin, { draggable: true }).addTo(map);

  // ---------------------------------------------------------------- utilitare
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

  function hasSlope() { return !!(G && G.lfw); }
  function settings() {
    var slope = hasSlope() && $('slope').checked;
    var prof = C.profile({ speed: +$('speed').value, avoid: $('steps').checked, slope: slope, maxGrade: hasSlope() ? +$('maxGrade').value : 0 });
    return { T: $('minutes').value * 60, minutes: +$('minutes').value, speed: prof.speed, avoid: prof.avoid, slope: prof.slope, maxGrade: prof.maxGrade, prof: prof };
  }
  function describe(p) {
    return p.speed.toFixed(2).replace('.', ',') + ' m/s' + (p.avoid ? ', fără scări' : ', cu scări') +
      (p.slope ? ', cu pantă' : ', teren plat') + (p.maxGrade ? ', pantă ≤ ' + p.maxGrade + '%' : '');
  }
  function labels() {
    var s = settings();
    $('minOut').textContent = s.minutes;
    $('legendEnd').textContent = s.minutes + ' min';
    $('spdOut').textContent = s.speed.toFixed(2).replace('.', ',') + ' m/s (' + (s.speed * 3.6).toFixed(1).replace('.', ',') + ' km/h)';
    Array.prototype.forEach.call(document.querySelectorAll('#profiles button'), function (b) {
      b.classList.toggle('on', Math.abs(+b.dataset.speed - s.speed) < 1e-6 && (b.dataset.avoid === '1') === s.avoid &&
        (!hasSlope() || +b.dataset.grade === s.maxGrade));
    });
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
    var dAdj = C.dijkstra(G, snap.node, snap.dist / s.speed, s.prof, T, wsAdj);
    var dRef = C.dijkstra(G, snap.node, snap.dist / REF.speed, REF, T, wsRef);
    var reachAdj = C.collectReach(G, dAdj, T, s.prof), reachRef = C.collectReach(G, dRef, T, REF);
    var cA = C.countReach(POIS, dAdj, s.prof, T, true), cR = C.countReach(POIS, dRef, REF, T, false);
    state = { T: T, speed: s.speed, avoid: s.avoid, prof: s.prof, reachAdj: reachAdj, reachRef: reachRef, inAdj: cA.inside, dAdj: dAdj };
    showStats(reachAdj, reachRef, cA, cR, snap);
    showCompare(snap, T, s);
    draw();
  }

  function showStats(rA, rR, cA, cR, snap) {
    var km = function (m) { return fmt(m / 1000, 1); };
    var pct = rR.lengthM > 0 ? Math.round((rA.lengthM / rR.lengthM - 1) * 100) : 0;
    var rows = C.AMENITY_CATS.map(function (c) {
      return '<tr><td><span class="dot" style="background:' + CAT_COLORS[c] + '"></span>' + POIS.cats[c] + '</td><td>' + cA.cats[c] + '</td><td>din ' + cR.cats[c] + '</td></tr>';
    }).join('');
    var perKm = rA.lengthM > 0 ? fmt(cA.amen / (rA.lengthM / 1000), 1) : '0';
    var ST = [[1, 'Fără trepte (wheelchair=yes)'], [2, 'Parțial'], [3, 'Cu trepte (wheelchair=no)'], [0, 'Fără etichetă']];
    var stRows = ST.map(function (x) {
      return '<tr><td><span class="dot st" style="background:' + STATION_COLORS[x[0]] + '"></span>' + x[1] + '</td><td>' + cA.stByWc[x[0]] + '</td><td>din ' + cR.stByWc[x[0]] + '</td></tr>';
    }).join('');
    var modes = [[2, 'tramvai'], [3, 'autobuz'], [1, 'tren']].map(function (m) {
      return cA.stByMode[m[0]] + ' ' + m[1] + ' (din ' + cR.stByMode[m[0]] + ')';
    }).join(' · ');
    var elev = hasSlope() ? '<div class="note">Altitudinea punctului: ' + fmt(G.ele[snap.node]) + ' m. Setări: ' + describe(state.prof) + '.</div>' : '';
    $('stats').innerHTML = elev +
      '<div><b>' + km(rA.lengthM) + ' km</b> de străzi accesibile (' + (pct >= 0 ? '+' : '') + pct + '% față de ipoteza clasică: ' + km(rR.lengthM) + ' km)</div>' +
      '<table>' + rows + '<tr><td><b>Total facilități</b></td><td><b>' + cA.amen + '</b></td><td>din ' + cR.amen + '</td></tr></table>' +
      '<div class="note">' + cA.present + ' din 5 categorii prezente, ' + perKm + ' facilități pe km de stradă accesibilă. Coloanele: setările dvs., apoi ipoteza clasică (1,4 m/s, teren plat, cu scări).</div>' +
      '<div style="margin-top:8px">Bănci de odihnă: <b>' + cA.cats[C.BENCH] + '</b> din ' + cR.cats[C.BENCH] + '</div>' +
      '<div style="margin-top:10px"><b>Stații de transport public</b>: ' + cA.cats[C.STATION] + ' din ' + cR.cats[C.STATION] + '</div>' +
      '<div class="note">' + modes + '</div>' +
      '<table>' + stRows + '</table>' +
      '<div class="note">' + (state.avoid ? 'Cu evitarea scărilor, doar stațiile marcate fără trepte contează ca utilizabile (' + cA.stUsable + '); celelalte apar estompate.' : 'Bifați „Evită scările” pentru a estompa stațiile care nu sunt marcate fără trepte.') + ' Multe stații din Iași nu au încă eticheta în OpenStreetMap.</div>';
  }

  // același punct, toate profilurile predefinite – comparația din postarea originală, plus panta
  function showCompare(snap, T, s) {
    var run = function (p) {
      var d = C.dijkstra(G, snap.node, snap.dist / p.speed, p, T, wsCmp);
      return C.countReach(POIS, d, p, T, false);
    };
    var list = [{ name: 'Ipoteza clasică (1,4 m/s, plat, cu scări)', prof: REF }].concat(PROFILES.map(function (p) {
      return { name: p.name, prof: C.profile({ speed: p.speed, avoid: p.avoid, slope: s.slope, maxGrade: hasSlope() ? p.maxGrade : 0 }) };
    }));
    var ref = null;
    var rows = list.map(function (x, i) {
      var r = run(x.prof);
      if (i === 0) ref = r;
      var cur = i > 0 && C.sameProfile(x.prof, s.prof);
      var rel = ref.amen ? Math.round(r.amen / ref.amen * 100) + '%' : '–';
      return '<tr' + (cur ? ' class="cur"' : '') + '><td>' + x.name + '</td><td>' + r.amen + '</td><td>' + rel + '</td><td>' + r.stUsable + '</td></tr>';
    }).join('');
    $('compare').innerHTML = '<h3>Același punct, ' + (T / 60) + ' minute, alte profiluri' + (s.slope ? ', cu pantă' : '') + '</h3>' +
      '<table><thead><tr><th>Profil</th><th>Facilități</th><th>vs. clasic</th><th>Stații*</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="note">* stații utilizabile: fără scări contează doar cele marcate wheelchair=yes.' +
      (s.slope ? ' Profilurile folosesc panta; prima linie este ipoteza clasică, pe teren plat.' : '') + '</div>';
  }

  function showZoneHere() {
    if (!ZONES) { $('zoneHere').textContent = ''; return; }
    var f = ZONES.features.filter(function (z) { return C.pointInGeometry(z.geometry, origin.lng, origin.lat); })[0];
    $('zoneHere').innerHTML = f ? 'Punctul este în zona <b>' + esc(f.properties.zone_name) + '</b> (' + esc(f.properties.zone_id) + ').' : 'Punctul este în afara celor 17 zone MVA–MVI.';
  }
  function esc(s) { return String(s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------------------------------------------------------------- desenare
  function drawStreetBase(ctx, X, Y, S, tl, size) {
    var x0 = tl.x / S, x1 = (tl.x + size.x) / S, y0 = tl.y / S, y1 = (tl.y + size.y) / S;
    ctx.beginPath(); ctx.strokeStyle = 'rgba(110,110,110,0.35)'; ctx.lineWidth = 1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var e = 0; e < G.nE; e++) {
      var u = G.eu[e], v = G.ev[e], ux = G.mx[u], uy = G.my[u], vx = G.mx[v], vy = G.my[v];
      if ((ux < x0 && vx < x0) || (ux > x1 && vx > x1) || (uy < y0 && vy < y0) || (uy > y1 && vy > y1)) continue;
      var p = C.edgePath(G, e, false);
      ctx.moveTo(X(p[0]), Y(p[1]));
      for (var i = 2; i < p.length; i += 2) ctx.lineTo(X(p[i]), Y(p[i + 1]));
    }
    ctx.stroke();
  }

  // panta străzilor din imagine, ca un contur colorat sub rețeaua accesibilă (doar ≥ 5 %)
  function drawGrades(ctx, X, Y, S, tl, size, z) {
    var x0 = tl.x / S, x1 = (tl.x + size.x) / S, y0 = tl.y / S, y1 = (tl.y + size.y) / S;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(4, Math.min(9, 3 + (z - 12) * 1.2));
    for (var k = 0; k < GRADE_CLASSES.length; k++) {
      var lo = GRADE_CLASSES[k][0], hi = k + 1 < GRADE_CLASSES.length ? GRADE_CLASSES[k + 1][0] : C.STAIRS_GRADE;
      ctx.beginPath(); ctx.strokeStyle = GRADE_CLASSES[k][1]; ctx.globalAlpha = 0.55;
      for (var e = 0; e < G.nE; e++) {
        var gr = G.grd[e];
        if (gr < lo || gr >= hi) continue;
        var u = G.eu[e], v = G.ev[e], ux = G.mx[u], uy = G.my[u], vx = G.mx[v], vy = G.my[v];
        if ((ux < x0 && vx < x0) || (ux > x1 && vx > x1) || (uy < y0 && vy < y0) || (uy > y1 && vy > y1)) continue;
        var p = C.edgePath(G, e, false);
        ctx.moveTo(X(p[0]), Y(p[1]));
        for (var i = 2; i < p.length; i += 2) ctx.lineTo(X(p[i]), Y(p[i + 1]));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    var size = map.getSize(), dpr = window.devicePixelRatio || 1;
    canvas.width = size.x * dpr; canvas.height = size.y * dpr;
    canvas.style.width = size.x + 'px'; canvas.style.height = size.y + 'px';
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    $('rampHint').hidden = true;
    if (!G) return;

    var z = map.getZoom(), S = 256 * Math.pow(2, z), tl = map.getPixelBounds().min;
    var X = function (v) { return v * S - tl.x; }, Y = function (v) { return v * S - tl.y; };
    if (streetBase && z >= 12) drawStreetBase(ctx, X, Y, S, tl, size);
    if (hasSlope() && $('showGrade').checked && z >= 13) drawGrades(ctx, X, Y, S, tl, size, z);
    if (!state) return;
    var width = Math.max(1.5, Math.min(5, 1.2 + (z - 12) * 0.5));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var trace = function (it) {
      var pts = C.edgePath(G, it.e, !it.fromLow);
      if (it.frac < 1) pts = C.cutPath(pts, it.frac);
      ctx.moveTo(X(pts[0]), Y(pts[1]));
      for (var i = 2; i < pts.length; i += 2) ctx.lineTo(X(pts[i]), Y(pts[i + 1]));
    };
    // referința în gri, doar acolo unde setările curente nu ajung
    var adjFrac = new Map(state.reachAdj.items.map(function (it) { return [it.e, it.frac]; }));
    ctx.beginPath(); ctx.strokeStyle = 'rgba(90,90,90,0.5)'; ctx.lineWidth = Math.max(1, width * 0.7);
    state.reachRef.items.forEach(function (it) { if ((adjFrac.get(it.e) || 0) < it.frac - 1e-6) trace(it); });
    ctx.stroke();
    var bins = []; for (var b = 0; b < NB; b++) bins.push([]);
    state.reachAdj.items.forEach(function (it) { bins[Math.min(NB - 1, Math.floor(it.tt * NB))].push(it); });
    ctx.lineWidth = width;
    bins.forEach(function (list, k) {
      if (!list.length) return;
      ctx.beginPath(); ctx.strokeStyle = BIN_COLORS[k];
      list.forEach(trace);
      ctx.stroke();
    });

    // scările de lângă zona accesibilă: unde evitarea scărilor taie un traseu
    if ($('showSteps').checked && z >= 13) {
      var x0 = tl.x / S, x1 = (tl.x + size.x) / S, y0 = tl.y / S, y1 = (tl.y + size.y) / S;
      var strokeSteps = function (flagBit, color) {
        var drawn = 0;
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(2.5, width + 1);
        for (var e = 0; e < G.nE; e++) {
          if (!(G.eflag[e] & flagBit)) continue;
          var u = G.eu[e], v = G.ev[e];
          if (!(state.dAdj[u] <= state.T || state.dAdj[v] <= state.T)) continue;
          var ux = G.mx[u], uy = G.my[u], vx = G.mx[v], vy = G.my[v];
          if ((ux < x0 && vx < x0) || (ux > x1 && vx > x1) || (uy < y0 && vy < y0) || (uy > y1 && vy > y1)) continue;
          var pth = C.edgePath(G, e, false);
          ctx.moveTo(X(pth[0]), Y(pth[1]));
          for (var i = 2; i < pth.length; i += 2) ctx.lineTo(X(pth[i]), Y(pth[i + 1]));
          drawn++;
        }
        ctx.stroke();
        return drawn;
      };
      strokeSteps(1, '#c1272d');
      if (strokeSteps(2, '#e8a13a') > 0) $('rampHint').hidden = false;
    }
    var showAm = $('showAm').checked, showSt = $('showSt').checked, showBn = $('showBn').checked;
    var pts = POIS.pts;
    for (var i = 0; i < pts.length; i++) {
      if (!state.inAdj[i]) continue;
      var c = pts[i][2];
      if (c === C.STATION) {
        if (!showSt) continue;
        var wc = pts[i][3];
        ctx.globalAlpha = C.stationUsable(pts[i], state.avoid) ? 1 : 0.35;
        ctx.beginPath(); ctx.arc(X(poiMx[i]), Y(poiMy[i]), pts[i][4] === 3 ? 5 : 7, 0, 6.2832);
        ctx.fillStyle = STATION_COLORS[wc]; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#15171a'; ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (c === C.BENCH ? showBn : showAm) {
        ctx.beginPath(); ctx.arc(X(poiMx[i]), Y(poiMy[i]), c === C.BENCH ? 2.2 : 3, 0, 6.2832);
        ctx.fillStyle = CAT_COLORS[c]; ctx.globalAlpha = 0.9; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  // ---------------------------------------------------------------- zonele MVA–MVI
  var METRICS = {
    amen_mean: { label: 'facilități medii', pal: ['#f1f7f4', '#9bd0b8', '#1f9e9a', '#0b4f6c'], d: 0 },
    loss_pct: { label: 'pierdere (%)', pal: ['#fff5eb', '#fdbe85', '#e8743b', '#a63603'], d: 0 },
    full_share: { label: 'puncte 5/5 (%)', pal: ['#f1f7f4', '#9bd0b8', '#1f9e9a', '#0b4f6c'], d: 0 },
    stations_mean: { label: 'stații medii', pal: ['#f3f0f7', '#bcb0d8', '#7b5ea7', '#3f2a6b'], d: 1 }
  };
  function zoneStyle(f) {
    var base = { pane: 'zones', color: '#3a3a3a', weight: 1.2, opacity: 0.7, dashArray: '4 3', fillOpacity: 0 };
    if (!zoneResults) return base;
    var r = zoneResults.byId[f.properties.zone_id], m = METRICS[$('metric').value], v = r && r[$('metric').value];
    if (v === null || v === undefined) return base;
    var rng = zoneResults.range[$('metric').value];
    var t = rng[1] > rng[0] ? (v - rng[0]) / (rng[1] - rng[0]) : 0.5;
    base.fillColor = colorAt(t, m.pal); base.fillOpacity = 0.45;
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
    var s = settings(), opts = {
      minutes: s.minutes, profile: s.prof,
      spacing: +$('spacing').value, maxPoints: +$('maxPoints').value, maxSnap: 150
    };
    var ctx = { g: G, grid: grid, pois: POIS, ws: C.workspace(G) };
    var rows = [], feats = ZONES.features.slice(), i = 0, t0 = Date.now();
    $('runZones').disabled = true; $('csvZones').disabled = true;
    (function step() {
      if (i >= feats.length) { finish(); return; }
      $('zonesStatus').textContent = 'Se calculează zona ' + (i + 1) + ' din ' + feats.length + ' (' + feats[i].properties.zone_name + ')…';
      setTimeout(function () {
        rows.push(C.analyzeZone(ctx, feats[i], opts));
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
      zoneResults = { rows: rows, byId: byId, range: range, opts: opts };
      var pts = rows.reduce(function (a, r) { return a + r.points; }, 0);
      $('zonesStatus').textContent = 'Calculat în ' + fmt((Date.now() - t0) / 1000, 1) + ' s: ' + pts + ' puncte, ' + opts.minutes + ' min, ' +
        describe(opts.profile) + ', grilă ' + opts.spacing + ' m; comparat cu ipoteza clasică.';
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
      return key === 'loss_pct' ? vb - va : va - vb;   // cele mai slab deservite zone primele
    });
    $('zoneTable').innerHTML = '<thead><tr><th>Zona</th><th>Facilități<br>profil / ref.</th><th>Pierdere</th><th>5/5</th><th>Stații</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var st = zoneStyle({ properties: { zone_id: r.zone_id } });
        return '<tr data-id="' + esc(r.zone_id) + '"><td><span class="sw" style="background:' + (st.fillColor || 'transparent') + '"></span>' + esc(r.zone_name) +
          '</td><td>' + fmt(r.amen_mean) + ' / ' + fmt(r.amen_mean_ref) + '</td><td>' + (r.loss_pct === null ? '–' : fmt(r.loss_pct) + '%') +
          '</td><td>' + (r.full_share === null ? '–' : fmt(r.full_share) + '%') + '</td><td>' + fmt(r.stations_mean, 1) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  $('zoneTable').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-id]');
    if (!tr || !ZONES) return;
    var f = ZONES.features.filter(function (z) { return z.properties.zone_id === tr.dataset.id; })[0];
    if (f) map.fitBounds(f._bounds, { padding: [20, 20] });
  });
  $('csvZones').addEventListener('click', function () {
    if (!zoneResults) return;
    var o = zoneResults.opts;
    var blob = new Blob(['﻿' + C.zonesCsv(zoneResults.rows, POIS.cats)], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'iasi_15min_zone_' + o.minutes + 'min_' + o.profile.speed.toFixed(2) + 'ms' + (o.profile.avoid ? '_fara_scari' : '') +
      (o.profile.slope ? '_panta' : '') + (o.profile.maxGrade ? '_max' + o.profile.maxGrade : '') + '_grila' + o.spacing + 'm.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  $('runZones').addEventListener('click', runZones);
  $('metric').addEventListener('change', renderZones);
  $('showZones').addEventListener('change', function () {
    if (!zoneLayer) return;
    if ($('showZones').checked) zoneLayer.addTo(map); else map.removeLayer(zoneLayer);
  });

  // ---------------------------------------------------------------- link partajabil (setările după #)
  var hashTimer;
  function writeHash() {
    clearTimeout(hashTimer);
    hashTimer = setTimeout(function () {
      var s = settings();
      var q = new URLSearchParams({ lat: origin.lat.toFixed(5), lng: origin.lng.toFixed(5), min: s.minutes,
        spd: s.speed, st: s.avoid ? 1 : 0, pa: $('slope').checked ? 1 : 0, pm: $('maxGrade').value, z: map.getZoom() });
      try { history.replaceState(null, '', '#' + q.toString()); } catch (e) { /* unele browsere limitează */ }
    }, 300);
  }
  function applyHash(meta) {
    var q = new URLSearchParams(location.hash.slice(1));
    var num = function (k, lo, hi) { var v = parseFloat(q.get(k)); return isFinite(v) && v >= lo && v <= hi ? v : null; };
    var bb = meta.bbox, lat = num('lat', bb[1], bb[3]), lng = num('lng', bb[0], bb[2]), had = false;
    if (lat !== null && lng !== null) { origin = L.latLng(lat, lng); had = true; }
    var m = num('min', 5, 30); if (m !== null) $('minutes').value = Math.round(m);
    var sp = num('spd', 0.8, 1.8); if (sp !== null) $('speed').value = sp;
    if (q.get('st') === '1') $('steps').checked = true;
    if (q.get('pa') === '0') $('slope').checked = false;
    if (q.get('pm') && document.querySelector('#maxGrade option[value="' + parseInt(q.get('pm'), 10) + '"]')) $('maxGrade').value = String(parseInt(q.get('pm'), 10));
    labels();
    var z = num('z', 10, 19);
    return { zoom: z !== null ? z : 14, hadOrigin: had };
  }
  $('copyLink').addEventListener('click', function () {
    var done = function (msg) { $('copyMsg').textContent = msg; setTimeout(function () { $('copyMsg').textContent = ''; }, 3000); };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(function () { done('Link copiat.'); }, function () { done('Copiați adresa din bara browserului.'); });
    else done('Copiați adresa din bara browserului.');
  });

  // ---------------------------------------------------------------- evenimente
  ['minutes', 'speed'].forEach(function (id) { $(id).addEventListener('input', schedule); });
  ['steps', 'slope', 'maxGrade'].forEach(function (id) { $(id).addEventListener('change', schedule); });
  ['showAm', 'showSt', 'showBn', 'showSteps', 'showGrade'].forEach(function (id) { $(id).addEventListener('change', draw); });
  $('profiles').addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    $('speed').value = b.dataset.speed; $('steps').checked = b.dataset.avoid === '1';
    if (hasSlope()) $('maxGrade').value = b.dataset.grade || '0';
    schedule();
  });
  map.on('click', function (e) { origin = e.latlng; marker.setLatLng(origin); schedule(); });
  marker.on('drag', function () { origin = marker.getLatLng(); schedule(); });
  map.on('moveend resize zoomend', draw);

  // ---------------------------------------------------------------- încărcare
  function getOk(url, kind) {
    return fetch(DATA_DIR + url).then(function (r) { if (!r.ok) throw new Error(url + ' lipsește (' + r.status + ')'); return r[kind](); });
  }
  labels();
  // panta este opțională: fără elev.bin pagina funcționează ca originalul, pe teren plat
  var elevReq = fetch(DATA_DIR + 'elev.bin').then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; });
  Promise.all([getOk('meta.json', 'json'), getOk('graph.bin', 'arrayBuffer'), getOk('pois.json', 'json'), elevReq]).then(function (res) {
    var meta = res[0];
    META = meta;
    G = C.parseGraph(res[1]); grid = C.buildGrid(G);
    if (res[3]) {
      try { C.parseElev(res[3], G); $('slopeBox').hidden = false; $('gradeToggle').hidden = false; }
      catch (err) { console.warn('Panta nu s-a putut încărca:', err); delete G.lfw; }
    }
    wsAdj = C.workspace(G); wsRef = C.workspace(G); wsCmp = C.workspace(G);
    var pts = res[2].pts, snapped = C.snapPois(G, grid, pts);
    POIS = { cats: res[2].cats, pts: pts, snap: snapped };
    poiMx = new Float64Array(pts.length); poiMy = new Float64Array(pts.length);
    pts.forEach(function (p, i) { var m = C.merc(p[0], p[1]); poiMx[i] = m[0]; poiMy[i] = m[1]; });
    origin = L.latLng(meta.start[0], meta.start[1]);
    var h = applyHash(meta);
    if (!h.hadOrigin) {   // punctul de pornire poate cădea într-un parc: îl mutăm pe cea mai apropiată stradă
      var near = C.nearestNode(G, grid, origin.lng, origin.lat, 12);
      if (near.node >= 0) origin = L.latLng(G.lat[near.node], G.lon[near.node]);
    }
    marker.setLatLng(origin);
    map.setView(origin, h.zoom);
    var bb = meta.bbox;
    map.setMaxBounds([[bb[1] - 0.05, bb[0] - 0.08], [bb[3] + 0.05, bb[2] + 0.08]]);
    map.setMinZoom(10);
    var gen = meta.generated ? meta.generated.slice(0, 10).split('-').reverse().join('.') : '–';
    $('dataInfo').textContent = 'Date OpenStreetMap exportate la ' + gen + ': ' + fmt(meta.nodes) + ' noduri, ' + fmt(meta.edges) +
      ' segmente de stradă, ' + fmt(meta.pois) + ' facilități și stații' + (meta.steps !== undefined ? ', ' + fmt(meta.steps) + ' scări cartografiate' : '') + '.' +
      (hasSlope() && meta.elevation ? ' Altitudini ' + fmt(meta.elevation.min_m) + '–' + fmt(meta.elevation.max_m) + ' m (Copernicus GLO-30).' : '');
    return loadZones().then(compute);
  }).catch(function (err) {
    console.error(err);
    statusEl.className = 'err';
    statusEl.textContent = 'Datele pentru Iași nu s-au putut încărca (' + err.message + '). Ele se generează cu scripts/export_15min.py (vezi metodologia).';
  });
})();
