/* Raportul comparației cu OpenStreetMap: ../data/transport/comparatie_osm.json și .geojson
 * (scripts/transport_compara_osm.py). */
(function () {
  'use strict';
  var D = '../data/transport/';
  var css = getComputedStyle(document.documentElement);
  function cssv(n) { return css.getPropertyValue(n).trim(); }
  var COL = { 'doar în datele proiectului': '#f2c14e', 'doar în OSM': '#3987e5', 'linie doar în OSM': '#3987e5' };
  var STOP_COL = { 'nume diferit': '#f2c14e', 'decalat': '#d95926', 'lipsă în OSM': '#f28b82', 'doar în OSM': '#3987e5' };
  var LINE_BADGE = { 'concordant': 's-ok', 'diferențe minore': 's-minor', 'diferențe majore': 's-major', 'doar în datele proiectului': 's-only', 'doar în OSM': 's-osm' };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function osmLink(id) { return id ? '<a href="https://www.openstreetmap.org/' + esc(id) + '" target="_blank" rel="noopener">' + esc(id) + '</a>' : ''; }
  function num(v, d) { return v == null || v === '' ? '' : Number(v).toLocaleString('ro-RO', { maximumFractionDigits: d || 0 }); }
  function lineColor(r) { return r.tip === 'tramvai' ? cssv('--tram') : r.retea === 'metropolitan' ? cssv('--metro') : cssv('--bus'); }

  var map = L.map('map', { maxZoom: 18 }).setView([47.16, 27.6], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'basemap', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  var diffLayer = L.layerGroup().addTo(map);

  // tabel cu filtre pe „stare” și sortare la clic pe antet
  function table(el, filterEl, rows, cols, stateKey, badges) {
    var state = 'toate', sortK = null, asc = true;
    var states = ['toate'].concat(Object.keys(rows.reduce(function (a, r) { a[r[stateKey]] = 1; return a; }, {})));
    if (filterEl) {
      filterEl.innerHTML = states.map(function (s) {
        var n = s === 'toate' ? rows.length : rows.filter(function (r) { return r[stateKey] === s; }).length;
        return '<button type="button" data-s="' + esc(s) + '"' + (s === 'toate' ? ' class="on"' : '') + '>' + esc(s) + ' (' + n + ')</button>';
      }).join('');
      Array.prototype.forEach.call(filterEl.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          state = b.getAttribute('data-s');
          Array.prototype.forEach.call(filterEl.querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
          draw();
        });
      });
    }
    function draw() {
      var rs = rows.filter(function (r) { return state === 'toate' || r[stateKey] === state; });
      if (sortK) rs = rs.slice().sort(function (a, b) {
        var x = a[sortK], y = b[sortK];
        var c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y), 'ro', { numeric: true });
        return asc ? c : -c;
      });
      el.innerHTML = '<thead><tr>' + cols.map(function (c) { return '<th data-k="' + c[0] + '">' + esc(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (rs.length ? rs.map(function (r) {
          return '<tr>' + cols.map(function (c) {
            var v = c[2] ? c[2](r) : esc(r[c[0]]);
            if (c[0] === stateKey && badges) v = '<span class="badge ' + (badges[r[stateKey]] || '') + '">' + esc(r[stateKey]) + '</span>';
            return '<td' + (c[3] ? ' class="n"' : '') + '>' + v + '</td>';
          }).join('') + '</tr>';
        }).join('') : '<tr><td colspan="' + cols.length + '" class="note">Nimic de raportat.</td></tr>') + '</tbody>';
      Array.prototype.forEach.call(el.querySelectorAll('th'), function (th) {
        th.addEventListener('click', function () { var k = th.getAttribute('data-k'); asc = sortK === k ? !asc : true; sortK = k; draw(); });
      });
    }
    draw();
  }

  Promise.all([
    fetch(D + 'comparatie_osm.json').then(function (r) { if (!r.ok) throw new Error('comparatie_osm.json: ' + r.status); return r.json(); }),
    fetch(D + 'comparatie_osm.geojson').then(function (r) { return r.ok ? r.json() : null; })
  ]).then(function (res) {
    var C = res[0], G = res[1], S = C.sumar;
    $('meta').textContent = 'Date OSM la ' + (S.osm_la || '–').replace('T', ' ').replace('Z', ' UTC') + ' · ' + S.rute_osm_ctp + ' relații de rută CTP în OSM.';
    var st = S.statii || {}, stb = st.autobuz || {}, stt = st.tramvai || {};
    function tot(o) { return Object.keys(o).reduce(function (a, k) { return a + o[k]; }, 0); }
    $('kpis').innerHTML = [
      [S.linii.concordant || 0, 'linii concordante (din ' + S.linii.total + ')'],
      [(S.linii['diferențe minore'] || 0) + (S.linii['diferențe majore'] || 0), 'linii cu diferențe de traseu'],
      [S.linii['doar în OSM'] || 0, 'linii doar în OSM'],
      [S.linii['doar în datele proiectului'] || 0, 'linii doar în datele proiectului'],
      [(stb.concordant || 0) + ' / ' + (tot(stb) - (stb['doar în OSM'] || 0)), 'stații de autobuz concordante'],
      [(stt.concordant || 0) + ' / ' + (tot(stt) - (stt['doar în OSM'] || 0)), 'stații de tramvai concordante'],
      [(stb['doar în OSM'] || 0) + (stt['doar în OSM'] || 0), 'stații CTP doar în OSM'],
      [S.probleme_osm, 'probleme de etichetare în OSM']
    ].map(function (k) { return '<div><b>' + esc(k[0]) + '</b><small>' + esc(k[1]) + '</small></div>'; }).join('');

    table($('lines'), $('lineFilter'), C.linii, [
      ['linie', 'Linia', function (r) { return '<span class="linechip" style="background:' + lineColor(r) + '">' + esc(r.linie) + '</span>'; }],
      ['tip', 'Tip', function (r) { return esc(r.tip + (r.retea ? ' ' + r.retea : '')); }],
      ['stare', 'Stare'],
      ['proiect_acoperit_de_osm', 'Proiect acoperit de OSM %', function (r) { return num(r.proiect_acoperit_de_osm, 1); }, 1],
      ['osm_acoperit_de_proiect', 'OSM acoperit de proiect %', function (r) { return num(r.osm_acoperit_de_proiect, 1); }, 1],
      ['km_proiect', 'km proiect', function (r) { return num(r.km_proiect, 1); }, 1],
      ['km_osm', 'km OSM', function (r) { return num(r.km_osm, 1); }, 1],
      ['sensuri_proiect', 'Sensuri proiect / OSM', function (r) { return r.sensuri_proiect + ' / ' + r.sensuri_osm; }, 1],
      ['osm', 'Relații OSM', function (r) { return (r.osm || '').split(' ').filter(Boolean).map(osmLink).join('<br>') + (r.nume_osm ? '<br><span class="note">' + esc(r.nume_osm) + '</span>' : ''); }]
    ], 'stare', LINE_BADGE);

    if (C.inventar && C.inventar.length) {
      var yes = function (k) { return function (r) { return r[k] ? esc(r[k] === 'da' ? '✓' : r[k]) : '<span class="note">–</span>'; }; };
      table($('inventar'), $('invFilter'), C.inventar, [
        ['linie', 'Linia', function (r) { return '<span class="linechip" style="background:' + (r.mod === 'tramvai' ? cssv('--tram') : cssv('--metro')) + (r.stare === 'lipsește de pe hartă' ? ';opacity:.55' : '') + '">' + esc(r.linie) + '</span>'; }],
        ['mod', 'Mod'], ['stare', 'Stare'], ['proiect', 'Hartă', yes('proiect')], ['osm', 'OSM', yes('osm')],
        ['amtpi', 'AMTPI', yes('amtpi')], ['moovit', 'Moovit (descriere)', function (r) { return r.moovit ? esc(r.moovit) : '<span class="note">–</span>'; }],
        ['descriere', 'Descriere (hartă / AMTPI)']
      ], 'stare', { 'pe hartă': 's-ok', 'pe hartă (propusă)': 's-minor', 'lipsește de pe hartă': 's-major', 'în proiect (AMTPI)': 's-minor' });
    }

    if (C.amtpi && C.amtpi.length) {
      table($('amtpi'), $('amtpiFilter'), C.amtpi, [
        ['linie', 'Linia', function (r) { return '<span class="linechip" style="background:' + cssv('--metro') + (r.statut_amtpi === 'în proiect' ? ';opacity:.6' : '') + '">' + esc(r.linie) + '</span>'; }],
        ['comuna', 'Comuna'], ['statut_amtpi', 'Statut AMTPI'], ['statii_amtpi', 'Stații principale (AMTPI)'],
        ['in_proiect_date', 'În datele proiectului'], ['in_osm', 'În OSM'], ['observatii', 'Observații'],
        ['url', 'Pagina', function (r) { return r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">AMTPI</a>' : ''; }]
      ], 'statut_amtpi', { 'în exploatare': 's-ok', 'în proiect': 's-minor', 'nelistat': 's-major' });
    }

    table($('issues'), null, C.probleme, [
      ['obiect', 'Obiect'], ['nume', 'Nume'], ['problema', 'Problema'], ['osm', 'În OSM', function (r) { return osmLink(r.osm); }]
    ], 'obiect', null);

    table($('stops'), $('stopFilter'), C.statii, [
      ['mod', 'Mod'], ['stare', 'Stare'], ['nume_proiect', 'Nume în proiect'], ['nume_osm', 'Nume în OSM'],
      ['distanta_m', 'Distanța (m)', null, 1], ['linii_osm', 'Linii (OSM)'],
      ['osm', 'În OSM', function (r) { return osmLink(r.osm); }]
    ], 'stare', { 'nume diferit': 's-minor', 'decalat': 's-major', 'lipsă în OSM': 's-major', 'doar în OSM': 's-osm' });

    var others = S.rute_osm_alti_operatori || [];
    $('others').textContent = others.length ? others.length + ' rute ale altor operatori (neincluse în comparație): ' +
      others.map(function (o) { return (o.linie || '?') + (o.retea ? ' (' + o.retea + ')' : ''); }).join(', ') + '.' : 'Nu sunt.';

    $('mapLegend').innerHTML = '<span><i style="background:' + COL['doar în datele proiectului'] + '"></i>traseu doar în datele proiectului</span>' +
      '<span><i style="background:' + COL['doar în OSM'] + '"></i>traseu doar în OSM</span>' +
      Object.keys(STOP_COL).map(function (k) { return '<span><i class="dot" style="background:' + STOP_COL[k] + '"></i>stație: ' + k + '</span>'; }).join('');
    if (G) {
      var layer = L.geoJSON(G, {
        style: function (f) { return { color: COL[f.properties.unde] || '#fff', weight: f.properties.unde === 'linie doar în OSM' ? 2 : 4, opacity: 0.85, dashArray: f.properties.unde === 'linie doar în OSM' ? '4 4' : null }; },
        pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 5, weight: 1.5, color: '#1a1a19', fillColor: STOP_COL[f.properties.stare] || '#fff', fillOpacity: 0.95 }); },
        onEachFeature: function (f, l) {
          var p = f.properties;
          l.bindPopup(p.tip_dif === 'traseu'
            ? '<b>Linia ' + esc(p.linie) + '</b> (' + esc(p.tip) + ')<br>' + esc(p.unde) + ' – ' + num(p.m) + ' m' + (p.nume ? '<br>' + esc(p.nume) : '')
            : '<b>' + esc(p.nume || p.nume_osm || 'stație') + '</b><br>' + esc(p.stare) + ' (' + esc(p.mod) + ')' + (p.nume_osm && p.nume_osm !== p.nume ? '<br>în OSM: ' + esc(p.nume_osm) : '') +
              (p.m !== '' && p.m != null ? '<br>' + num(p.m) + ' m' : '') + (p.linii_osm ? '<br>linii: ' + esc(p.linii_osm) : ''));
        }
      }).addTo(diffLayer);
      if (layer.getBounds().isValid()) map.fitBounds(layer.getBounds().pad(0.05));
    }
  }).catch(function (e) {
    $('kpis').innerHTML = '<p class="note">Comparația nu este încă generată: ' + esc(e.message) + '</p>';
  });
})();
