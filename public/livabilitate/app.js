/* Indicele de locuibilitate – Iași (17 zone MVA–MVI). Datele: data/livabilitate.json (scripts/livabilitate.py).
   Scalarea min–max la 1–10, ponderarea și scalarea finală se fac aici, ca ponderile să poată fi schimbate pe loc. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  // rampă secvențială albastră, o singură nuanță (deschis = scor mic, închis = scor mare)
  var RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  var nf = function (x, d) { return x == null ? '–' : x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var D, K, Z, mode = 'km2', view = 'idx', W = {}, sel = null, layers = [], map, scores;

  function hex2rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function color(s) {
    if (s == null) return '#e3e0d8';
    var t = Math.max(0, Math.min(1, (s - 1) / 9)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(t)), f = t - i;
    var a = hex2rgb(RAMP[i]), b = hex2rgb(RAMP[i + 1]);
    return 'rgb(' + a.map(function (v, j) { return Math.round(v + (b[j] - v) * f); }).join(',') + ')';
  }
  function minmax(vals) {
    var ok = vals.filter(function (v) { return v != null; });
    var lo = Math.min.apply(null, ok), hi = Math.max.apply(null, ok);
    return vals.map(function (v) { return v == null ? null : hi > lo ? 1 + 9 * (v - lo) / (hi - lo) : 1; });
  }
  function vals(k) { return Z.map(function (z) { return z[mode === 'km2' ? 'km2v' : 'popv'][k]; }); }
  function unit(k) { return k[mode === 'km2' ? 'u_km2' : 'u_pop']; }
  function digits(k) { return k.k === 'arbori' ? 0 : mode === 'pop' && k.k !== 'parcuri' && k.k !== 'sv' ? 2 : 1; }

  // Registrul Spațiilor Verzi (data/rsv.json, scripts/livabilitate_rsv.py): înlocuiește parcurile din OSM cu spațiile
  // verzi publice amenajate și adaugă arborii inventariați
  function mergeRSV(d, rsv) {
    var by = {}; rsv.zones.forEach(function (r) { by[r.id] = r; });
    d.zones.forEach(function (z) {
      var r = by[z.id]; if (!r) return;
      z.rsv = r;
      z.raw.sv = r.sv_pub; z.raw.arbori = r.arbori;
      z.km2v.sv = Math.round(r.sv_pub / (z.km2 * 1e6) * 10000) / 100;
      z.popv.sv = z.pop ? Math.round(r.sv_pub / z.pop * 100) / 100 : null;
      z.km2v.arbori = Math.round(r.arbori / z.km2 * 10) / 10;
      z.popv.arbori = z.pop ? Math.round(r.arbori / z.pop * 1000 * 10) / 10 : null;
    });
    var i = d.kpis.findIndex(function (k) { return k.k === 'parcuri'; });
    var sum = function (f) { return d.zones.reduce(function (s, z) { return s + (z.rsv ? z.rsv[f] : 0); }, 0); };
    d.kpis.splice(i, 1,
      { k: 'sv', n: 'Spații verzi publice amenajate', d: 'Spații verzi și recreere', u_km2: '% din suprafața zonei', u_pop: 'm² / locuitor',
        w: 0.10, ok: true, total: sum('sv_pub'), osm: 'Registrul Spațiilor Verzi (parcuri, scuaruri, spații dintre blocuri, aliniamente; fără pădure și fără curțile școlilor, spitalelor, bisericilor, cimitirelor)' },
      { k: 'arbori', n: 'Arbori inventariați', d: 'Spații verzi și recreere', u_km2: 'arbori / km²', u_pop: 'arbori / 1.000 loc.',
        w: 0.05, ok: true, total: sum('arbori'), osm: 'Registrul Spațiilor Verzi, stratul arborilor' });
    d.rsv = rsv;
  }

  function compute() {
    var tot = K.reduce(function (s, k) { return s + W[k.k]; }, 0) || 1;
    var per = {};
    K.forEach(function (k) { per[k.k] = minmax(vals(k.k)); });
    var sum = Z.map(function (z, i) {
      var s = 0, w = 0;
      K.forEach(function (k) { var v = per[k.k][i]; if (v != null && W[k.k] > 0) { s += v * W[k.k]; w += W[k.k]; } });
      return w ? s / w : null;
    });
    scores = { per: per, idx: minmax(sum), tot: tot };
  }

  function current(i) { return view === 'idx' ? scores.idx[i] : scores.per[view][i]; }

  function render() {
    compute();
    layers.forEach(function (l, i) {
      l.setStyle({ fillColor: color(current(i)), fillOpacity: .78, color: sel === i ? '#15171a' : '#fff', weight: sel === i ? 3 : 1.5 });
      l.setPopupContent(popup(i));
    });
    var k = view === 'idx' ? null : K.filter(function (x) { return x.k === view; })[0];
    $('viewNote').textContent = k ? k.n + ' – ' + unit(k) + '. Sursa: ' + (k.k === 'sv' || k.k === 'arbori' ? '' : 'OpenStreetMap, ') + k.osm + '.' :
      'Indicele unificat: media ponderată a celor ' + K.filter(function (x) { return W[x.k] > 0; }).length + ' indicatori activi, scalată la 1–10.';
    $('rankRaw').textContent = k ? 'Valoare' : '';
    var order = Z.map(function (z, i) { return i; }).sort(function (a, b) { return (current(b) || 0) - (current(a) || 0); });
    var tb = $('rank').tBodies[0]; tb.innerHTML = '';
    order.forEach(function (i, r) {
      var tr = document.createElement('tr');
      var raw = k ? nf(vals(view)[i], digits(k)) : '';
      tr.innerHTML = '<td>' + (r + 1) + '</td><td><span class="sw" style="background:' + color(current(i)) + '"></span>' + Z[i].n + '</td><td><b>' + nf(current(i), 1) + '</b></td><td>' + raw + '</td>';
      if (i === sel) tr.className = 'sel';
      tr.onclick = function () { select(i, true); };
      tb.appendChild(tr);
    });
    var best = order[0], worst = order[order.length - 1];
    var pop = Z.reduce(function (s, z) { return s + (z.pop || 0); }, 0), area = Z.reduce(function (s, z) { return s + z.km2; }, 0);
    $('summary').innerHTML = '<div><b>' + Z[best].n + '</b><small>cel mai mare scor</small></div><div><b>' + Z[worst].n + '</b><small>cel mai mic scor</small></div>' +
      '<div><b>' + nf(area, 1) + ' km²</b><small>suprafața celor 17 zone</small></div><div><b>' + nf(pop, 0) + '</b><small>locuitori (2020)</small></div>';
    K.forEach(function (x) {
      $('o-' + x.k).textContent = Math.round(W[x.k] / scores.tot * 100) + '%';
      var u = $('u-' + x.k); if (u) u.textContent = unit(x) + (x.ok ? '' : ' · puțin cartografiat (' + nf(x.total, 0) + ' în tot orașul)');
    });
    hash();
  }

  function popup(i) {
    var z = Z[i], h = '<div class="pop"><h3>' + z.n + '</h3><p class="big">Indice: <b>' + nf(scores.idx[i], 1) + '</b> / 10 · ' + nf(z.km2, 2) + ' km² · ' + nf(z.pop, 0) + ' loc.</p><table>';
    K.forEach(function (k) {
      h += '<tr><td>' + k.n + (W[k.k] ? '' : ' <span class="u">(pondere 0)</span>') + '<div class="u">' + nf(vals(k.k)[i], digits(k)) + ' ' + unit(k) + '</div></td><td><b>' + nf(scores.per[k.k][i], 1) + '</b></td></tr>';
    });
    if (z.rsv && z.pop) h += '</table><p class="u">Registrul Spațiilor Verzi: ' + nf(z.rsv.sv_pub / z.pop, 1) + ' m²/loc. amenajat cu acces public; ' +
      nf(z.rsv.sv_tot / z.pop, 1) + ' m²/loc. cu tot cu pădure și spațiile cu acces restricționat (norma OUG 114/2007: 26 m²/loc.)' +
      (z.rsv.padure ? '; pădure ' + nf(z.rsv.padure / 1e4, 1) + ' ha' : '') + '.</p>';
    else h += '</table>';
    return h + '<p class="u">Scoruri 1–10 față de celelalte zone.</p></div>';
  }

  function select(i, zoom) {
    sel = i; render();
    if (zoom) { map.fitBounds(layers[i].getBounds(), { maxZoom: 14, padding: [30, 30] }); layers[i].openPopup(); }
  }

  function buildWeights() {
    var box = $('weights'), dim = null; box.innerHTML = '';
    K.forEach(function (k) {
      if (k.d !== dim) { dim = k.d; var h = document.createElement('div'); h.className = 'dim'; h.textContent = dim; box.appendChild(h); }
      var row = document.createElement('div'); row.className = 'w' + (k.ok ? '' : ' bad');
      row.innerHTML = '<label for="w-' + k.k + '">' + k.n + '<small id="u-' + k.k + '"></small></label><input type="range" id="w-' + k.k + '" min="0" max="30" step="1"><output id="o-' + k.k + '"></output>';
      box.appendChild(row);
      var inp = row.querySelector('input'); inp.value = W[k.k];
      inp.oninput = function () { W[k.k] = +inp.value; render(); };
    });
  }
  function setWeights(f) { K.forEach(function (k) { W[k.k] = f(k); $('w-' + k.k).value = W[k.k]; }); render(); }

  function setMode(m) {
    mode = m;
    document.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.m === m); });
    render();
  }

  function hash() {
    var w = K.map(function (k) { return W[k.k]; }).join(',');
    history.replaceState(null, '', '#m=' + mode + '&v=' + view + '&w=' + w);
  }
  function readHash() {
    var p = {}; location.hash.slice(1).split('&').forEach(function (s) { var a = s.split('='); p[a[0]] = decodeURIComponent(a[1] || ''); });
    if (p.m === 'pop' || p.m === 'km2') mode = p.m;
    if (p.v && (p.v === 'idx' || K.some(function (k) { return k.k === p.v; }))) view = p.v;
    if (p.w) { var a = p.w.split(',').map(Number); if (a.length === K.length && a.every(function (x) { return x >= 0 && x <= 30; })) K.forEach(function (k, i) { W[k.k] = a[i]; }); }
  }

  function csv() {
    var head = ['zona', 'denumire', 'km2', 'locuitori', 'indice_1_10'];
    K.forEach(function (k) { head.push(k.k + '_valoare (' + unit(k) + ')', k.k + '_scor', k.k + '_pondere_%'); });
    var rows = [head];
    Z.forEach(function (z, i) {
      var r = [z.id, z.n, z.km2, z.pop, scores.idx[i] == null ? '' : scores.idx[i].toFixed(2)];
      K.forEach(function (k) { r.push(vals(k.k)[i], scores.per[k.k][i] == null ? '' : scores.per[k.k][i].toFixed(2), (W[k.k] / scores.tot * 100).toFixed(1)); });
      rows.push(r);
    });
    var txt = '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' }));
    a.download = 'locuibilitate_iasi_' + mode + '.csv'; a.click();
  }

  function init(d) {
    D = d; K = d.kpis; Z = d.zones;
    K.forEach(function (k) { W[k.k] = Math.round(k.w * 100); });
    readHash();
    var s = $('view'); s.innerHTML = '<option value="idx">Indicele unificat (1–10)</option>';
    var dim = null, g;
    K.forEach(function (k) {
      if (k.d !== dim) { dim = k.d; g = document.createElement('optgroup'); g.label = dim; s.appendChild(g); }
      var o = document.createElement('option'); o.value = k.k; o.textContent = k.n + ' (scor 1–10)'; g.appendChild(o);
    });
    s.value = view; s.onchange = function () { view = s.value; render(); };
    $('legend').querySelector('.bar').style.background = 'linear-gradient(to right,' + RAMP.join(',') + ')';
    buildWeights();
    $('wChapter').onclick = function () { setWeights(function (k) { return Math.round(k.w * 100); }); };
    $('wEqual').onclick = function () { setWeights(function (k) { return k.ok ? 10 : 0; }); };
    document.querySelectorAll('.seg button').forEach(function (b) { b.onclick = function () { setMode(b.dataset.m); }; });
    $('csv').onclick = csv;

    map = L.map('map', { zoomSnap: .25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, className: 'basemap',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contribuitorii OpenStreetMap</a>' }).addTo(map);
    var all = L.featureGroup().addTo(map);
    Z.forEach(function (z, i) {
      var l = L.geoJSON(z.geom).getLayers()[0];
      l.bindPopup('', { maxWidth: 320 });
      l.bindTooltip(z.n, { permanent: true, direction: 'center', className: 'zone-label' });
      l.on('click', function () { sel = i; render(); });
      l.on('popupclose', function () { if (sel === i) { sel = null; render(); } });
      l.addTo(all); layers.push(l);
    });
    map.fitBounds(all.getBounds(), { padding: [10, 10] });
    setMode(mode);
    var bad = K.filter(function (k) { return !k.ok; });
    $('status').textContent = bad.length ? 'Puțin cartografiat în OSM (pornește cu ponderea 0): ' + bad.map(function (k) { return k.n.toLowerCase(); }).join(', ') + '.' : '';
    $('foot').innerHTML = (d.rsv ? 'Spațiile verzi și arborii: Registrul Spațiilor Verzi al municipiului Iași (Primăria Iași, actualizat ' +
      new Date(d.rsv.updated).toLocaleDateString('ro-RO') + '). ' : '') + 'Restul: date OpenStreetMap din ' + (d.osm_base ? new Date(d.osm_base).toLocaleDateString('ro-RO') : '–') +
      ' (© contribuitorii OSM, ODbL). Suprafețe și lungimi în Stereo 70. Populația: caroiajul de 100 m din <a href="../accesibilitate/">analiza accesibilității</a>. Metoda: „The Livability Index” (Urban Analytics, cap. 6), adaptată.';
  }

  var get = function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); };
  Promise.all([get('data/livabilitate.json'), get('data/rsv.json').catch(function () { return null; })])
    .then(function (a) { if (a[1]) mergeRSV(a[0], a[1]); init(a[0]); })
    .catch(function () { $('status').textContent = 'Datele nu sunt încă generate (scripts/livabilitate.py).'; });
})();
