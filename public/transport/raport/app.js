/* Raportul „Transportul public, zi de zi” (Iași): rezumatele zilnice din GPS-ul vehiculelor CTP (/live/raport, calculate
 * din oră în oră de netlify/functions/raport-zilnic.mjs), cu orarul GTFS și zonele MVA–MVI. Ziua de azi se poate calcula
 * și în pagină, din arhiva pe minut (/live/istoric). Calculele: agregare.js (GpsAgregare) și ../sanatate/core.js. */
(function () {
  'use strict';
  var G = window.GpsAgregare, C = window.SanatateCore;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (x, d) { return x == null || !isFinite(x) ? '–' : (+x).toFixed(d || 0).replace('.', ','); };
  var pct = function (x) { return x == null || !isFinite(x) ? '–' : Math.round(x * 100) + '%'; };
  var S1 = '#3987e5', S2 = '#d95926';
  var ZILE = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'];
  var LUNI = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sep.', 'oct.', 'nov.', 'dec.'];

  var plan = null, zonesGeo = null, index = { zile: [] }, cache = {}, D = null, CMP = null;
  var tlMetric = 1, trMetric = 'scor', mapMode = 'viteza', hmMetric = 0, selZone = null, selLine = null;

  function dayLabel(zi, short) {
    var d = new Date(zi + 'T12:00:00Z');
    return (short ? '' : ZILE[d.getUTCDay()] + ', ') + d.getUTCDate() + ' ' + LUNI[d.getUTCMonth()] + (short ? '' : ' ' + d.getUTCFullYear());
  }
  function getJSON(u) {
    return fetch(u, { cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.eroare || u + ': ' + r.status); return d; });
    });
  }
  function levelColor(score) { return C.level(score).culoare; }
  // culorile deschise (galben, verde-lime, gri) cer text închis
  function lightBg(c) { return ['#c9b52b', '#e5b22e', '#9cc43b', '#8f8e86', '#f2c14e'].indexOf(c) >= 0; }
  function servColor(x) { return x == null ? '#3a3a37' : x >= 0.9 ? '#2fa66a' : x >= 0.75 ? '#c9b52b' : x >= 0.5 ? '#e58a2e' : '#d8433b'; }

  // ---------- tooltip ----------
  var tipEl = $('tip');
  function tip(html, e) {
    tipEl.innerHTML = html; tipEl.hidden = false;
    var x = e.clientX + 14, y = e.clientY + 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    if (x + w > innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > innerHeight - 8) y = e.clientY - h - 14;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  function untip() { tipEl.hidden = true; }

  // ---------- grafic cu linii (o axă), cu reticul și tooltip ----------
  function lineChart(el, series, o) {
    // lățimea reală a elementului: textul rămâne la 11 px și pe telefon
    var W = Math.max(320, el.clientWidth || 900), H = o.h || (W < 600 ? 220 : 260), m = { l: 40, r: 12, t: 10, b: 24 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    var all = []; series.forEach(function (s) { s.pts.forEach(function (p) { if (p[1] != null) all.push(p[1]); }); });
    if (!all.length) { el.innerHTML = '<svg viewBox="0 0 ' + W + ' 80"><text class="empty" x="' + W / 2 + '" y="44" text-anchor="middle">Fără date pentru această zi.</text></svg>'; return; }
    var ymax = o.ymax != null ? o.ymax : niceMax(Math.max.apply(null, all)), ymin = o.ymin || 0;
    var X = function (x) { return m.l + (x - o.x0) / (o.x1 - o.x0) * iw; }, Y = function (y) { return m.t + ih - (y - ymin) / (ymax - ymin) * ih; };
    var g = '';
    (o.bands || []).forEach(function (b) { g += '<rect class="band" x="0" y="' + Y(b[1]) + '" width="' + W + '" height="' + (Y(b[0]) - Y(b[1])) + '" fill="' + b[2] + '" transform="translate(' + m.l + ',0) scale(' + iw / W + ',1)"/>'; });
    for (var i = 0; i <= 4; i++) {
      var v = ymin + (ymax - ymin) * i / 4;
      g += '<line class="grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text x="' + (m.l - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + o.yfmt(v) + '</text>';
    }
    o.ticks.forEach(function (t) { g += '<text x="' + X(t[0]) + '" y="' + (H - 6) + '" text-anchor="middle">' + t[1] + '</text>'; });
    series.forEach(function (s) {
      var d = '', pen = false;
      s.pts.forEach(function (p, k) {
        var gap = k && o.gap && p[0] - s.pts[k - 1][0] > o.gap;
        if (p[1] == null || gap) pen = false;
        if (p[1] == null) return;
        d += (pen ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); pen = true;
      });
      if (!s.noLine) g += '<path class="ln" d="' + d + '" stroke="' + s.color + '"' + (s.dash ? ' stroke-dasharray="5 4"' : '') + '/>';
      if (s.dots) s.pts.forEach(function (p) { if (p[1] != null) g += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="4" fill="' + s.color + '" stroke="#1a1a19" stroke-width="2"/>'; });
    });
    g += '<line class="cross" id="' + el.id + 'X" y1="' + m.t + '" y2="' + (m.t + ih) + '" visibility="hidden"/>';
    g += '<rect class="hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || '') + '">' + g + '</svg>';
    var svg = el.querySelector('svg'), cross = el.querySelector('.cross');
    svg.querySelector('.hit').addEventListener('mousemove', function (e) {
      var r = svg.getBoundingClientRect(), xv = o.x0 + ((e.clientX - r.left) / r.width * W - m.l) / iw * (o.x1 - o.x0);
      var rows = series.filter(function (s) { return !s.noTip; }).map(function (s) {
        var best = null;
        s.pts.forEach(function (p) { if (p[1] != null && (!best || Math.abs(p[0] - xv) < Math.abs(best[0] - xv))) best = p; });
        return best && Math.abs(best[0] - xv) <= (o.snap || 10) ? [s, best] : null;
      }).filter(Boolean);
      if (!rows.length) { cross.setAttribute('visibility', 'hidden'); untip(); return; }
      var x0 = rows[0][1][0];
      cross.setAttribute('x1', X(x0)); cross.setAttribute('x2', X(x0)); cross.setAttribute('visibility', 'visible');
      tip('<b>' + o.xfmt(x0) + '</b>' + rows.map(function (r) {
        return '<div class="r"><span><i style="background:' + r[0].color + '"></i>' + esc(r[0].name) + '</span><b>' + o.yfmt(r[1][1], true) + '</b></div>';
      }).join(''), e);
    });
    svg.querySelector('.hit').addEventListener('mouseleave', function () { cross.setAttribute('visibility', 'hidden'); untip(); });
    if (o.onClick) svg.querySelector('.hit').addEventListener('click', function (e) {
      var r = svg.getBoundingClientRect(), xv = o.x0 + ((e.clientX - r.left) / r.width * W - m.l) / iw * (o.x1 - o.x0);
      o.onClick(xv);
    });
  }
  function niceMax(v) { if (!(v > 0)) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
  var HOUR_TICKS = [300, 420, 540, 720, 960, 1140, 1320].map(function (m) { return [m, G.hhmm(m)]; });

  // ---------- cifrele zilei ----------
  function kpis() {
    var R = D.rezumat, P = CMP && CMP.rezumat;
    function delta(a, b, f, better) {
      if (!P || a == null || b == null) return '';
      var d = a - b, s = (d > 0 ? '+' : d < 0 ? '−' : '±') + f(Math.abs(d));
      return '<em title="față de ' + esc(dayLabel(CMP.zi)) + '">' + s + '</em>';
    }
    var items = [
      [fmt(R.scor), 'scorul mediu al rețelei, 06–22', delta(R.scor, P && P.scor, function (x) { return fmt(x, 1); })],
      [fmt(R.scorVarf), 'scorul la vârful de dimineață, 07–09', delta(R.scorVarf, P && P.scorVarf, function (x) { return fmt(x, 1); })],
      [pct(R.serviciu), 'din vehiculele cerute de orar au circulat cu GPS', delta(R.serviciu, P && P.serviciu, function (x) { return Math.round(x * 100) + ' pp'; })],
      [fmt(R.viteza, 1) + ' km/h', 'viteza medie de avans pe traseu', delta(R.viteza, P && P.viteza, function (x) { return fmt(x, 1); })],
      [R.curse, 'curse reconstituite capăt–capăt', ''],
      [R.durataRaport == null ? '–' : fmt(R.durataRaport, 2) + '×', 'durata reală a curselor față de orar (mediana)', delta(R.durataRaport, P && P.durataRaport, function (x) { return fmt(x, 2); })],
      [fmt(R.minuteOprit / 60, 1) + ' h', 'vehicule oprite pe traseu (ore-vehicul)', delta(R.minuteOprit / 60, P && P.minuteOprit / 60, function (x) { return fmt(x, 1); })],
      [fmt(R.plutoane, 1), 'plutoane simultane, în medie', delta(R.plutoane, P && P.plutoane, function (x) { return fmt(x, 1); })]
    ];
    $('kpis').innerHTML = items.map(function (k) { return '<div><b>' + k[0] + k[2] + '</b><small>' + k[1] + '</small></div>'; }).join('');
  }

  // ---------- cronologia zilei ----------
  var TL = {
    1: { t: 'Scorul rețelei de-a lungul zilei', f: function (v) { return fmt(v); }, max: 100,
      bands: [[80, 100, '#2fa66a'], [60, 80, '#c9b52b'], [40, 60, '#e58a2e'], [0, 40, '#d8433b']] },
    2: { t: 'Serviciul: vehicule cu GPS față de orar', f: function (v) { return pct(v); }, max: 1 },
    3: { t: 'Viteza medie de avans pe traseu (km/h)', f: function (v, t) { return fmt(v, t ? 1 : 0) + (t ? ' km/h' : ''); } },
    4: { t: 'Plutoane simultane (vehicule lipite pe aceeași linie)', f: function (v) { return fmt(v); } },
    5: { t: 'Vehicule oprite pe traseu de peste 3 minute', f: function (v) { return fmt(v); } }
  };
  function timeline() {
    var M = TL[tlMetric];
    $('tlTitle').textContent = M.t;
    var series = [{ name: dayLabel(D.zi), color: S1, pts: D.cronologie.map(function (r) { return [r[0], r[tlMetric]]; }) }];
    if (CMP) series.push({ name: dayLabel(CMP.zi), color: S2, pts: CMP.cronologie.map(function (r) { return [r[0], r[tlMetric]]; }) });
    $('tlLegend').innerHTML = series.length > 1 ? series.map(function (s) { return '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>'; }).join('') : '';
    lineChart($('timeline'), series, { x0: 300, x1: 1440, ymax: M.max, yfmt: M.f, xfmt: G.hhmm, ticks: HOUR_TICKS, gap: 20, bands: M.bands, label: M.t });
    var worst = D.cronologie.filter(function (r) { return r[1] != null && r[0] >= 360; }).sort(function (a, b) { return a[1] - b[1]; })[0];
    $('tlNote').innerHTML = (worst ? 'Cel mai slab moment: <b>' + G.hhmm(worst[0]) + '</b> (scor ' + worst[1] + ', ' + worst[4] + ' plutoane, ' + worst[5] + ' vehicule oprite). ' : '') +
      'Date: ' + D.minute + ' minute colectate (' + D.citiri + ' citiri)' + (D.final === false ? ', ziua e în curs' : '') + '.';
  }

  // ---------- zilele ----------
  var TR = { scor: ['Scorul mediu', function (v) { return fmt(v); }, 100], scorVarf: ['Scorul 07–09', function (v) { return fmt(v); }, 100],
    viteza: ['Viteza medie (km/h)', function (v, t) { return fmt(v, 1); }], durataRaport: ['Durata reală / orar', function (v) { return fmt(v, 2) + '×'; }] };
  function trend() {
    var Z = index.zile.filter(function (z) { return z.rezumat && z.rezumat[trMetric] != null; });
    var M = TR[trMetric];
    if (!Z.length) { $('trend').innerHTML = ''; $('trendNote').textContent = 'Încă nu există zile în arhivă.'; return; }
    var day0 = Date.parse(Z[0].zi + 'T12:00:00Z') / 864e5, xs = function (z) { return Date.parse(z.zi + 'T12:00:00Z') / 864e5 - day0; };
    var wk = Z.filter(function (z) { return z.dow >= 1 && z.dow <= 5; }), we = Z.filter(function (z) { return z.dow === 0 || z.dow === 6; });
    var series = [
      { name: 'zi lucrătoare', color: S1, dots: true, pts: wk.map(function (z) { return [xs(z), z.rezumat[trMetric], z.zi]; }) },
      { name: 'weekend', color: S2, dots: true, pts: we.map(function (z) { return [xs(z), z.rezumat[trMetric], z.zi]; }) }
    ];
    series.forEach(function (s) { s.noLine = true; });
    var n = xs(Z[Z.length - 1]), step = Math.max(1, Math.ceil(n / 8)), ticks = [];
    for (var i = 0; i <= n; i += step) ticks.push([i, dayLabel(new Date((day0 + i) * 864e5).toISOString().slice(0, 10), true)]);
    lineChart($('trend'), series, { x0: -0.5, x1: Math.max(n, 1) + 0.5, ymax: M[2], yfmt: M[1], h: 200, snap: 0.5, ticks: ticks, label: M[0],
      xfmt: function (x) { return dayLabel(new Date((day0 + Math.round(x)) * 864e5).toISOString().slice(0, 10)); },
      onClick: function (x) { var z = Z.filter(function (z) { return Math.abs(xs(z) - x) < 0.5; })[0]; if (z) { $('day').value = z.zi; loadDay(z.zi); } } });
    var avg = function (a) { a = a.map(function (z) { return z.rezumat[trMetric]; }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; };
    $('trendNote').innerHTML = '<span class="legend" style="display:inline-flex"><span><i class="dot" style="background:' + S1 + '"></i>zi lucrătoare' + (wk.length ? ': media ' + M[1](avg(wk), true) : '') + '</span>' +
      '<span><i class="dot" style="background:' + S2 + '"></i>weekend' + (we.length ? ': media ' + M[1](avg(we), true) : '') + '</span></span> · ' + Z.length + (Z.length === 1 ? ' zi' : ' zile') + ' în arhivă. Apăsați pe o zi pentru raportul ei.';
  }

  // ---------- harta ----------
  var map = L.map('map', { preferCanvas: true }).setView([47.1585, 27.5925], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'basemap', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  var renderer = L.canvas({ padding: 0.3 }), mapLayer = L.layerGroup().addTo(map), shapes = {};
  function band() { return +$('band').value; }
  function bandName(b) { return b < 0 ? 'toată ziua' : D.benzi[b].nume; }
  function bandHours(b) { if (b < 0) return null; var B = G.BANDS[b], h = []; for (var i = B.de; i < B.la; i++) h.push(String(i)); return h; }

  // tronsoanele unui interval (sau ale zilei întregi): [{ key, bi, viteza, pierdut, timp }]
  function segRows(b) {
    var out = [];
    Object.keys(D.tronsoane).forEach(function (key) {
      var s = D.tronsoane[key], acc = {};
      Object.keys(s.benzi).forEach(function (bb) {
        if (b >= 0 && +bb !== b) return;
        s.benzi[bb].forEach(function (x) {
          var a = acc[x[0]] || (acc[x[0]] = { dist: 0, time: 0, lost: 0 });
          a.time += x[3]; a.lost += x[2]; a.dist += (x[1] || 0) * x[3];
        });
      });
      Object.keys(acc).forEach(function (bi) {
        var a = acc[bi];
        out.push({ key: key, bi: +bi, viteza: a.time ? a.dist / a.time : null, pierdut: a.lost, timp: a.time });
      });
    });
    return out;
  }
  function segCoords(key, bi) {
    var r = plan.rute[key];
    if (!r || !r.forma) return null;
    var sh = shapes[key] || (shapes[key] = C.prepareShape(r.forma)), d0 = bi * C.CFG.bin;
    if (d0 >= sh.len) return null;
    return C.slice(sh, d0, Math.min(sh.len, d0 + C.CFG.bin)).map(function (c) { return [c[1], c[0]]; });
  }
  var LOST_STEPS = [[10, '#d8433b', '> 10 min'], [5, '#e5732e', '5–10'], [2, '#e5b22e', '2–5'], [0.5, '#8f8e86', '0,5–2']];
  function drawMap() {
    mapLayer.clearLayers();
    if (!D) return;
    var b = band(), leg = '';
    if (mapMode === 'viteza' || mapMode === 'pierdut') {
      var rows = segRows(b);
      if (mapMode === 'viteza') {
        rows.sort(function (x, y) { return y.viteza - x.viteza; }).forEach(function (r) {
          var cc = segCoords(r.key, r.bi);
          if (!cc || r.viteza == null) return;
          L.polyline(cc, { renderer: renderer, color: C.speedColor(r.viteza), weight: r.viteza < 10 ? 5 : 3.5, opacity: 0.9 })
            .bindTooltip(esc(plan.rute[r.key].linie + ' → ' + plan.rute[r.key].spre) + ': ' + fmt(r.viteza, 1) + ' km/h · ' + fmt(r.timp, 0) + ' min-vehicul', { sticky: true }).addTo(mapLayer);
        });
        leg = C.SPEED_CLASSES.map(function (c) { return '<span><i style="background:' + c[1] + '"></i>' + c[2] + '</span>'; }).join('');
      } else {
        rows.filter(function (r) { return r.pierdut >= 0.5; }).sort(function (x, y) { return x.pierdut - y.pierdut; }).forEach(function (r) {
          var cc = segCoords(r.key, r.bi);
          if (!cc) return;
          var st = LOST_STEPS.filter(function (s) { return r.pierdut >= s[0]; })[0];
          L.polyline(cc, { renderer: renderer, color: st[1], weight: 2 + Math.min(8, Math.sqrt(r.pierdut) * 1.6), opacity: 0.9 })
            .bindTooltip(esc(plan.rute[r.key].linie + ' → ' + plan.rute[r.key].spre) + ': ' + fmt(r.pierdut, 1) + ' minute-vehicul pierdute (viteza ' + fmt(r.viteza, 1) + ' km/h)', { sticky: true }).addTo(mapLayer);
        });
        leg = LOST_STEPS.map(function (s) { return '<span><i style="background:' + s[1] + '"></i>' + s[2] + '</span>'; }).join('') + '<span>minute-vehicul pierdute / 250 m</span>';
      }
    } else if (mapMode === 'puncte') {
      D.puncte.forEach(function (p) {
        L.circleMarker([p[0], p[1]], { renderer: renderer, radius: 3 + Math.sqrt(p[2]) * 1.4, color: '#1a1a19', weight: 1, fillColor: '#d8433b', fillOpacity: 0.7 })
          .bindTooltip('<b>' + fmt(p[2]) + ' minute-vehicul oprit</b><br>liniile ' + esc(p[3] || '–'), { sticky: true }).addTo(mapLayer);
      });
      leg = '<span><i class="dot" style="background:#d8433b"></i>mărimea: minutele-vehicul oprite pe traseu (toată ziua)</span>';
    } else {
      var Z = zoneRows(b), byId = {};
      Z.forEach(function (z) { byId[z.id] = z; });
      L.geoJSON(zonesGeo, {
        style: function (f) {
          var z = byId[f.properties.zone_id], sel = selZone === f.properties.zone_id;
          return { color: sel ? '#f0efec' : '#1a1a19', weight: sel ? 3 : 1, fillColor: z && z.scor != null ? levelColor(z.scor) : '#3a3a37', fillOpacity: z && z.scor != null ? 0.4 : 0.15 };
        },
        onEachFeature: function (f, lyr) {
          var z = byId[f.properties.zone_id];
          lyr.bindTooltip('<b>' + esc(f.properties.zone_name) + '</b><br>scorul liniilor: ' + fmt(z && z.scor) + '<br>viteza: ' + fmt(z && z.viteza, 1) + ' km/h · oprit ' + pct(z && z.oprit), { sticky: true });
          lyr.on('click', function () { selectZone(f.properties.zone_id); });
        }
      }).addTo(mapLayer);
      leg = C.LEVELS.map(function (l) { return '<span><i class="sq" style="background:' + l[2] + '"></i>' + l[1] + '</span>'; }).join('') + '<span>scorul liniilor care trec prin cartier</span>';
    }
    if (mapMode !== 'puncte') leg += '<span>· ' + esc(bandName(b)) + '</span>';
    $('mapLegend').innerHTML = leg;
  }

  // ---------- cartierele ----------
  function zoneRows(b) {
    var hours = bandHours(b);
    return Object.keys(D.cartiere).map(function (id) {
      var z = D.cartiere[id], veh = 0, oprit = 0, pl = 0, vs = 0, vw = 0, ss = 0, sw = 0;
      Object.keys(z.ore).forEach(function (h) {
        if (hours && hours.indexOf(h) < 0) return;
        var o = z.ore[h];
        veh += o[0]; oprit += o[2]; pl += o[3];
        if (o[1] != null) { vs += o[1] * o[0]; vw += o[0]; }
        if (o[4] != null) { ss += o[4] * o[0]; sw += o[0]; }
      });
      return { id: id, nume: z.nume, veh: veh, viteza: vw ? vs / vw : null, oprit: veh ? oprit / veh : null, pluton: veh ? pl / veh : null, scor: sw ? ss / sw : null };
    });
  }
  var zoneSort = { k: 'scor', dir: 1 };
  function zonesTable() {
    var b = band(), Z = zoneRows(b).filter(function (z) { return z.veh > 0; });
    $('zoneBand').textContent = '· ' + bandName(b);
    Z.sort(function (x, y) { var a = x[zoneSort.k], c = y[zoneSort.k]; return ((a == null) - (c == null)) || (a - c) * zoneSort.dir; });
    var cols = [['nume', 'Cartier'], ['scor', 'Scorul liniilor'], ['viteza', 'Viteză km/h'], ['oprit', 'Oprit'], ['pluton', 'Pluton'], ['veh', 'Vehicule-oră']];
    $('zones').innerHTML = '<thead><tr>' + cols.map(function (c) { return '<th data-k="' + c[0] + '">' + c[1] + (zoneSort.k === c[0] ? (zoneSort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      Z.map(function (z) {
        return '<tr data-id="' + esc(z.id) + '"' + (selZone === z.id ? ' class="sel"' : '') + '><td>' + esc(z.nume) + '</td><td><i class="lvl" style="background:' + levelColor(z.scor) + '"></i>' + fmt(z.scor) +
          '</td><td>' + fmt(z.viteza, 1) + '</td><td>' + pct(z.oprit) + '</td><td>' + pct(z.pluton) + '</td><td>' + fmt(z.veh / 60, 0) + '</td></tr>';
      }).join('') + '</tbody>';
    $('zones').querySelectorAll('th').forEach(function (th) {
      th.addEventListener('click', function () { var k = th.dataset.k; zoneSort = { k: k, dir: zoneSort.k === k ? -zoneSort.dir : (k === 'nume' || k === 'scor' || k === 'viteza' ? 1 : -1) }; zonesTable(); });
    });
    $('zones').querySelectorAll('tbody tr').forEach(function (tr) { tr.addEventListener('click', function () { selectZone(tr.dataset.id); }); });
    zoneChart();
  }
  function selectZone(id) {
    selZone = selZone === id ? null : id;
    if (selZone && mapMode !== 'cartiere') setSeg('mapSeg', 'cartiere');
    zonesTable(); drawMap();
    if (selZone) {
      var f = zonesGeo.features.filter(function (f) { return f.properties.zone_id === selZone; })[0];
      if (f) map.fitBounds(L.geoJSON(f).getBounds(), { padding: [30, 30] });
    }
  }
  function zoneChart() {
    var el = $('zoneChart');
    if (!selZone || !D.cartiere[selZone]) { el.hidden = true; return; }
    el.hidden = false;
    var mk = function (Dd) { var z = Dd && Dd.cartiere[selZone]; return z ? Object.keys(z.ore).map(Number).sort(function (a, b) { return a - b; }).map(function (h) { return [h * 60 + 30, z.ore[h][4]]; }) : []; };
    var series = [{ name: dayLabel(D.zi), color: S1, pts: mk(D), dots: true }];
    if (CMP) series.push({ name: dayLabel(CMP.zi), color: S2, pts: mk(CMP), dots: true });
    lineChart(el, series, { x0: 300, x1: 1440, ymax: 100, yfmt: function (v) { return fmt(v); }, xfmt: function (x) { return G.hhmm(x - 30) + '–' + G.hhmm(x + 30); },
      ticks: HOUR_TICKS, h: 200, snap: 30, label: 'Scorul liniilor în ' + D.cartiere[selZone].nume });
    el.insertAdjacentHTML('afterbegin', '<p class="small" style="margin:8px 0 2px"><b>' + esc(D.cartiere[selZone].nume) + '</b>: scorul liniilor care trec, pe ore' + (CMP ? ' (albastru: ' + esc(dayLabel(D.zi, true)) + ', portocaliu: ' + esc(dayLabel(CMP.zi, true)) + ')' : '') + '</p>');
  }

  // ---------- liniile pe ore ----------
  function heatmap() {
    var hours = []; for (var h = 5; h <= 23; h++) hours.push(h);
    var L_ = Object.keys(D.linii).map(function (id) {
      var l = D.linii[id], sc = Object.keys(l.ore).map(function (h) { return l.ore[h][0]; }).filter(function (x) { return x != null; });
      return { id: id, l: l, avg: sc.length ? sc.reduce(function (a, b) { return a + b; }, 0) / sc.length : null };
    }).filter(function (x) { return Object.keys(x.l.ore).length; }).sort(function (a, b) { return (a.avg == null ? 999 : a.avg) - (b.avg == null ? 999 : b.avg); });
    var color = hmMetric === 0 ? levelColor : hmMetric === 1 ? servColor : function (v) { return v == null ? '#3a3a37' : C.speedColor(v); };
    var show = hmMetric === 0 ? function (v) { return fmt(v); } : hmMetric === 1 ? function (v) { return v == null ? '' : Math.round(v * 100); } : function (v) { return fmt(v); };
    var html = '<table><thead><tr><th></th><th>media</th>' + hours.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>';
    L_.forEach(function (x) {
      html += '<tr><td class="nm" data-id="' + esc(x.id) + '"><span class="badge" style="background:' + x.l.culoare + '">' + esc(x.l.linie) + '</span> ' + (x.l.tip === 'tramvai' ? 'tramvai' : x.l.retea === 'metropolitan' ? 'metrop.' : '') + '</td>' +
        '<td class="c' + (lightBg(levelColor(x.avg)) ? ' dark' : '') + '" style="background:' + levelColor(x.avg) + '">' + fmt(x.avg) + '</td>';
      hours.forEach(function (h) {
        var o = x.l.ore[h], v = o ? o[hmMetric] : null, bg = o ? color(v) : 'transparent';
        html += '<td class="c' + (o && lightBg(bg) ? ' dark' : '') + '" style="background:' + bg + '" data-id="' + esc(x.id) + '" data-h="' + h + '">' + (o ? show(v) : '') + '</td>';
      });
      html += '</tr>';
    });
    $('heatmap').innerHTML = html + '</tbody></table>';
    $('hmLegend').innerHTML = hmMetric === 0 ? C.LEVELS.map(function (l) { return '<span><i class="sq" style="background:' + l[2] + '"></i>' + l[1] + ' (≥ ' + l[0] + ')</span>'; }).join('')
      : hmMetric === 1 ? [['#2fa66a', '≥ 90%'], ['#c9b52b', '75–90%'], ['#e58a2e', '50–75%'], ['#d8433b', '< 50%']].map(function (c) { return '<span><i class="sq" style="background:' + c[0] + '"></i>' + c[1] + '</span>'; }).join('') + '<span>vehicule cu GPS / cerute</span>'
      : C.SPEED_CLASSES.map(function (c) { return '<span><i class="sq" style="background:' + c[1] + '"></i>' + c[2] + '</span>'; }).join('');
    $('heatmap').querySelectorAll('td.c[data-h]').forEach(function (td) {
      td.addEventListener('mousemove', function (e) {
        var l = D.linii[td.dataset.id], o = l.ore[td.dataset.h];
        if (!o) return untip();
        tip('<b>' + esc((l.tip === 'tramvai' ? 'Tramvaiul ' : 'Autobuzul ') + l.linie) + ', ' + td.dataset.h + ':00–' + (+td.dataset.h + 1) + ':00</b>' +
          '<div class="r"><span>Scor</span><b>' + fmt(o[0]) + '</b></div><div class="r"><span>Vehicule cu GPS / cerute</span><b>' + fmt(o[5], 1) + ' / ' + fmt(o[6], 1) + '</b></div>' +
          '<div class="r"><span>Viteza de avans</span><b>' + fmt(o[2], 1) + ' km/h</b></div><div class="r"><span>Plutoane / opriri (medii)</span><b>' + fmt(o[3], 1) + ' / ' + fmt(o[4], 1) + '</b></div>', e);
      });
      td.addEventListener('mouseleave', untip);
    });
    $('heatmap').querySelectorAll('td.nm').forEach(function (td) { td.addEventListener('click', function () { showLine(td.dataset.id); }); });
  }

  // ---------- cursele unei linii ----------
  function showLine(id) {
    selLine = id;
    var l = D.linii[id];
    if (!l) { $('lineBox').hidden = true; return; }
    var keys = Object.keys(plan.rute).filter(function (k) { return plan.rute[k].linie === l.linie && plan.rute[k].tip === l.tip; });
    var series = [], legend = [];
    keys.forEach(function (k, i) {
      var col = i ? S2 : S1, T = D.curse.filter(function (t) { return t[0] === k; });
      // punctele: cursele reale, fără linie de legătură (fiecare cursă e separată)
      series.push({ name: 'spre ' + plan.rute[k].spre + ' (real)', color: col, dots: true, noLine: true, pts: T.map(function (t) { return [t[1], t[2]]; }).sort(function (a, b) { return a[0] - b[0]; }) });
      series.push({ name: 'spre ' + plan.rute[k].spre + ' (orar)', color: col, dash: true, pts: T.map(function (t) { return [t[1], t[3]]; }).sort(function (a, b) { return a[0] - b[0]; }) });
      legend.push('<span><i class="dot" style="background:' + col + '"></i>spre ' + esc(plan.rute[k].spre) + ': ' + T.length + ' curse</span>');
    });
    legend.push('<span><i style="background:repeating-linear-gradient(90deg,#c3c2b7 0 5px,transparent 5px 9px)"></i>durata din orar</span>');
    $('lineTitle').innerHTML = '<span class="badge" style="background:' + l.culoare + ';padding:1px 6px;border-radius:4px;color:#fff">' + esc(l.linie) + '</span> Durata curselor de-a lungul zilei (minute)';
    $('lineLegend').innerHTML = legend.join('');
    var real = series.filter(function (s) { return s.noLine; });
    lineChart($('lineChart'), series,
      { x0: 300, x1: 1440, yfmt: function (v, t) { return fmt(v, t ? 1 : 0) + (t ? ' min' : ''); }, xfmt: function (x) { return 'plecare ' + G.hhmm(x); }, ticks: HOUR_TICKS, snap: 8, label: 'Durata curselor liniei ' + l.linie });
    var all = real.reduce(function (a, s) { return a.concat(s.pts); }, []);
    $('lineNote').textContent = all.length ? all.length + ' curse reconstituite. Punctele: cursele reale; linia punctată: durata din orar la ora plecării.' : 'Nicio cursă reconstituită capăt–capăt pentru această linie în ziua aleasă.';
    $('lineBox').hidden = false;
    $('lineBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- timpii de deplasare ----------
  var tripSort = { k: 'raport', dir: -1 };
  function tripsTable() {
    var b = +$('tripBand').value, hours = b < 0 ? null : G.BANDS[b], groups = {};
    D.curse.forEach(function (t) {
      if (hours && (t[1] < hours.de * 60 || t[1] >= hours.la * 60)) return;
      (groups[t[0]] = groups[t[0]] || []).push(t);
    });
    var rows = Object.keys(groups).map(function (k) {
      var T = groups[k], r = plan.rute[k] || {};
      return { k: k, linie: r.linie, spre: r.spre, culoare: r.culoare, n: T.length, real: G.quantile(T.map(function (t) { return t[2]; }), 0.5),
        orar: G.quantile(T.map(function (t) { return t[3]; }), 0.5), raport: G.quantile(T.map(function (t) { return t[2] / t[3]; }), 0.5),
        max: Math.max.apply(null, T.map(function (t) { return t[2]; })) };
    });
    rows.sort(function (x, y) { var a = x[tripSort.k], c = y[tripSort.k]; return typeof a === 'string' ? String(a).localeCompare(c, 'ro', { numeric: true }) * tripSort.dir : (a - c) * tripSort.dir; });
    var cols = [['linie', 'Linia'], ['spre', 'Spre'], ['n', 'Curse'], ['real', 'Durata reală (mediana)'], ['orar', 'Din orar'], ['raport', 'Raport'], ['max', 'Cea mai lungă']];
    $('trips').innerHTML = '<thead><tr>' + cols.map(function (c) { return '<th data-k="' + c[0] + '">' + c[1] + (tripSort.k === c[0] ? (tripSort.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) {
        var col = r.raport > 1.25 ? '#d8433b' : r.raport > 1.1 ? '#e58a2e' : r.raport < 0.9 ? '#3987e5' : '#2fa66a';
        return '<tr data-k="' + esc(r.k) + '"><td><span class="badge" style="background:' + r.culoare + '">' + esc(r.linie) + '</span></td><td style="text-align:left">' + esc(r.spre) + '</td><td>' + r.n + '</td><td>' + fmt(r.real, 1) + ' min</td><td>' + fmt(r.orar, 1) + ' min</td><td><i class="lvl" style="background:' + col + '"></i>' + fmt(r.raport, 2) + '×</td><td>' + fmt(r.max, 1) + ' min</td></tr>';
      }).join('') : '<tr><td colspan="7" class="note">Nicio cursă reconstituită în acest interval.</td></tr>') + '</tbody>';
    $('trips').querySelectorAll('th').forEach(function (th) {
      th.addEventListener('click', function () { var k = th.dataset.k; tripSort = { k: k, dir: tripSort.k === k ? -tripSort.dir : (k === 'linie' || k === 'spre' ? 1 : -1) }; tripsTable(); });
    });
    $('trips').querySelectorAll('tbody tr[data-k]').forEach(function (tr) {
      tr.addEventListener('click', function () { var r = plan.rute[tr.dataset.k]; if (r) showLine(r.tip + '|' + r.linie); });
    });
  }

  // ---------- exporturi ----------
  var EXP = [['cronologie', 'Cronologia rețelei (5 min)'], ['linii', 'Liniile pe ore'], ['cartiere', 'Cartierele pe ore'], ['curse', 'Cursele (timpi de deplasare)'],
    ['tronsoane', 'Tronsoanele: viteză și minute pierdute'], ['puncte', 'Punctele negre']];
  function exportsBox() {
    $('exports').innerHTML = EXP.map(function (e) { return '<button type="button" class="btn" data-k="' + e[0] + '">' + e[1] + ' (CSV)</button>'; }).join('') +
      '<button type="button" class="btn ghost" data-k="json">Rezumatul zilei (JSON)</button>';
    $('exports').querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.dataset.k, body = k === 'json' ? JSON.stringify(D) : '﻿' + G.EXPORTS[k](D, plan);
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([body], { type: k === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
        a.download = 'transport_iasi_' + k + '_' + D.zi + (k === 'json' ? '.json' : '.csv');
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      });
    });
  }

  // ---------- încărcare și control ----------
  function setSeg(id, v) { document.querySelectorAll('#' + id + ' button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === String(v)); }); if (id === 'mapSeg') mapMode = v; }
  function bindSeg(id, fn) {
    document.querySelectorAll('#' + id + ' button').forEach(function (b) {
      b.addEventListener('click', function () { setSeg(id, b.dataset.v); fn(b.dataset.v); });
    });
  }
  function render() {
    if (!D) return;
    kpis(); timeline(); trend(); drawMap(); zonesTable(); heatmap(); tripsTable(); exportsBox();
    if (selLine && D.linii[selLine]) showLine(selLine); else $('lineBox').hidden = true;
    $('status').innerHTML = '<b>' + esc(dayLabel(D.zi)) + '</b>' + (D.final === false ? ' (în curs, actualizat la ' + new Date(D.generat * 1000).toLocaleTimeString('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' }) + ')' : '') +
      ' · ' + D.minute + ' minute de date' + (CMP ? ' · comparat cu ' + esc(dayLabel(CMP.zi)) : '');
  }
  function fetchDay(zi) {
    if (cache[zi]) return Promise.resolve(cache[zi]);
    return getJSON('/live/raport?zi=' + zi).then(function (d) { cache[zi] = d; return d; });
  }
  function loadDay(zi) {
    $('status').textContent = 'Se încarcă ' + dayLabel(zi) + '…';
    return fetchDay(zi).then(function (d) { D = d; render(); }).catch(function (e) { $('status').textContent = 'Nu am putut încărca ziua: ' + e.message; });
  }
  function fillSelects() {
    var opts = index.zile.slice().reverse().map(function (z) {
      return '<option value="' + z.zi + '">' + esc(dayLabel(z.zi)) + (z.final ? '' : ' (în curs)') + ' · scor ' + fmt(z.rezumat && z.rezumat.scor) + '</option>';
    }).join('');
    var cur = $('day').value, cmp = $('cmp').value;
    $('day').innerHTML = opts || '<option value="">– încă nicio zi –</option>';
    $('cmp').innerHTML = '<option value="">–</option>' + opts;
    if (cur && index.zile.some(function (z) { return z.zi === cur; })) $('day').value = cur;
    $('cmp').value = cmp;
  }

  // ziua de azi, calculată în pagină din arhiva pe minut (fără să aștepte raportul orar)
  function computeToday() {
    var zi = G.localDate(Date.now() / 1000), cur = new Date().toISOString().slice(0, 13);
    var hours = G.hoursOfDay(zi).filter(function (h) { return h <= cur; }), recs = [], done = 0;
    $('today').disabled = true;
    $('status').textContent = 'Se descarcă citirile de azi (0 / ' + hours.length + ' ore)…';
    var seq = Promise.resolve();
    hours.forEach(function (h) {
      seq = seq.then(function () {
        return getJSON('/live/istoric?ora=' + h).then(function (d) { recs = recs.concat(d.citiri || []); })
          .catch(function () { /* oră fără date */ }).then(function () { $('status').textContent = 'Se descarcă citirile de azi (' + (++done) + ' / ' + hours.length + ' ore)…'; });
      });
    });
    return seq.then(function () {
      if (!recs.length) throw new Error('arhiva nu are încă citiri pentru azi');
      $('status').textContent = 'Se calculează rezumatul a ' + recs.length + ' citiri…';
      return new Promise(function (res) { setTimeout(res, 30); });
    }).then(function () {
      var d = G.aggregateDay(plan, zonesGeo, recs, { zi: zi });
      d.final = false; d.generat = Math.round(Date.now() / 1000);
      cache[zi] = d;
      index.zile = index.zile.filter(function (z) { return z.zi !== zi; }).concat([{ zi: zi, final: false, minute: d.minute, rezumat: d.rezumat, dow: new Date(zi + 'T12:00:00Z').getUTCDay() }]);
      fillSelects(); $('day').value = zi; D = d; render();
    }).catch(function (e) { $('status').textContent = 'Nu am putut calcula ziua de azi: ' + e.message; })
      .then(function () { $('today').disabled = false; });
  }

  bindSeg('tlSeg', function (v) { tlMetric = +v; timeline(); });
  bindSeg('trSeg', function (v) { trMetric = v; trend(); });
  bindSeg('mapSeg', function () { drawMap(); });
  bindSeg('hmSeg', function (v) { hmMetric = +v; heatmap(); });
  var bandOpts = '<option value="-1">toată ziua</option>' + G.BANDS.map(function (b) { return '<option value="' + b.id + '">' + b.nume + '</option>'; }).join('');
  $('band').innerHTML = bandOpts; $('band').value = '2';
  $('tripBand').innerHTML = bandOpts; $('tripBand').value = '-1';
  $('band').addEventListener('change', function () { drawMap(); zonesTable(); });
  $('tripBand').addEventListener('change', tripsTable);
  $('day').addEventListener('change', function () { if (this.value) loadDay(this.value); });
  $('cmp').addEventListener('change', function () {
    var zi = this.value;
    if (!zi) { CMP = null; render(); return; }
    fetchDay(zi).then(function (d) { CMP = d; render(); }).catch(function (e) { $('status').textContent = 'Nu am putut încărca ziua de comparat: ' + e.message; });
  });
  $('today').addEventListener('click', computeToday);
  var rz = null;
  addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (D) { timeline(); trend(); zoneChart(); if (selLine && !$('lineBox').hidden) showLine(selLine); } }, 200); });
  $('lineClose').addEventListener('click', function () { selLine = null; $('lineBox').hidden = true; });

  Promise.all([getJSON('../../data/transport/sanatate_plan.json'), getJSON('../../data/iasi_17_zone_mva_mvi.geojson'),
    getJSON('/live/raport').catch(function () { return { zile: [] }; })]).then(function (r) {
    plan = r[0]; zonesGeo = r[1]; index = r[2] && r[2].zile ? r[2] : { zile: [] };
    fillSelects();
    var last = index.zile[index.zile.length - 1];
    if (last) return loadDay(last.zi);
    $('status').innerHTML = 'Rapoartele zilnice apar după prima rulare orară a colectării. Între timp: <b>Calculează azi, până acum</b> (din arhiva pe minut).';
  }).catch(function (e) { $('status').textContent = 'Nu am putut încărca datele de bază: ' + e.message; });
})();
