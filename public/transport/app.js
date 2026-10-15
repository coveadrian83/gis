/* Transport public – Iași și Zona Metropolitană: traseele liniilor CTP și titlurile de călătorie vândute în comunele ZMI,
 * lună de lună. Date: ../data/transport/titluri_zm.json (scripts/transport_titluri.py), linii.geojson și statii.geojson
 * (scripts/transport_linii.py, opționale), statii_aglomerate.json, ../data/zmi_uat_web.geojson. */
(function () {
  'use strict';
  var D = '../data/transport/';
  var CATS = [['bilete', 'Bilete', '--s-bilete'], ['abonamente', 'Abonamente', '--s-abonamente'], ['elevi', 'Elevi și studenți', '--s-elevi']];
  var LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
  var LUNI_SCURT = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  var RMAX = innerWidth < 760 ? 26 : 42;   // raza cercului celei mai mari valori (px)

  var css = getComputedStyle(document.documentElement);
  function cssv(n) { return css.getPropertyValue(n).trim(); }
  var COLOR = {}; CATS.forEach(function (c) { COLOR[c[0]] = cssv(c[2]); });
  var TRAM = cssv('--tram'), BUS = cssv('--bus'), METRO = cssv('--metro'), HOT = cssv('--hot');

  var S = { metric: 1, cat: 'all', rep: true, mi: 0, year: false, sel: null, line: null, stop: null, playing: null, width: 'gtfs', day: 'lucru' };
  var SERV = null;   // orarul GTFS: serviciul pe linie și pe stație (gtfs_servicii.json)
  var T = null, UATS = [], CENTER = {}, MONTHS = [], HOTS = null, TOP = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmt(v) {
    if (v == null) return '–';
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString('ro-RO', { maximumFractionDigits: 2 }) + ' mil.';
    if (a >= 1e4) return Math.round(v / 1e3).toLocaleString('ro-RO') + ' mii';
    return Math.round(v).toLocaleString('ro-RO');
  }
  function fmtAxis(v) { return v >= 1e6 ? (v / 1e6).toLocaleString('ro-RO', { maximumFractionDigits: 1 }) + 'M' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : String(v); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[şș]/g, 's').replace(/[ţț]/g, 't').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function label(i) { var m = MONTHS[i]; return S.year ? m.slice(0, 4) : LUNI[+m.slice(5) - 1] + ' ' + m.slice(0, 4); }
  function cats() { return S.cat === 'all' ? CATS.map(function (c) { return c[0]; }) : [S.cat]; }

  // ---------- valori ----------
  // valoarea unei comune într-o lună pentru o categorie (null = comuna nu e în centralizatorul anului)
  function monthCat(u, i, cat) {
    var d = u.s['d_' + cat][S.metric][i];
    if (d == null) return null;
    return d + (S.rep ? u.s['r_' + cat][S.metric][i] || 0 : 0);
  }
  function monthVal(u, i) {
    var t = null;
    cats().forEach(function (c) { var v = monthCat(u, i, c); if (v != null) t = (t || 0) + v; });
    return t;
  }
  // perioada curentă: luna i sau anul lunii i
  function range(i) { if (!S.year) return [i]; var s = i - (i % 12), r = []; for (var k = s; k < s + 12 && k < MONTHS.length; k++) r.push(k); return r; }
  function val(u, i) {
    var t = null;
    range(i).forEach(function (k) { var v = monthVal(u, k); if (v != null) t = (t || 0) + v; });
    return t;
  }
  function total(i) { var t = null; UATS.forEach(function (u) { var v = val(u, i); if (v != null) t = (t || 0) + v; }); return t; }
  function prevYear(i) { return i - 12 >= 0 ? i - 12 : null; }
  function maxVal() {   // maximul pe toate perioadele, ca să se poată compara lunile/anii între ei în animație
    var m = 0, step = S.year ? 12 : 1;
    for (var i = 0; i < MONTHS.length; i += step) UATS.forEach(function (u) { m = Math.max(m, val(u, i) || 0); });
    return m || 1;
  }
  function delta(cur, prev) {
    if (cur == null || prev == null || !prev) return '';
    var p = (cur / prev - 1) * 100;
    return '<span class="' + (p >= 0 ? 'up' : 'down') + '">' + (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + '%</span>';
  }

  // ---------- harta ----------
  var map = L.map('map', { maxZoom: 18, zoomSnap: 0.5 }).setView([47.16, 27.62], 11);
  var ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · CTP Iași';
  var bases = {
    'Întunecat': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'basemap', attribution: ATTR }),
    'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'basemap-osm', attribution: ATTR })
  };
  var baseName = 'Întunecat';
  try { if (bases[localStorage.getItem('transport.base')]) baseName = localStorage.getItem('transport.base'); } catch (e) { /* fără stocare */ }
  bases[baseName].addTo(map);
  document.body.classList.toggle('light', baseName === 'OpenStreetMap');
  L.control.layers(bases, null, { position: 'topright' }).addTo(map);
  map.on('baselayerchange', function (e) {
    document.body.classList.toggle('light', e.name === 'OpenStreetMap');
    try { localStorage.setItem('transport.base', e.name); } catch (er) { /* fără stocare */ }
  });
  map.createPane('uat'); map.getPane('uat').style.zIndex = 350;
  map.createPane('halo'); map.getPane('halo').style.zIndex = 390; map.getPane('halo').style.pointerEvents = 'none';
  map.createPane('lines'); map.getPane('lines').style.zIndex = 400;
  map.createPane('bubbles'); map.getPane('bubbles').style.zIndex = 450;
  map.createPane('hot'); map.getPane('hot').style.zIndex = 620;
  var haloLayer = L.layerGroup().addTo(map), proposedLayer = L.layerGroup(), busStopLayer = L.layerGroup().addTo(map), tramStopLayer = L.layerGroup().addTo(map), gtfsStopLayer = L.layerGroup().addTo(map), uatLayer = L.layerGroup().addTo(map), lineLayer = L.layerGroup().addTo(map), stopLayer = L.layerGroup(),
    hotLayer = L.layerGroup().addTo(map), bubbleLayer = L.layerGroup().addTo(map), extraLayer = L.layerGroup().addTo(map);
  var bubbles = {};
  // etichetele stațiilor aglomerate se suprapun sub zoom 13
  function zoomClass() { map.getContainer().classList.toggle('z-lo', map.getZoom() < 13); }
  map.on('zoomend', zoomClass); zoomClass();

  // punctul reprezentativ al unei comune: centroidul inelului exterior cel mai mare
  function centroid(g) {
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates, best = null, bestA = 0;
    polys.forEach(function (p) {
      var r = p[0], a = 0, x = 0, y = 0;
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f;
      }
      if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [y / (3 * a), x / (3 * a)]; }
    });
    return best;
  }

  function drawUat(geo) {
    L.geoJSON(geo, {
      pane: 'uat',
      style: function (f) {
        var has = T.uat[f.properties.siruta_uat], iasi = f.properties.zmi_role === 'municipiu_pol';
        return { color: iasi ? '#8f8e86' : '#55554f', weight: iasi ? 1.6 : 0.8, fillColor: '#f0efec', fillOpacity: has ? 0.04 : 0, dashArray: has || iasi ? null : '2 4' };
      },
      onEachFeature: function (f, l) {
        var p = f.properties;
        if (T.uat[p.siruta_uat]) {
          l.on('click', function () { select(p.siruta_uat); });
        } else {
          l.bindTooltip(esc(p.canonical_name || p.name) + (p.zmi_role === 'municipiu_pol' ? '' : ' – fără date CTP'), { sticky: true });
        }
      }
    }).addTo(uatLayer);
    geo.features.forEach(function (f) { CENTER[f.properties.siruta_uat] = centroid(f.geometry); });
  }

  function drawBubbles() {
    var mx = maxVal();
    UATS.forEach(function (u) {
      var v = val(u, S.mi), c = CENTER[u.siruta];
      if (!c) return;
      var b = bubbles[u.siruta];
      if (!b) {
        b = bubbles[u.siruta] = L.circleMarker(c, { pane: 'bubbles', className: 'bubble', weight: 1.5 }).addTo(bubbleLayer);
        b.bindTooltip(esc(u.name), { permanent: true, direction: 'center', className: 'lbl-uat', pane: 'bubbles' });
        b.on('click', function () { select(u.siruta); });
        b.on('mouseover', function (e) { showTip(e.originalEvent, tipUat(u)); });
        b.on('mousemove', function (e) { moveTip(e.originalEvent); });
        b.on('mouseout', hideTip);
      }
      var col = S.cat === 'all' ? '#f0efec' : COLOR[S.cat], sel = S.sel === u.siruta;
      b.setRadius(v ? Math.max(3, Math.sqrt(v / mx) * RMAX) : 3);
      b.setStyle({ color: sel ? cssv('--accent') : col, weight: sel ? 3 : 1.5, fillColor: col, fillOpacity: v == null ? 0 : 0.35, opacity: v == null ? 0.35 : 0.95, dashArray: v == null ? '2 3' : null });
    });
  }

  function tipUat(u) {
    var h = '<b>' + esc(u.name) + '</b> · ' + esc(label(S.mi)) + '<br>';
    var tot = val(u, S.mi);
    if (tot == null) return h + '<span class="note">Fără date în această perioadă</span>';
    cats().forEach(function (c) {
      var t = null; range(S.mi).forEach(function (k) { var v = monthCat(u, k, c); if (v != null) t = (t || 0) + v; });
      var cn = CATS.filter(function (x) { return x[0] === c; })[0][1];
      h += '<div class="row"><span><i class="sw" style="background:' + COLOR[c] + '"></i>' + cn + '</span><span>' + fmt(t) + '</span></div>';
    });
    var pi = prevYear(S.mi);
    h += '<div class="row"><span>Total</span><b>' + fmt(tot) + '</b></div>';
    if (pi != null) h += '<div class="row"><span>față de anul anterior</span><span>' + (delta(tot, val(u, pi)) || '–') + '</span></div>';
    return h;
  }

  // ---------- tooltip comun (hartă și grafic) ----------
  var tip = $('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.hidden = false; moveTip(e); }
  function moveTip(e) {
    var x = e.clientX + 14, y = e.clientY + 14, w = tip.offsetWidth, h = tip.offsetHeight;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.hidden = true; }

  // ---------- panou ----------
  function renderKpis() {
    var cur = total(S.mi), pi = prevYear(S.mi), prev = pi != null ? total(pi) : null, n = 0;
    UATS.forEach(function (u) { if (val(u, S.mi) != null) n++; });
    var unit = S.metric ? 'călătorii estimate' : 'titluri vândute';
    var top = UATS.slice().sort(function (a, b) { return (val(b, S.mi) || 0) - (val(a, S.mi) || 0); })[0];
    $('kpis').innerHTML =
      '<div><b>' + fmt(cur) + '</b><small>' + unit + ' în ZMI · ' + esc(label(S.mi)) + '</small></div>' +
      '<div><b>' + (delta(cur, prev) || '–') + '</b><small>față de ' + (pi != null ? esc(label(pi)) : 'anul anterior (fără date)') + '</small></div>' +
      '<div><b>' + n + '</b><small>comune cu date CTP</small></div>' +
      '<div><b>' + esc(top ? top.name : '–') + '</b><small>cea mai mare valoare</small></div>';
  }

  function renderRank() {
    var mx = 0, rows = UATS.map(function (u) { var v = val(u, S.mi); mx = Math.max(mx, v || 0); return [u, v]; });
    rows.sort(function (a, b) { return (b[1] == null ? -1 : b[1]) - (a[1] == null ? -1 : a[1]); });
    var pi = prevYear(S.mi);
    $('rank').innerHTML = rows.map(function (r) {
      var u = r[0], v = r[1];
      return '<div class="r' + (S.sel === u.siruta ? ' sel' : '') + (v == null ? ' na' : '') + '" data-s="' + u.siruta + '">' +
        '<span>' + esc(u.name) + '</span><span class="track"><div class="fill" style="width:' + (v ? Math.max(1, v / (mx || 1) * 100) : 0) + '%"></div></span>' +
        '<span class="v">' + fmt(v) + '</span><span class="d">' + (pi != null ? delta(v, val(u, pi)) : '') + '</span></div>';
    }).join('');
    Array.prototype.forEach.call($('rank').querySelectorAll('.r'), function (el) {
      el.addEventListener('click', function () { select(el.getAttribute('data-s')); });
    });
  }

  // grafic: bare stivuite pe categorii, pe luni (sau ani), pentru comuna aleasă sau pentru toată ZMI
  function renderChart() {
    var u = S.sel && T.uat[S.sel], list = u ? [u] : UATS, cs = cats();
    $('chartTitle').textContent = (u ? u.name : 'Zona Metropolitană') + ' – ' + (S.year ? 'pe ani' : 'pe luni');
    $('legend').innerHTML = cs.length > 1 ? cs.map(function (c) {
      return '<span><i class="sw" style="background:' + COLOR[c] + '"></i>' + CATS.filter(function (x) { return x[0] === c; })[0][1] + '</span>';
    }).join('') : '';
    var periods = [];
    if (S.year) for (var y = 0; y < MONTHS.length; y += 12) periods.push(y); else for (var i = 0; i < MONTHS.length; i++) periods.push(i);
    var data = periods.map(function (p) {
      var parts = cs.map(function (c) {
        var t = null;
        range(p).forEach(function (k) { list.forEach(function (x) { var v = monthCat(x, k, c); if (v != null) t = (t || 0) + v; }); });
        return t;
      });
      return { p: p, parts: parts, sum: parts.reduce(function (a, b) { return a + (b || 0); }, 0), na: parts.every(function (x) { return x == null; }) };
    });
    var W = 380, H = 170, L0 = 34, B = 18, top = 8;
    var mx = Math.max.apply(null, data.map(function (d) { return d.sum; })) || 1;
    var step = Math.pow(10, Math.floor(Math.log10(mx))), nice = [1, 2, 2.5, 5, 10].map(function (k) { return k * step; }).filter(function (s) { return mx / s <= 5; })[0] || step * 10;
    var ymax = Math.ceil(mx / nice) * nice, bw = (W - L0) / data.length, gap = Math.min(2, bw * 0.25);
    var cur = S.year ? S.mi - (S.mi % 12) : S.mi;
    function yy(v) { return top + (H - top - B) * (1 - v / ymax); }
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc($('chartTitle').textContent) + '">';
    for (var g = 0; g <= ymax + 1e-9; g += nice) s += '<line class="grid" x1="' + L0 + '" x2="' + W + '" y1="' + yy(g) + '" y2="' + yy(g) + '"/><text x="' + (L0 - 4) + '" y="' + (yy(g) + 3) + '" text-anchor="end">' + fmtAxis(g) + '</text>';
    data.forEach(function (d, k) {
      var x = L0 + k * bw + gap / 2, w = Math.max(1, bw - gap), base = 0, op = d.p === cur ? 1 : 0.45;
      d.parts.forEach(function (v, j) {
        if (!v) return;
        var y0 = yy(base), y1 = yy(base + v), h = Math.max(0, y0 - y1 - (j ? 0 : 0));
        var last = d.parts.slice(j + 1).every(function (z) { return !z; });
        // segment cu 2px de suprafață între straturi; capătul de sus rotunjit
        var hh = Math.max(0, h - (last ? 0 : 1.5));
        if (last && hh > 3 && w > 4) {
          var r = Math.min(3, w / 2);
          s += '<path class="bar" opacity="' + op + '" fill="' + COLOR[cs[j]] + '" d="M' + x + ',' + y0 + 'V' + (y0 - hh + r) + 'Q' + x + ',' + (y0 - hh) + ' ' + (x + r) + ',' + (y0 - hh) + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + (y0 - hh) + ' ' + (x + w) + ',' + (y0 - hh + r) + 'V' + y0 + 'Z"/>';
        } else {
          s += '<rect class="bar" opacity="' + op + '" fill="' + COLOR[cs[j]] + '" x="' + x + '" y="' + (y0 - hh) + '" width="' + w + '" height="' + hh + '"/>';
        }
        base += v;
      });
    });
    // etichete pe axa X: ianuarie al fiecărui an (sau anii)
    data.forEach(function (d, k) {
      var m = MONTHS[d.p];
      if (S.year || m.slice(5) === '01') s += '<text x="' + (L0 + k * bw + (S.year ? bw / 2 : 0)) + '" y="' + (H - 4) + '"' + (S.year ? ' text-anchor="middle"' : '') + '>' + m.slice(0, 4) + '</text>';
      if (d.na && !S.year) s += '<text x="' + (L0 + k * bw + bw / 2) + '" y="' + (yy(0) - 2) + '" text-anchor="middle">·</text>';
    });
    data.forEach(function (d, k) { s += '<rect class="hit" data-k="' + k + '" x="' + (L0 + k * bw) + '" y="0" width="' + bw + '" height="' + H + '"/>'; });
    s += '</svg>';
    $('chart').innerHTML = s;
    Array.prototype.forEach.call($('chart').querySelectorAll('.hit'), function (el) {
      var d = data[+el.getAttribute('data-k')];
      el.addEventListener('mouseenter', function (e) {
        var h = '<b>' + esc(label(d.p)) + '</b>';
        if (d.na) h += '<br><span class="note">fără date</span>';
        else {
          d.parts.forEach(function (v, j) { if (cs.length > 1) h += '<div class="row"><span><i class="sw" style="background:' + COLOR[cs[j]] + '"></i>' + CATS.filter(function (x) { return x[0] === cs[j]; })[0][1] + '</span><span>' + fmt(v) + '</span></div>'; });
          h += '<div class="row"><span>Total</span><b>' + fmt(d.sum) + '</b></div>';
        }
        showTip(e, h);
      });
      el.addEventListener('mousemove', moveTip);
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('click', function () { setMonth(d.p); });
    });
  }

  function renderAll() {
    $('period').textContent = label(S.mi);
    $('month').value = S.mi;
    drawBubbles(); renderKpis(); renderRank(); renderChart(); restyleLines(); renderLineInfo();
  }

  function select(siruta) {
    S.sel = S.sel === siruta ? null : siruta;
    if (S.sel && CENTER[S.sel]) map.panTo(CENTER[S.sel]);
    renderAll();
  }
  function setMonth(i) { S.mi = Math.max(0, Math.min(MONTHS.length - 1, i)); renderAll(); }

  // ---------- comenzi ----------
  function seg(id, key, parse) {
    Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        S[key] = parse(b.getAttribute('data-v'));
        Array.prototype.forEach.call($(id).querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
        renderAll();
      });
    });
  }
  $('catSeg').innerHTML = '<button type="button" data-v="all" class="on">Toate</button>' + CATS.map(function (c) {
    return '<button type="button" data-v="' + c[0] + '"><i class="sw" style="background:' + COLOR[c[0]] + '"></i>' + c[1] + '</button>';
  }).join('');
  seg('metricSeg', 'metric', Number);
  seg('catSeg', 'cat', String);
  $('rep').addEventListener('change', function () { S.rep = this.checked; renderAll(); });
  $('yearAgg').addEventListener('change', function () { S.year = this.checked; $('month').step = 1; renderAll(); });
  $('month').addEventListener('input', function () { setMonth(+this.value); });
  $('play').addEventListener('click', function () {
    var b = this;
    if (S.playing) { clearInterval(S.playing); S.playing = null; b.classList.remove('on'); b.textContent = '▶'; return; }
    b.classList.add('on'); b.textContent = '❚❚';
    if (S.mi >= MONTHS.length - (S.year ? 12 : 1)) S.mi = 0;
    S.playing = setInterval(function () {
      var n = S.mi + (S.year ? 12 : 1);
      if (n >= MONTHS.length) { clearInterval(S.playing); S.playing = null; b.classList.remove('on'); b.textContent = '▶'; return; }
      setMonth(n);
    }, S.year ? 1400 : 700);
  });
  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.key === 'ArrowRight') setMonth(S.mi + (S.year ? 12 : 1));
    else if (e.key === 'ArrowLeft') setMonth(S.mi - (S.year ? 12 : 1));
  });
  $('widthBy').addEventListener('change', function () { S.width = this.value; restyleLines(); renderLineInfo(); });
  $('dayType').addEventListener('change', function () { S.day = this.value; restyleLines(); if (SERV) { restyleGtfsStops(); renderGtfsRank(); } renderLineInfo(); });
  [['showGtfsStops', [gtfsStopLayer]], ['showLines', [lineLayer, haloLayer]], ['showProposed', [proposedLayer]], ['showStops', [stopLayer]], ['showBusStops', [busStopLayer]], ['showTramStops', [tramStopLayer]], ['showHot', [hotLayer]], ['showUat', [uatLayer]], ['showBubbles', [bubbleLayer]]].forEach(function (p) {
    $(p[0]).addEventListener('change', function () { var on = this.checked; p[1].forEach(function (l) { if (on) l.addTo(map); else map.removeLayer(l); }); });
  });

  // ---------- trasee ----------
  // tramvai (roșu), autobuz local (violet), autobuz metropolitan (magenta); liniile cele mai utilizate după CTP
  // au un halou galben; grosimea liniilor metropolitane urmează titlurile/călătoriile comunelor pe care le deservesc
  var lineFeatures = [], halos = [];
  function lineKey(p) { return (p.linie || '') + '|' + (p.tip || '') + '|' + (p.retea || '') + (p.stare === 'propus' ? '|propus' : ''); }
  function isTop(p) { return !!p.linie && TOP[p.linie] === p.tip; }
  function lineColor(p) { return p.tip === 'tramvai' ? TRAM : p.retea === 'metropolitan' ? METRO : BUS; }
  // cota liniei din titlurile / călătoriile comunelor deservite (perioada curentă), doar pentru traseele metropolitane:
  // volumul fiecărei comune se împarte în mod egal între liniile metropolitane care o străbat (CTP raportează pe comună)
  var LINES_PER_UAT = {};
  function countLinesPerUat() {
    var seen = {};
    LINES_PER_UAT = {};
    lineFeatures.forEach(function (l) {
      var p = l._p;
      if (p.retea !== 'metropolitan' || !p.linie || p.stare === 'propus') return;
      (p.uat || []).forEach(function (s) { var k = s + '|' + p.linie; if (!seen[k]) { seen[k] = 1; LINES_PER_UAT[s] = (LINES_PER_UAT[s] || 0) + 1; } });
    });
  }
  function prepareServed() {   // după ce s-au încărcat toate traseele
    countLinesPerUat();
    lineFeatures.forEach(function (l) { l._p._served = servedUats(l._p); });
    restyleLines();
  }
  function servedUats(p) {
    var out = {};
    if (p.retea !== 'metropolitan' || !p.linie || p.stare === 'propus') return out;
    lineFeatures.forEach(function (l) { if (l._p.linie === p.linie && l._p.retea === 'metropolitan' && l._p.stare !== 'propus') (l._p.uat || []).forEach(function (s) { out[s] = 1; }); });
    return out;
  }
  function servedVal(p) {
    if (p.retea !== 'metropolitan' || !p.linie || p.stare === 'propus' || !T) return null;
    var t = null, us = p._served || {};
    Object.keys(us).forEach(function (s) { var u = T.uat[s]; var v = u ? val(u, S.mi) : null; if (v != null) t = (t || 0) + v / (LINES_PER_UAT[s] || 1); });
    return t;
  }
  var metroMax = 1;
  // serviciul liniei din orarul GTFS (curse pe zi, prima / ultima plecare, intervalul la vârf)
  function svc(p) { return SERV && p.linie ? SERV.linii[(p.tip === 'tramvai' ? 'tramvai' : 'autobuz') + '|' + p.linie] || null : null; }
  var gMax = 1;
  function lineStyle(p) {
    var dim = S.line ? S.line !== lineKey(p) : S.stop ? !servesStop(p) : false, on = S.line === lineKey(p) || (S.stop && servesStop(p)), w = isTop(p) ? 4 : 1.8;
    var sv = S.width === 'cota' ? servedVal(p) : null, net = !p.linie && p.tip === 'tramvai', g = S.width === 'gtfs' ? svc(p) : null;
    if (sv != null) w = 1.5 + 5 * Math.sqrt(sv / metroMax);
    if (g && p.stare !== 'propus') w = 1 + 7 * Math.sqrt((g[S.day] || 0) / gMax);
    if (net) w = 3;
    return { color: lineColor(p), weight: on ? Math.max(5, w) : w, opacity: dim ? 0.08 : on || isTop(p) || net ? 0.95 : 0.6,
      dashArray: p.stare === 'propus' ? '6 6' : p.stare === 'de verificat' ? '3 5' : null, lineCap: p.stare === 'propus' ? 'butt' : 'round', lineJoin: 'round' };
  }
  function servesStop(p) {
    if (!S.stop || !p.linie) return false;
    var refs = stopRefs(S.stop), k = (p.tip === 'tramvai' ? 'T' : '') + p.linie;
    return refs.indexOf(k) >= 0 || refs.indexOf(p.linie) >= 0;
  }
  function restyleLines() {
    gMax = 1;
    if (SERV) Object.keys(SERV.linii).forEach(function (k) { gMax = Math.max(gMax, SERV.linii[k][S.day] || 0); });
    metroMax = 1;
    lineFeatures.forEach(function (l) { var v = servedVal(l._p); if (v) metroMax = Math.max(metroMax, v); });
    lineFeatures.forEach(function (l) { l.setStyle(lineStyle(l._p)); });
    halos.forEach(function (h) { h.setStyle({ opacity: (S.line && S.line !== lineKey(h._p)) || (S.stop && !servesStop(h._p)) ? 0 : 0.35 }); });
    if (vehMarks) restyleLive();                        // vehiculele în timp real: doar ale liniei alese
  }
  function svcText(g) {
    return g ? (g.lucru || 0) + ' curse / zi lucrătoare · ' + (g.weekend || 0) + ' / zi de weekend' +
      (g.prima ? ' · ' + g.prima + '–' + g.ultima : '') + (g.interval_varf ? ' · la ~' + g.interval_varf + ' min în vârf (7–9)' : '') : '';
  }
  function tipLine(p, src) {
    var sv = servedVal(p), g = svc(p);
    if (!p.linie) return '<b>' + esc(p.nume || 'Traseu fără număr') + '</b>' + (p.km ? '<br><span class="note">' + p.km.toLocaleString('ro-RO') + ' km de cale</span>' : '') +
      (p.stare === 'propus' ? '<br><span class="note">propunere – nu este în exploatare</span>' : '') + (p.tip === 'tramvai' ? '<br><span class="note">infrastructura, fără împărțirea pe linii</span>' : '');
    return '<b>' + (p.linie ? 'Linia ' + esc(p.linie) : 'Traseu fără număr') + '</b> · ' + esc(p.tip || '') + (p.retea ? ' ' + esc(p.retea) : '') +
      (p.de_la && p.pana_la ? '<br>' + esc(p.de_la) + ' → ' + esc(p.pana_la) : p.nume ? '<br>' + esc(p.nume) : '') +
      (p.km ? '<br><span class="note">' + p.km.toLocaleString('ro-RO') + ' km</span>' : '') +
      (p.stare === 'de verificat' ? '<br><span class="note">ocol din orarul GTFS (punctat) – de verificat</span>' : '') +
      (isTop(p) ? '<br><span style="color:' + HOT + '">printre cele mai utilizate linii (CTP)</span>' : '') +
      (g ? '<br>' + esc(svcText(g)) : '') +
      (sv != null ? '<br>cota din comunele deservite: ' + fmt(sv) + ' ' + (S.metric ? 'călătorii' : 'titluri') + ' · ' + esc(label(S.mi)) : '') +
      (src ? '<br><span class="note">' + esc(src) + '</span>' : '');
  }
  function addLines(geo, layer, src) {
    L.geoJSON(geo, {
      pane: 'lines',
      filter: function (f) {
        if (!f.geometry || !/LineString/.test(f.geometry.type)) return false;
        if (f.properties && f.properties.stare === 'propus' && layer === lineLayer) { addLines({ type: 'FeatureCollection', features: [f] }, proposedLayer, src); return false; }
        return true;
      },
      style: function (f) { return lineStyle(f.properties); },
      onEachFeature: function (f, l) {
        var p = f.properties;
        if (p.linie) p.linie = String(p.linie).toUpperCase();
        lineFeatures.push(l); l._p = p;
        if (isTop(p)) {
          var h = L.geoJSON(f, { pane: 'halo', interactive: false, style: { color: HOT, weight: 11, opacity: 0.35, lineCap: 'round', lineJoin: 'round' } }).addTo(haloLayer);
          h._p = p; halos.push(h);
        }
        l.on('mouseover', function (e) { l.setStyle({ weight: 6, opacity: 1 }); showTip(e.originalEvent, tipLine(p, src)); });
        l.on('mousemove', function (e) { moveTip(e.originalEvent); });
        l.on('mouseout', function () { l.setStyle(lineStyle(p)); hideTip(); });
        l.on('click', function () { setLine(S.line === lineKey(p) ? null : lineKey(p)); });
      }
    }).addTo(layer);
  }
  function setLine(k) {
    S.line = k; S.stop = null;
    restyleLines();
    Array.prototype.forEach.call($('lineChips').querySelectorAll('button[data-k]'), function (b) { b.classList.toggle('on', b.getAttribute('data-k') === k); });
    renderLineInfo();
  }
  // fișa liniei alese: sensurile, lungimea, comunele străbătute, legătura OSM
  function renderLineInfo() {
    var box = $('lineInfo');
    if (S.stop) {
      var refs = stopRefs(S.stop);
      box.hidden = false;
      var tramStop = S.stop.mod === 'tramvai' && !S.stop._g;
      box.innerHTML = '<h3>' + esc(S.stop.nume || 'Stație') + (tramStop ? ' <span class="note">stație de tramvai</span>' : '') + '</h3><p class="note">' +
        (tramStop ? (refs.length ? 'Legături cu autobuzul – ' + refs.length + (refs.length === 1 ? ' linie' : ' linii') + ' la ≤ 100 m:' : 'Nicio linie de autobuz la ≤ 100 m.') :
        refs.length ? refs.length + (refs.length === 1 ? ' linie' : ' linii') + ' ' +
        (S.stop._peroane > 1 ? 'în cele ' + S.stop._peroane + ' peroane' : 'în stație') + ':' : 'Nicio linie CTP la ≤ 30 m.') + '</p>' +
        '<div class="chips">' + refs.map(function (r) {
          var k = lineFeatures.filter(function (l) { return l._p.linie === r.replace(/^T/, ''); })[0];
          return '<button type="button" class="' + (k && k._p.retea === 'metropolitan' ? 'metro' : /^T/.test(r) ? 'tram' : 'bus') + (k && isTop(k._p) ? ' top' : '') + '" data-k="' + (k ? esc(lineKey(k._p)) : '') + '">' + esc(r) + '</button>';
        }).join('') + '</div><p class="note">' + (S.stop._g ? 'Liniile din orarul GTFS; ' + S.stop._g.plecari_lucru.toLocaleString('ro-RO') + ' plecări / zi lucrătoare, ' + S.stop._g.plecari_weekend.toLocaleString('ro-RO') + ' / zi de weekend. ' :
          tramStop ? 'Legăturile cu autobuzul la ≤ 100 m. ' : 'Liniile sunt cele ale căror trasee trec la cel mult 30 m de stație. ') + 'Apăsați din nou pe stație sau pe o linie pentru a ieși.</p>';
      Array.prototype.forEach.call(box.querySelectorAll('button[data-k]'), function (b) {
        b.addEventListener('click', function () { if (b.getAttribute('data-k')) setLine(b.getAttribute('data-k')); });
      });
      return;
    }
    var fs = S.line ? lineFeatures.filter(function (l) { return lineKey(l._p) === S.line; }).map(function (l) { return l._p; }) : [];
    if (!fs.length) { box.hidden = true; return; }
    var p = fs[0], uats = {};
    fs.forEach(function (x) { (x.uat_nume || []).forEach(function (n) { uats[n] = 1; }); });
    var sv = servedVal(p);
    box.hidden = false;
    box.innerHTML = '<h3><span class="badge" style="background:' + lineColor(p) + '">' + esc(p.linie || '?') + '</span> ' +
      esc(p.tip || '') + ' ' + esc(p.retea || '') + (p.stare === 'propus' ? ' <span class="note">· în proiect</span>' : '') + '</h3>' +
      (isTop(p) ? '<p class="topnote">Printre cele mai utilizate linii ' + (p.tip === 'tramvai' ? 'de tramvai' : 'de autobuz') + ' (răspunsul CTP pentru PMI)</p>' : '') +
      (svc(p) ? '<p class="note"><b>Orar (GTFS):</b> ' + esc(svcText(svc(p))) + ' · ' + svc(p).statii + ' stații' +
        (svc(p).url ? ' · <a href="' + esc(svc(p).url) + '" target="_blank" rel="noopener">pagina CTP</a>' : '') + '</p>' :
        SERV && p.linie && p.stare !== 'propus' ? '<p class="note">Linia nu apare în orarul GTFS.</p>' : '') +
      '<table>' + fs.map(function (x, i) {
        return '<tr><td>' + esc(x.de_la && x.pana_la ? x.de_la + ' → ' + x.pana_la : x.nume && x.nume !== x.linie ? x.nume : 'traseu ' + (i + 1)) + '</td><td>' + (x.km ? x.km.toLocaleString('ro-RO') + ' km' : '') + '</td><td>' +
          (x.osm ? '<a href="https://www.openstreetmap.org/' + esc(x.osm) + '" target="_blank" rel="noopener">OSM</a>' : '') + '</td></tr>';
      }).join('') + '</table>' +
      (Object.keys(uats).length ? '<p class="note">Comune ZMI străbătute: ' + esc(Object.keys(uats).join(', ')) + '</p>' : '') +
      (sv != null ? '<p class="note">Cota liniei din ' + (S.metric ? 'călătoriile estimate' : 'titlurile vândute') + ' ale comunelor deservite, ' + esc(label(S.mi)) + ': <b>' + fmt(sv) +
        '</b> (volumul comunei împărțit egal între cele ' + Object.keys(p._served || {}).map(function (s) { return LINES_PER_UAT[s]; }).join(' / ') + ' linii metropolitane care o deservesc – indicativ).</p>' : '') +
      (p.amtpi ? '<p class="note">AMTPI: <b>' + esc(p.amtpi) + '</b>' + (p.amtpi_statii ? ' · ' + esc(p.amtpi_statii) : '') +
        (p.amtpi_url ? ' · <a href="' + esc(p.amtpi_url) + '" target="_blank" rel="noopener">pagina traseului</a>' : '') +
        (p.amtpi === 'nelistat' && p.stare !== 'propus' ? ' – linia nu apare în lista oficială AMTPI (posibil desființată)' : '') + '</p>' : '') +
      (p.nota ? '<p class="note">' + esc(p.nota) + '</p>' : '') +
      (p.operator ? '<p class="note">Operator: ' + esc(p.operator) + '</p>' : '');
  }
  function renderLineChips() {
    var seen = {}, groups = {};
    lineFeatures.forEach(function (l) {
      var p = l._p, k = lineKey(p);
      if (!p.linie || seen[k]) return;
      seen[k] = 1;
      var g = p.tip === 'tramvai' ? 'tramvai' : p.retea === 'metropolitan' ? 'metro' : 'local';
      (groups[g] = groups[g] || []).push(p);
    });
    function num(p) { return parseInt(p.linie, 10) || 999; }
    var html = '';
    [['tramvai', 'Tramvai', 'tram'], ['local', 'Autobuz – rețeaua locală', 'bus'], ['metro', 'Autobuz – Zona Metropolitană', 'metro']].forEach(function (g) {
      var a = (groups[g[0]] || []).sort(function (x, y) { return num(x) - num(y) || String(x.linie).localeCompare(y.linie); });
      if (!a.length) return;
      html += '<div class="grp">' + g[1] + ' (' + a.length + ')</div>' + a.map(function (p) {
        return '<button type="button" class="' + g[2] + (isTop(p) ? ' top' : '') + (p.stare === 'propus' ? ' proj' : '') + '" data-k="' + esc(lineKey(p)) + '" title="' + esc((p.de_la && p.pana_la ? p.de_la + ' – ' + p.pana_la : p.nume || '') + (p.stare === 'propus' ? ' (în proiect)' : '')) + '">' + esc(p.linie) + '</button>';
      }).join('');
    });
    $('lineChips').innerHTML = html;
    Array.prototype.forEach.call($('lineChips').querySelectorAll('button[data-k]'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-k');
        if (/\|propus$/.test(k) && !map.hasLayer(proposedLayer)) { $('showProposed').checked = true; proposedLayer.addTo(map); }
        setLine(S.line === k ? null : k);
        if (S.line) {
          var bb = L.latLngBounds([]);
          lineFeatures.forEach(function (l) { if (lineKey(l._p) === k) bb.extend(l.getBounds()); });
          if (bb.isValid()) map.fitBounds(bb, { padding: [30, 30] });
        }
      });
    });
  }

  // legenda hărții
  var legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    var d = L.DomUtil.create('div', 'map-legend');
    d.innerHTML = '<div><i class="ln" style="background:' + TRAM + '"></i>Tramvai</div>' +
      '<div><i class="ln dash" style="color:' + TRAM + '"></i>Tramvai – extindere propusă</div>' +
      '<div><i class="ln" style="background:' + BUS + '"></i>Autobuz – local</div>' +
      '<div><i class="ln" style="background:' + METRO + '"></i>Autobuz – metropolitan<small>grosimea liniilor: curse pe zi (orar)</small></div>' +
      '<div><i class="bub" style="width:12px;height:12px;margin-right:12px"></i>Stație (orar): plecări pe zi</div>' +
      '<div><i class="st"></i>Stație de transfer / cap de linie</div>' +
      '<div><i class="sd" style="border-color:' + TRAM + '"></i>Stație de tramvai</div>' +
      '<div><i class="sd"></i>Stație de autobuz (local / <span style="color:' + METRO + '">metropolitan</span>)<small>mărimea: numărul de linii</small></div>' +
      '<div><i class="ln halo"></i>Cele mai utilizate linii (CTP)</div>' +
      '<div><i class="dot"></i>Stații aglomerate (CTP)</div>' +
      '<div><i class="bub"></i>Comună ZMI: titluri / călătorii</div>';
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  legend.addTo(map);

  // stațiile, după stratul din care provin: transfer metropolitan (mărimea = numărul de linii), capete de linie și
  // stațiile obișnuite (mărimea = numărul de linii care trec prin stație); stațiile aglomerate CTP – separat (drawHots)
  var STOP_KIND = [
    [/transfer/i, 'Stație de transfer metropolitană'],
    [/terminus.*metropol|metropol.*terminus/i, 'Cap de linie metropolitană'],
    [/terminus|cap.*linie/i, 'Cap de linie locală']
  ];
  var DOTARI = [['adapost', 'adăpost'], ['banca', 'bancă'], ['iluminat', 'iluminat'], ['accesibil', 'accesibil scaun rulant']];
  var busStops = [], nTramStops = 0;
  function stopRefs(p) {   // la stațiile de tramvai fără linii de tramvai cunoscute: legăturile cu autobuzul (≤ 100 m)
    var own = (p.linii || '').split(/\s*,\s*/).filter(Boolean);
    return p.mod === 'tramvai' ? own.concat((p.autobuz_aproape || '').split(/\s*,\s*/).filter(Boolean)) : own;
  }
  function tipStop(p, k) {
    var d = DOTARI.filter(function (x) { return p[x[0]]; }).map(function (x) { return x[1] + ': ' + ({ yes: 'da', no: 'nu', limited: 'parțial' }[p[x[0]]] || p[x[0]]); });
    var refs = stopRefs(p);
    if (p.mod === 'tramvai') {
      var bus = (p.autobuz_aproape || '').split(/\s*,\s*/).filter(Boolean);
      return '<b>' + esc(p.nume || 'stație fără nume') + '</b><br>Stație de tramvai' +
        (p.linii ? '<br>linii de tramvai: ' + esc(p.linii) : '<br><span class="note">liniile de tramvai: încă fără trasee pe linii</span>') +
        (bus.length ? '<br>legături cu autobuzul (≤ 100 m): ' + esc(bus.join(', ')) : '<br><span class="note">nicio linie de autobuz la ≤ 100 m</span>') +
        (d.length ? '<br><span class="note">' + esc(d.join(' · ')) + '</span>' : '') + '<br><span class="note">apăsați pentru legături</span>';
    }
    return '<b>' + esc(p.nume || 'stație fără nume') + '</b><br>' + esc(k) + (p.tramvai === 'yes' ? ' (și tramvai)' : '') +
      (refs.length ? '<br>' + refs.length + (refs.length === 1 ? ' linie' : ' linii') + ': ' + esc(refs.join(', ')) : '<br><span class="note">nicio linie CTP de autobuz la ≤ 30 m</span>') +
      (p.linii_proiect ? '<br>linii în proiect: ' + esc(p.linii_proiect) : '') +
      (p.linii_calculate ? '<br><span class="note">liniile: traseele care trec la ≤ 30 m</span>' : p.linii_traseu ? '<br><span class="note">liniile: fișierele traseelor AMTPI + liniile locale la ≤ 30 m</span>' : '') +
      (d.length ? '<br><span class="note">' + esc(d.join(' · ')) + '</span>' : '') +
      (p.osm ? '<br><span class="note">apăsați pentru liniile stației</span>' : '');
  }
  function addStops(geo) {
    geo.features.forEach(function (f) {
      if (!f.geometry || f.geometry.type !== 'Point') return;
      var c = f.geometry.coordinates, p = f.properties || {}, strat = p.strat || '';
      if (/aglomerat/i.test(strat)) return;
      var kind = STOP_KIND.filter(function (k) { return k[0].test(strat); })[0];
      var metroStop = !kind && /metropolit/i.test(strat), k = kind ? kind[1] : metroStop ? 'Stație de autobuz metropolitan' : 'Stație de autobuz';
      var m;
      if (p.mod === 'tramvai') {
        m = L.circleMarker([c[1], c[0]], { pane: 'lines', className: 'stop-dot', radius: 3.5, weight: 2, color: TRAM, fillColor: '#1a1a19', fillOpacity: 0.9 }).addTo(tramStopLayer);
        k = 'Stație de tramvai';
        nTramStops++;
      } else if (kind) {
        var metro = /metropolit/i.test(k), transfer = /transfer/i.test(k), col = metro ? METRO : BUS;
        m = L.circleMarker([c[1], c[0]], { pane: 'lines', radius: transfer ? 3 + 1.4 * Math.min(p.n_linii || 1, 6) : 4, weight: transfer ? 2 : 1.5,
          color: col, fillColor: transfer ? '#1a1a19' : col, fillOpacity: transfer ? 0.85 : 0.9 }).addTo(stopLayer);
      } else {
        var n = p.n_linii != null ? p.n_linii : stopRefs(p).length;
        var prop = p.stare === 'propus';
        m = L.circleMarker([c[1], c[0]], { pane: 'lines', className: 'stop-dot', radius: n ? 2 + 1.5 * Math.sqrt(n) : 2.5, weight: 1, dashArray: prop ? '2 2' : null,
          color: prop ? METRO : !n ? '#8f8e86' : metroStop ? METRO : '#f0efec', fillColor: '#1a1a19', fillOpacity: n || prop ? 0.9 : 0.4, opacity: n || prop ? 0.95 : 0.5 })
          .addTo(prop ? proposedLayer : busStopLayer);
        if (prop) { m._stopP = p; m.on('mouseover', function (e) { showTip(e.originalEvent, tipStop(p, 'Stație a unei linii în proiect')); }); m.on('mousemove', function (e) { moveTip(e.originalEvent); }); m.on('mouseout', hideTip); return; }
        busStops.push(p); m._stopP = p;
      }
      m.on('mouseover', function (e) { showTip(e.originalEvent, tipStop(p, k)); });
      m.on('mousemove', function (e) { moveTip(e.originalEvent); });
      m.on('mouseout', hideTip);
      m.on('click', function () { setStop(S.stop === p ? null : p); });
    });
  }
  // stația aleasă: liniile care nu trec prin ea se estompează; fișa ei apare în panou
  function setStop(p) {
    S.stop = p; S.line = null;
    restyleLines();
    Array.prototype.forEach.call($('lineChips').querySelectorAll('button[data-k]'), function (b) { b.classList.remove('on'); });
    renderLineInfo();
  }
  // cheia de nume a unei stații, ca peroanele din surse diferite să se unească: „Tg. Cucu” = „Târgu Cucu”,
  // „C.U.G. I” = „CUG 1”, „Vama II” = „Vama 2”
  function stopKey(name) {
    var n = norm(String(name || '').replace(/([A-Za-z])\.(?=[A-Za-z])/g, '$1').replace(/\b([A-Z]{1,4})\.(?=\s|$)/g, '$1')).replace(/\btg\b/g, 'targu');
    return n.replace(/\b(iii|ii|i|iv)\b/g, function (r) { return { i: '1', ii: '2', iii: '3', iv: '4' }[r]; }).replace(/\s+/g, ' ').trim();
  }
  // nodurile de stații (union-find): peroanele cu același nume la cel mult 600 m și cele cu nume compatibile
  // („Piața Independenței” / „Independentei”, „Pod de Fier” / „Podu de Fier”) la cel mult 250 m; numele afișat e cel mai frecvent
  function nameTokens(name) {
    return stopKey(name).replace(/\bpodu\b/g, 'pod').split(' ').filter(function (t) { return t && ['piata', 'str', 'strada', 'statia', 'de', 'la'].indexOf(t) < 0; });
  }
  function compatible(a, b) {
    if (!a.length || !b.length) return false;
    var small = a.length <= b.length ? a : b, big = small === a ? b : a;
    return small.every(function (t) { return big.indexOf(t) >= 0; });
  }
  function stopNodes() {
    var pts = [], parent = [];
    busStopLayer.eachLayer(function (m) { if (m._stopP && m._stopP.nume) { pts.push({ p: m._stopP, ll: m.getLatLng(), tk: nameTokens(m._stopP.nume) }); parent.push(parent.length); } });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    for (var a = 0; a < pts.length; a++) {
      for (var b = a + 1; b < pts.length; b++) {
        if (Math.abs(pts[a].ll.lat - pts[b].ll.lat) > 0.006 || Math.abs(pts[a].ll.lng - pts[b].ll.lng) > 0.009) continue;
        var d = pts[a].ll.distanceTo(pts[b].ll), same = pts[a].tk.join(' ') === pts[b].tk.join(' ');
        if ((same && d <= 600) || (d <= 250 && compatible(pts[a].tk, pts[b].tk))) parent[find(a)] = find(b);
      }
    }
    var nodes = {};
    pts.forEach(function (x, i) {
      var r = find(i), e = nodes[r] || (nodes[r] = { nume: x.p.nume, refs: {}, stops: [], lls: [], cnt: {} });
      e.cnt[x.p.nume] = (e.cnt[x.p.nume] || 0) + 1;
      if (e.cnt[x.p.nume] > e.cnt[e.nume] || (e.cnt[x.p.nume] === e.cnt[e.nume] && x.p.nume.length > e.nume.length)) e.nume = x.p.nume;
      e.stops.push(x.p); e.lls.push(x.ll);
      stopRefs(x.p).forEach(function (ref) { e.refs[ref] = 1; });
    });
    return Object.keys(nodes).map(function (k) { return nodes[k]; });
  }
  function renderStopRank() {
    var hot = {};
    if (HOTS) HOTS.statii.forEach(function (h) { [h.nume].concat(h.alias || []).forEach(function (a) { hot[stopKey(a)] = 1; }); });
    var rows = stopNodes().map(function (e) { e.n = Object.keys(e.refs).length; return e; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, 12);
    if (!rows.length) { $('stopRankBox').hidden = true; return; }
    $('stopRankBox').hidden = false;
    var mx = rows[0].n || 1;
    $('stopRank').innerHTML = rows.map(function (e, i) {
      return '<div class="r" data-i="' + i + '"><span>' + esc(e.nume) + (e.stops.some(function (x) { return hot[stopKey(x.nume)]; }) ? ' <i class="hotdot" title="stație aglomerată (CTP)"></i>' : '') + '</span>' +
        '<span class="track"><div class="fill" style="width:' + (e.n / mx * 100) + '%"></div></span><span class="v">' + e.n + '</span><span class="d"></span></div>';
    }).join('');
    Array.prototype.forEach.call($('stopRank').querySelectorAll('.r'), function (el) {
      el.addEventListener('click', function () {
        var e = rows[+el.getAttribute('data-i')];
        var all = e.stops;
        var refs = Object.keys(e.refs).sort(function (x, y) { return /^T/.test(y) - /^T/.test(x) || parseInt(x.replace(/^T/, ''), 10) - parseInt(y.replace(/^T/, ''), 10) || x.localeCompare(y); });
        var merged = { nume: e.nume, linii: refs.join(', '), _peroane: all.length };
        setStop(merged);
        var b = L.latLngBounds(e.lls);
        if (b.isValid()) map.setView(b.getCenter(), Math.max(map.getZoom(), 15));
      });
    });
  }

  // stațiile din orarul GTFS: mărimea = plecări pe zi (tipul zilei ales), liniile exacte din orar
  var gtfsMarkers = [];
  function drawGtfsStops() {
    SERV.statii.forEach(function (st) {
      var p = { nume: st.nume, linii: st.linii.join(', '), mod: st.linii.every(function (r) { return /^T/.test(r); }) ? 'tramvai' : 'autobuz', _g: st };
      var m = L.circleMarker([st.lat, st.lng], { pane: 'lines', weight: 1, color: '#1a1a19', fillColor: '#f0efec', fillOpacity: 0.85 }).addTo(gtfsStopLayer);
      m._g = st;
      m.on('mouseover', function (e) {
        showTip(e.originalEvent, '<b>' + esc(st.nume) + '</b><br>' + st.plecari_lucru.toLocaleString('ro-RO') + ' plecări / zi lucrătoare · ' +
          st.plecari_weekend.toLocaleString('ro-RO') + ' / zi de weekend<br>' + st.linii.length + (st.linii.length === 1 ? ' linie: ' : ' linii: ') + esc(st.linii.join(', ')) +
          '<br><span class="note">orar GTFS · apăsați pentru liniile stației</span>');
      });
      m.on('mousemove', function (e) { moveTip(e.originalEvent); });
      m.on('mouseout', hideTip);
      m.on('click', function () { setStop(S.stop && S.stop._g === st ? null : p); });
      gtfsMarkers.push(m);
    });
    restyleGtfsStops();
  }
  function restyleGtfsStops() {
    var key = S.day === 'weekend' ? 'plecari_weekend' : 'plecari_lucru', mx = 1;
    gtfsMarkers.forEach(function (m) { mx = Math.max(mx, m._g[key]); });
    gtfsMarkers.forEach(function (m) { m.setRadius(1.5 + 11 * Math.sqrt(m._g[key] / mx)); m.setStyle({ fillOpacity: m._g[key] ? 0.85 : 0.2 }); });
  }
  // clasamentul stațiilor după plecări (peroanele cu același nume la ≤ 600 m se adună)
  function renderGtfsRank() {
    var key = S.day === 'weekend' ? 'plecari_weekend' : 'plecari_lucru', groups = [];
    SERV.statii.forEach(function (st) {
      var k = stopKey(st.nume), ll = L.latLng(st.lat, st.lng);
      var g = groups.filter(function (x) { return x.k === k && x.ll.distanceTo(ll) <= 600; })[0];
      if (!g) groups.push(g = { k: k, nume: st.nume, ll: ll, lls: [], dep: 0, refs: {}, n: 0 });
      g.dep += st[key]; g.lls.push(ll); g.n++;
      st.linii.forEach(function (r) { g.refs[r] = 1; });
    });
    var hot = {};
    if (HOTS) HOTS.statii.forEach(function (h) { [h.nume].concat(h.alias || []).forEach(function (a) { hot[stopKey(a)] = 1; }); });
    var rows = groups.sort(function (a, b) { return b.dep - a.dep; }).slice(0, 15), mx = rows[0] ? rows[0].dep : 1;
    $('stopRankBox').hidden = false;
    $('stopRankTitle').textContent = 'Stațiile cu cele mai multe plecări (' + (S.day === 'weekend' ? 'weekend' : 'zi lucrătoare') + ')';
    $('stopRankNote').innerHTML = 'Plecări pe zi din orarul GTFS (toate liniile, toate peroanele stației); între paranteze, numărul de linii; <i class="hotdot"></i> = stație aglomerată după CTP. Apăsați pe o stație pentru liniile ei.';
    $('stopRank').innerHTML = rows.map(function (e, i) {
      return '<div class="r" data-i="' + i + '"><span>' + esc(e.nume) + (hot[e.k] ? ' <i class="hotdot" title="stație aglomerată (CTP)"></i>' : '') + '</span>' +
        '<span class="track"><div class="fill" style="width:' + (e.dep / mx * 100) + '%"></div></span><span class="v">' + e.dep.toLocaleString('ro-RO') +
        '</span><span class="d">(' + Object.keys(e.refs).length + ')</span></div>';
    }).join('');
    Array.prototype.forEach.call($('stopRank').querySelectorAll('.r'), function (el) {
      el.addEventListener('click', function () {
        var e = rows[+el.getAttribute('data-i')];
        var refs = Object.keys(e.refs).sort(function (x, y) { return /^T/.test(y) - /^T/.test(x) || parseInt(x.replace(/^T/, ''), 10) - parseInt(y.replace(/^T/, ''), 10) || x.localeCompare(y); });
        setStop({ nume: e.nume, linii: refs.join(', '), _peroane: e.n });
        var b = L.latLngBounds(e.lls);
        if (b.isValid()) map.setView(b.getCenter(), Math.max(map.getZoom(), 15));
      });
    });
  }

  // pozițiile din statii_aglomerate.json (stații de tip nod, ex. rondul Târgu Cucu) – nu căutăm stații cu același nume,
  // care pot fi peroane de pe altă stradă
  function drawHots() {
    HOTS.statii.forEach(function (s) {
      L.marker([s.lat, s.lng], { pane: 'hot', icon: L.divIcon({ className: '', html: '<div class="hot"></div><div class="hot-label">' + esc(s.nume) + '</div>', iconSize: [14, 14], iconAnchor: [7, 7] }) })
        .bindPopup('<b>' + esc(s.nume) + '</b><br>stație aglomerată (CTP, Masterplan PMI)')
        .addTo(hotLayer);
    });
  }

  // ---------- vehiculele în timp real ----------
  // pozițiile GPS ale vehiculelor CTP (Tranzy), prin funcția Netlify /live/vehicule (cheia API rămâne pe server);
  // vehiculul primește linia și destinația din orarul GTFS (SERV.rute: route_id → linie, sens → destinație)
  map.createPane('veh'); map.getPane('veh').style.zIndex = 640;
  var vehLayer = L.layerGroup(), vehMarks = {}, vehTimer = null, LIVE_MS = 30000;
  function vehRoute(v) { return SERV && SERV.rute && v.ruta ? SERV.rute[v.ruta] || null : null; }
  function vehKey(r) { return r ? r.linie + '|' + r.tip + '|' + r.retea : null; }
  function vehDim(v) { return !!S.line && S.line !== vehKey(vehRoute(v)); }
  function bearing(a, b) {
    var k = Math.cos(a[0] * Math.PI / 180), dx = (b[1] - a[1]) * k, dy = b[0] - a[0];
    return { deg: Math.atan2(dx, dy) * 180 / Math.PI, m: Math.sqrt(dx * dx + dy * dy) * 111000 };
  }
  function vehIcon(v, dir) {
    var r = vehRoute(v), col = r ? lineColor(r) : '#8f8e86';
    return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      html: '<div class="vehw">' + (dir == null ? '' : '<i class="veh-dir" style="transform:rotate(' + Math.round(dir) + 'deg);border-bottom-color:' + col + '"></i>') +
        '<div class="veh" style="background:' + col + '">' + esc(r ? r.linie : '?') + '</div></div>' });
  }
  function vehPopup(v) {
    var r = vehRoute(v), age = Math.max(0, Math.round(Date.now() / 1000 - v.ts));
    return '<b>' + (r ? 'Linia ' + esc(r.linie) + '</b> · ' + esc(r.tip) + ' ' + esc(r.retea) : 'Vehicul fără linie atribuită</b>') +
      (r && v.sens != null && r.spre[v.sens] ? '<br>spre ' + esc(r.spre[v.sens]) : '') +
      '<br><span class="note">vehiculul ' + esc(v.nr || v.id) + (v.v != null ? ' · ' + v.v + ' km/h' : '') + ' · semnal acum ' +
      (age < 90 ? age + ' s' : Math.round(age / 60) + ' min') + '</span>';
  }
  function restyleLive() {
    Object.keys(vehMarks).forEach(function (id) { var m = vehMarks[id]; m.mk.setOpacity(vehDim(m.v) ? 0.12 : 1); });
  }
  function drawLive(d) {
    var seen = {};
    (d.vehicule || []).forEach(function (v) {
      var ll = [v.lat, v.lng], m = vehMarks[v.id];
      seen[v.id] = 1;
      if (m) {
        var b = bearing(m.ll, ll);
        if (b.m > 8) m.dir = b.deg;                    // direcția: din deplasarea față de poziția anterioară
        m.ll = ll; m.v = v;
        m.mk.setLatLng(ll).setIcon(vehIcon(v, m.dir)).setPopupContent(vehPopup(v));
      } else {
        m = vehMarks[v.id] = { ll: ll, v: v, dir: null };
        m.mk = L.marker(ll, { pane: 'veh', icon: vehIcon(v, null) }).bindPopup(vehPopup(v)).addTo(vehLayer);
      }
    });
    Object.keys(vehMarks).forEach(function (id) { if (!seen[id]) { vehLayer.removeLayer(vehMarks[id].mk); delete vehMarks[id]; } });
    restyleLive();
    var n = d.vehicule.length, linked = d.vehicule.filter(vehRoute).length;
    $('liveNote').innerHTML = n + ' vehicule cu semnal în ultimele 10 minute (' + linked + ' pe o linie), actualizat la ' +
      new Date(d.actualizat * 1000).toLocaleTimeString('ro-RO') + '. Sursa: GPS CTP Iași, prin <a href="https://tranzy.ai/opendata/" target="_blank" rel="noopener">Tranzy</a>. Săgeata arată direcția de mers.';
  }
  function loadLive() {
    if (document.hidden) return;                        // fila nu e vizibilă: nu consumăm cereri
    fetch('/live/vehicule', { cache: 'no-store' }).then(function (r) {
      return r.json().then(function (d) { if (!r.ok) throw new Error(d.eroare || 'eroare ' + r.status); return d; });
    }).then(drawLive).catch(function (e) {
      $('liveNote').innerHTML = 'Pozițiile în timp real nu sunt disponibile acum: ' + esc(e.message);
    });
  }
  $('showLive').addEventListener('change', function () {
    $('liveNote').hidden = !this.checked;
    if (this.checked) {
      vehLayer.addTo(map); $('liveNote').textContent = 'Se încarcă pozițiile…';
      loadLive(); vehTimer = setInterval(loadLive, LIVE_MS);
    } else {
      map.removeLayer(vehLayer); clearInterval(vehTimer); vehTimer = null;
    }
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && vehTimer) loadLive(); });

  // ---------- fișiere încărcate de utilizator (rămân în browser) ----------
  function kmlToGeoJSON(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml'), feats = [];
    function coords(s) { return s.trim().split(/\s+/).map(function (t) { var p = t.split(','); return [+p[0], +p[1]]; }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); }); }
    Array.prototype.forEach.call(doc.getElementsByTagName('Placemark'), function (pm) {
      var nm = pm.getElementsByTagName('name')[0], folder = pm.parentNode && pm.parentNode.getElementsByTagName ? pm.parentNode.getElementsByTagName('name')[0] : null;
      var name = nm ? nm.textContent.trim() : '', fname = folder && folder.parentNode === pm.parentNode ? folder.textContent.trim() : '';
      var lines = Array.prototype.map.call(pm.getElementsByTagName('LineString'), function (ls) { return coords(ls.getElementsByTagName('coordinates')[0].textContent); }).filter(function (c) { return c.length > 1; });
      var text = name + ' ' + fname, m = text.match(/(?:linia|linie|traseul?|tramvai(?:ul)?|autobuz(?:ul)?|\bl)\s*[:#nr.]*\s*(\d{1,3}[a-z]?)\b/i) || name.match(/^\s*(\d{1,3}[a-z]?)\b/i) || fname.match(/^\s*(\d{1,3}[a-z]?)\b/i);
      var ref = m ? m[1].toLowerCase() : null, tip = /tram/i.test(text) ? 'tramvai' : /autobuz|bus/i.test(text) ? 'autobuz' : ref && parseInt(ref, 10) <= 15 ? 'tramvai' : 'autobuz';
      if (lines.length) feats.push({ type: 'Feature', properties: { linie: ref, tip: tip, nume: name || fname }, geometry: lines.length === 1 ? { type: 'LineString', coordinates: lines[0] } : { type: 'MultiLineString', coordinates: lines } });
      Array.prototype.forEach.call(pm.getElementsByTagName('Point'), function (pt) {
        var c = coords(pt.getElementsByTagName('coordinates')[0].textContent)[0];
        if (c) feats.push({ type: 'Feature', properties: { nume: name }, geometry: { type: 'Point', coordinates: c } });
      });
    });
    return { type: 'FeatureCollection', features: feats };
  }
  $('file').addEventListener('change', function () {
    Array.prototype.forEach.call(this.files, function (file) {
      file.text().then(function (txt) {
        var geo = /\.kml$/i.test(file.name) ? kmlToGeoJSON(txt) : JSON.parse(txt);
        (geo.features || []).forEach(function (f) {
          var p = f.properties = f.properties || {};
          if (!p.linie) { var m = String(p.ref || p.name || p.nume || p.Name || '').match(/(\d{1,3}[a-z]?)\b/i); p.linie = m ? m[1].toLowerCase() : null; }
          if (!p.tip) p.tip = /tram/i.test(JSON.stringify(p)) ? 'tramvai' : p.linie && parseInt(p.linie, 10) <= 15 ? 'tramvai' : 'autobuz';
        });
        addLines(geo, extraLayer, file.name);
        prepareServed();
        addStops(geo);
        renderLineChips();
        var b = L.geoJSON(geo).getBounds();
        if (b.isValid()) map.fitBounds(b, { padding: [20, 20] });
        $('linesNote').textContent = 'Previzualizare: ' + file.name + ' (' + geo.features.length + ' obiecte). Fișierul nu a fost încărcat pe server.';
      }).catch(function (e) { $('linesNote').textContent = file.name + ': nu am putut citi fișierul (' + e.message + ').'; });
    });
  });

  function iasiBox() {
    var I = T.iasi;
    if (!I) { $('iasiBox').hidden = true; return; }
    var y = I.months[0].slice(0, 4), zm = { t: 0, c: 0 }, rows = '';
    var i0 = MONTHS.indexOf(y + '-01');
    UATS.forEach(function (u) {
      CATS.forEach(function (c) {
        for (var k = i0; k >= 0 && k < i0 + 12; k++) ['d_', 'r_'].forEach(function (p) { zm.t += u.s[p + c[0]][0][k] || 0; zm.c += u.s[p + c[0]][1][k] || 0; });
      });
    });
    var tt = 0, tc = 0;
    CATS.forEach(function (c) {
      var t = I.s[c[0]][0].reduce(function (a, b) { return a + b; }, 0), cc = I.s[c[0]][1].reduce(function (a, b) { return a + b; }, 0);
      tt += t; tc += cc;
      rows += '<tr><td><i class="sw" style="background:' + COLOR[c[0]] + '"></i> ' + c[1] + '</td><td>' + fmt(t) + '</td><td>' + fmt(cc) + '</td></tr>';
    });
    $('iasi').innerHTML = '<table><tr><td></td><td class="small">titluri</td><td class="small">călătorii est.</td></tr>' + rows +
      '<tr><td><b>Total</b></td><td><b>' + fmt(tt) + '</b></td><td><b>' + fmt(tc) + '</b></td></tr></table>' +
      '<p class="note">În ' + y + ' s-au vândut în municipiul Iași de ' + (zm.t ? Math.round(tt / zm.t) : '–') + ' ori mai multe titluri decât în comunele ZMI (' + fmt(zm.t) + ', inclusiv repartizările). Centralizatorul municipiului există doar pentru ' + y + '; fără dublurile decontate de Primărie (PMI) și fără titlurile din ZM. Gratuitățile (pensionari, persoane cu handicap) sunt incluse la abonamente.</p>';
  }

  // ---------- încărcare ----------
  function getJSON(u, opt) {
    return fetch(u).then(function (r) { if (!r.ok) throw new Error(u + ': ' + r.status); return r.json(); })
      .catch(function (e) { if (opt) return null; throw e; });
  }
  Promise.all([getJSON(D + 'titluri_zm.json'), getJSON('../data/zmi_uat_web.geojson'), getJSON(D + 'statii_aglomerate.json', true),
    getJSON(D + 'linii.geojson', true), getJSON(D + 'statii.geojson', true), getJSON(D + 'gtfs_servicii.json', true)]).then(function (r) {
    T = r[0]; HOTS = r[2]; MONTHS = T.months; SERV = r[5];
    UATS = Object.keys(T.uat).map(function (k) { return T.uat[k]; });
    if (HOTS && HOTS.linii_utilizate) Object.keys(HOTS.linii_utilizate).forEach(function (tip) { HOTS.linii_utilizate[tip].forEach(function (l) { TOP[l] = tip; }); });
    drawUat(r[1]);
    S.mi = MONTHS.length - 1;
    $('month').max = MONTHS.length - 1;
    var ys = []; MONTHS.forEach(function (m) { if (ys.indexOf(m.slice(0, 4)) < 0) ys.push(m.slice(0, 4)); });
    $('ticks').innerHTML = ys.map(function (y) { return '<span>' + y + '</span>'; }).join('');
    if (r[3]) {
      addLines(r[3], lineLayer);
      prepareServed();
      renderLineChips();
      var hasTramLines = r[3].features.some(function (f) { return f.properties.tip === 'tramvai' && f.properties.linie; });
      $('linesNote').innerHTML = 'Apăsați pe o linie, pe hartă sau mai sus, pentru a o izola și a-i vedea fișa. Liniile cele mai utilizate după CTP au un halou galben' +
        (hasTramLines ? '.' : '; tramvaiul apare deocamdată ca rețea (infrastructură), fără împărțirea pe linii.') +
        ' Grosimea liniilor: numărul de curse pe zi din orarul GTFS sau, la liniile metropolitane, cota din titlurile comunelor deservite (volumul comunei împărțit egal între liniile ei – indicativ, CTP raportează vânzările pe comună).';
    } else {
      $('linesNote').innerHTML = 'Traseele liniilor nu sunt încă publicate. Se generează cu <code>scripts/transport_linii.py</code> din fișierele KML / GeoPackage / Shapefile (vezi README) – sau le puteți previzualiza mai jos, direct din calculator.';
    }
    if (r[4]) { addStops(r[4]); renderStopRank(); } else { $('showStops').parentNode.hidden = true; $('showBusStops').parentNode.hidden = true; }
    if (!busStops.length) $('showBusStops').parentNode.hidden = true;
    if (!nTramStops) $('showTramStops').parentNode.hidden = true;
    if (SERV) {
      // cu orarul GTFS: stațiile din orar (liniile exacte) înlocuiesc implicit straturile de stații din fișiere
      // celelalte straturi de stații conțin doar stațiile liniilor fără orar (AMTPI) – rămân vizibile
      $('showBusStops').parentNode.lastChild.textContent = ' Stațiile liniilor fără orar GTFS (AMTPI; de la zoom 13)';
      drawGtfsStops();
      renderGtfsRank();
      $('gtfsInfo').innerHTML = 'Orar: GTFS CTP Iași (Tranzy, <a href="https://tranzy.ai/opendata/" target="_blank" rel="noopener">tranzy.ai/opendata</a>), valabil ' +
        esc((SERV.valabil.de_la || '').replace(/(\d{4})(\d\d)(\d\d)/, '$3.$2.$1')) + '–' + esc((SERV.valabil.pana_la || '').replace(/(\d{4})(\d\d)(\d\d)/, '$3.$2.$1')) + '.';
    } else {
      $('gtfsCtl').hidden = true; $('showGtfsStops').parentNode.hidden = true;
      if (S.width === 'gtfs') S.width = 'cota';
    }
    if (HOTS) drawHots();
    iasiBox();
    var missing = UATS.filter(function (u) { return u.years.length < ys.length; }).map(function (u) {
      return u.name + ' (' + ys.filter(function (y) { return u.years.indexOf(+y) < 0; }).join(', ') + ')';
    });
    $('dataInfo').innerHTML = 'Date: ' + ys[0] + '–' + ys[ys.length - 1] + ', ' + UATS.length + ' comune. ' +
      (missing.length ? 'Lipsesc din centralizatoare: ' + esc(missing.join('; ')) + '. ' : '') +
      'Titlurile „repartizate” sunt vânzările centralizate (aplicație, puncte din Iași) împărțite de CTP pe comune. Actualizat ' + esc(T.generated) + '.';
    var b = L.latLngBounds(UATS.map(function (u) { return CENTER[u.siruta]; }).filter(Boolean));
    if (b.isValid()) map.fitBounds(b.pad(0.25));
    renderAll();
  }).catch(function (e) {
    $('kpis').innerHTML = '<p class="note">Nu am putut încărca datele: ' + esc(e.message) + '</p>';
  });
})();
