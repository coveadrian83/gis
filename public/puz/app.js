/* Unde crește Iașul: harta planurilor urbanistice zonale votate de Consiliul Local, cu agregare pe zonele MVA–MVI,
 * pe cartiere (OSM) și pe UAT. Datele: ../data/puz_iasi.geojson, generat de scripts/puz_iasi.py. */
(function () {
  'use strict';
  var DATA_URL = '../data/puz_iasi.geojson';
  var ZONES_URL = '../data/iasi_17_zone_mva_mvi.geojson';
  var PARCELS_URL = '../data/puz_iasi_parcele.geojson';   // conturul parcelelor OCPI ale PUZ-urilor (opțional)
  var PARCEL_ZOOM = 15;
  var FUNC = [
    ['locuințe colective', '#c1272d'],
    ['mixt (locuire + servicii)', '#e8743b'],
    ['locuințe individuale', '#f2c14e'],
    ['comerț / servicii / birouri', '#1f7a99'],
    ['industrie / depozitare', '#7b5ea7'],
    ['echipamente publice', '#2e8b57'],
    ['infrastructură / transport', '#555555'],
    ['introducere în intravilan', '#8a5a2b'],
    ['extindere / transformare clădiri', '#9bc53d'],
    ['modificare PUZ anterior', '#b9a9d9'],
    ['altele', '#9a9a9a']
  ];
  var FUNC_COLOR = {}; FUNC.forEach(function (f) { FUNC_COLOR[f[0]] = f[1]; });
  var STATUS = [
    ['aprobat', 'aprobate', '#2e8b57', true],
    ['modificare', 'modificări de PUZ', '#1f7a99', true],
    ['respins', 'respinse', '#b3261e', false],
    ['prelungire', 'prelungiri', '#888', false],
    ['abrogare', 'abrogări', '#888', false],
    ['altul', 'altele', '#888', false]
  ];
  var APPROVED = { aprobat: 1, modificare: 1 };
  var PALETTE = ['#f7f4ec', '#f2c14e', '#e8743b', '#c1272d', '#6b0f1a'];
  var METRICS = {
    n: { label: 'PUZ-uri', fmt: 0 },
    area: { label: 'ha', fmt: 1 },
    apart: { label: 'apartamente', fmt: 0 },
    park: { label: 'locuri parcare', fmt: 0 },
    cap: { label: 'apartamente (capacitate teoretică)', fmt: 0 },
    lvl: { label: 'niveluri (medie)', fmt: 1 },
    loc: { label: 'locuitori noi', fmt: 0 },
    dep: { label: 'deplasări/zi', fmt: 0 },
    autoV: { label: 'autoturisme/oră (vârf)', fmt: 0 },
    atr: { label: 'deplasări atrase/zi', fmt: 0 },
    lm: { label: 'locuri de muncă', fmt: 0 },
    dens: { label: 'persoane/ha', fmt: 0 },
    acc: { label: '% locuitori la ≤ 800 m de tramvai/tren', fmt: 0 },
    noAcc: { label: 'locuitori la peste 800 m de orice stație', fmt: 0 }
  };
  var MOBILITY_URL = '../data/puz_mobilitate.json';   // modelul de generare a deplasărilor (opțional)
  var MOB = null;
  // indicatorul de mobilitate al unui PUZ pentru scenariul ales (construire × mobilitate)
  function mobVal(p, kind) {
    var m = MOB && MOB.puz[p.hcl];
    if (!m) return 0;
    var sc = $('scConstr').value, ms = $('scMob').value, at = $('scAtr').value === 'lm' ? '_atractie_lm' : '_atractie';
    return { loc: m[sc + '_locuitori'], dep: m[sc + '_' + ms + '_deplasari_zi'], autoV: m[sc + '_' + ms + '_auto_varf'],
      atr: m[sc + at + '_deplasari_zi'], lm: m.locuri_munca }[kind] || 0;
  }
  // accesul la transportul public al unui PUZ: null dacă nu a putut fi calculat (localizare pe zonă, în afara ariei)
  function mobAcc(p, key) { var m = MOB && MOB.puz[p.hcl]; return m && m[key] !== null && m[key] !== undefined ? m[key] : null; }

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (v, d) {
    return v === null || v === undefined || !isFinite(v) ? '–' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  };
  var esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fold = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };

  // ---------------------------------------------------------------- harta
  var map = L.map('map', { maxZoom: 19 }).setView([47.16, 27.59], 12);
  map.createPane('zones').style.zIndex = 350;
  var base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contribuitorii OpenStreetMap</a>'
  }).addTo(map);
  var tileErrors = 0;
  base.on('tileerror', function () { if (++tileErrors === 8) $('baseNote').textContent = 'Harta de fundal nu se încarcă; zonele și PUZ-urile sunt afișate fără fundal.'; });
  var renderer = L.canvas({ padding: 0.3 });
  map.createPane('iso').style.zIndex = 390;   // sub cercurile PUZ (overlayPane, 400), peste zone
  map.getPane('iso').style.pointerEvents = 'none';
  var isoRenderer = L.canvas({ pane: 'iso', padding: 0.3 });
  var parcelLayer = L.layerGroup().addTo(map);
  var puzLayer = L.layerGroup().addTo(map);
  var PARCELS = null, BY_HCL = {}, lastList = [];
  var zoneLayer = null;

  var ALL = [], ZONES = null, META = {};
  var state = { status: {}, func: {} };
  STATUS.forEach(function (s) { state.status[s[0]] = s[3]; });
  FUNC.forEach(function (f) { state.func[f[0]] = true; });

  // ---------------------------------------------------------------- comenzi
  function chips(el, items, sel, colorOf, labelOf) {
    el.innerHTML = '';
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = sel[it] ? '' : 'off';
      b.innerHTML = '<span class="sw" style="background:' + colorOf(it) + '"></span>' + esc(labelOf(it)) + ' <small data-k="' + esc(it) + '"></small>';
      b.onclick = function () { sel[it] = !sel[it]; b.className = sel[it] ? '' : 'off'; update(); };
      el.appendChild(b);
    });
  }

  function initControls() {
    var years = ALL.map(function (p) { return p.an; }).filter(Boolean);
    var y0 = Math.min.apply(null, years), y1 = Math.max.apply(null, years);
    ['yFrom', 'yTo'].forEach(function (id) {
      for (var y = y0; y <= y1; y++) $(id).add(new Option(y, y));
    });
    $('yFrom').value = y0; $('yTo').value = y1;
    chips($('statusChips'), STATUS.map(function (s) { return s[0]; }), state.status,
      function (k) { return STATUS.filter(function (s) { return s[0] === k; })[0][2]; },
      function (k) { return STATUS.filter(function (s) { return s[0] === k; })[0][1]; });
    chips($('funcChips'), FUNC.map(function (f) { return f[0]; }), state.func,
      function (k) { return FUNC_COLOR[k]; }, function (k) { return k; });
    ['yFrom', 'yTo', 'minArea', 'minLevels', 'showApprox', 'groupBy', 'metric', 'scConstr', 'scMob', 'scAtr', 'tableMode', 'sizeBy'].forEach(function (id) { $(id).onchange = update; });
    $('showParcels').onchange = drawParcels;
    $('showIso').onchange = function () { if (!$('showIso').checked) { isoPinned = null; clearIso(); } };
    $('q').oninput = debounce(update, 200);
    $('showZones').onchange = function () { if (zoneLayer) { if ($('showZones').checked) zoneLayer.addTo(map); else map.removeLayer(zoneLayer); } };
    $('csv').onclick = downloadCsv;
    readHash();
  }

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  // starea filtrelor în adresă (link partajabil)
  function writeHash() {
    var h = 'y=' + $('yFrom').value + '-' + $('yTo').value +
      '&st=' + Object.keys(state.status).filter(function (k) { return state.status[k]; }).join(',') +
      '&f=' + FUNC.map(function (f, i) { return state.func[f[0]] ? i : ''; }).filter(String).join(',') +
      '&a=' + $('minArea').value + '&l=' + $('minLevels').value + '&g=' + $('groupBy').value + '&m=' + $('metric').value + '&s=' + $('sizeBy').value +
      ($('q').value ? '&q=' + encodeURIComponent($('q').value) : '');
    history.replaceState(null, '', '#' + h);
  }
  function readHash() {
    var h = {};
    location.hash.slice(1).split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) h[p[0]] = decodeURIComponent(p[1] || ''); });
    if (h.y) { var y = h.y.split('-'); $('yFrom').value = y[0]; $('yTo').value = y[1]; }
    if (h.st !== undefined) { var st = h.st.split(','); Object.keys(state.status).forEach(function (k) { state.status[k] = st.indexOf(k) >= 0; }); }
    if (h.f !== undefined) { var f = h.f.split(','); FUNC.forEach(function (x, i) { state.func[x[0]] = f.indexOf(String(i)) >= 0; }); }
    ['a:minArea', 'l:minLevels', 'g:groupBy', 'm:metric', 's:sizeBy', 'q:q'].forEach(function (s) { var p = s.split(':'); if (h[p[0]] !== undefined) $(p[1]).value = h[p[0]]; });
    chips($('statusChips'), STATUS.map(function (s) { return s[0]; }), state.status,
      function (k) { return STATUS.filter(function (s) { return s[0] === k; })[0][2]; },
      function (k) { return STATUS.filter(function (s) { return s[0] === k; })[0][1]; });
    chips($('funcChips'), FUNC.map(function (f) { return f[0]; }), state.func, function (k) { return FUNC_COLOR[k]; }, function (k) { return k; });
  }

  // ---------------------------------------------------------------- filtrare
  function selected() {
    var y0 = +$('yFrom').value, y1 = +$('yTo').value, minA = +$('minArea').value, minL = +$('minLevels').value;
    var q = fold($('q').value.trim());
    return ALL.filter(function (p) {
      if (p.an < y0 || p.an > y1) return false;
      if (!state.status[p.statut] && !(state.status.altul && !(p.statut in state.status))) return false;
      if (!state.func[p.functiune in state.func ? p.functiune : 'altele']) return false;
      if (minA && !(p.suprafata_mp >= minA)) return false;
      if (minL && !(p.niveluri_max >= minL)) return false;
      if (q && p._search.indexOf(q) < 0) return false;
      return true;
    });
  }

  // ---------------------------------------------------------------- desen
  var SIZE_LABEL = { area: 'suprafața reglementată', dep: 'deplasările produse pe zi', autoV: 'autoturismele în ora de vârf',
    atr: 'deplasările atrase pe zi' };
  var sizeMax = 1;   // valoarea maximă din selecție pentru mărimea aleasă (aria cercului ∝ valoare)
  function radius(p) {
    var by = $('sizeBy').value;
    if (by === 'area' || !MOB) {
      var a = p.suprafata_mp || 500;
      return Math.max(4, Math.min(28, Math.sqrt(a) / 9));
    }
    var v = mobVal(p, by);
    return v > 0 ? Math.max(3, 28 * Math.sqrt(v / sizeMax)) : 3;
  }

  function popup(p, iso) {
    var st = STATUS.filter(function (s) { return s[0] === p.statut; })[0] || STATUS[5];
    var rows = [
      ['Data', p.data ? p.data.split('-').reverse().join('.') : '–'],
      ['Adresă', p.adresa],
      ['Funcțiune', p.functiune],
      ['Suprafață', p.suprafata_mp ? fmt(p.suprafata_mp) + ' mp' : null],
      ['Regim de înălțime', p.regim_inaltime ? p.regim_inaltime + (p.niveluri_max ? ' (' + p.niveluri_max + ' niveluri)' : '') : null],
      ['H max', p.h_max_m ? fmt(p.h_max_m, 1) + ' m' : null],
      ['POT / CUT', (p.pot_max || p.cut_max) ? (p.pot_max ? fmt(p.pot_max, 0) + '%' : '–') + ' / ' + (p.cut_max ? fmt(p.cut_max, 2) : '–') : null],
      ['Spații verzi', p.spatii_verzi_min ? 'min. ' + fmt(p.spatii_verzi_min) + '%' : null],
      ['Apartamente', p.apartamente ? fmt(p.apartamente) + srcNote(p.sursa_apartamente) : null],
      ['Capacitate teoretică', p.apartamente_capacitate ? '≈ ' + fmt(p.apartamente_capacitate) + ' apartamente <span class="note">(din suprafață × CUT; plafon, nu proiectul)</span>' : null],
      ['Locuri de parcare', p.locuri_parcare ? fmt(p.locuri_parcare) + srcNote(p.sursa_parcare) : null],
      ['Vot', p.vot_pentru !== null && p.vot_pentru !== undefined ? p.vot_pentru + ' pentru, ' + p.vot_impotriva + ' împotrivă, ' + p.vot_abtineri + ' abțineri (' + p.vot_prezenti + ' prezenți)' : null],
      ['Avize comisii', p.avize_comisii],
      ['Zonă MVA–MVI', p.zona],
      ['Cartier (OSM)', p.cartier],
      ['UAT', p.uat !== 'Iași' ? p.uat : null],
      ['Cadastral', p.cadastral],
      ['Localizare', { 'parcelă': 'pe parcelă (număr cadastral, parcelar OCPI)', 'număr': 'la adresă', 'stradă': 'pe stradă (punctul central al străzii)', 'zonă': 'aproximativă – centrul zonei', manual: 'verificată manual' }[p.precizie] || '–']
    ].filter(function (r) { return r[1]; });
    var m = MOB && MOB.puz[p.hcl];
    if (m && (m.realist_locuitori || m.realist_atractie_deplasari_zi)) {
      var cell = function (sc, ms) { return fmt(m[sc + '_' + ms + '_auto_varf']); };
      rows.push(['Impact estimat', (m.realist_locuitori ? '≈ ' + fmt(m.realist_locuitori) + ' locuitori (realist), ' + fmt(m.maxim_locuitori) + ' (maxim)<br>' +
        'autoturisme în ora de vârf – realist: ' + cell('realist', 'RPL') + ' (RPL) / ' + cell('realist', 'PMUD') + ' (PMUD); maxim: ' +
        cell('maxim', 'RPL') + ' / ' + cell('maxim', 'PMUD') : '') +
        (m.realist_atractie_deplasari_zi ? (m.realist_locuitori ? '<br>' : '') + 'deplasări atrase de activități: ≈ ' + fmt(m.realist_atractie_deplasari_zi) + '/zi (ITE)' +
          (m.zona_functionala_lm ? ', ≈ ' + fmt(m.realist_atractie_lm_deplasari_zi) + '/zi după locurile de muncă' : '') : '') +
        (m.locuri_munca ? '<br>≈ ' + fmt(m.locuri_munca) + ' locuri de muncă <span class="note">(' + esc(m.zona_functionala_lm) + ', Covăsnianu 2023)</span>' : '') +
        (m.realist_densitate_umana ? '<br>densitate umană: ≈ ' + fmt(m.realist_densitate_umana) + ' persoane/ha (realist), ' + fmt(m.maxim_densitate_umana) + ' (maxim)' : '') +
        (m.dist_statie_m !== null && m.dist_statie_m !== undefined ? '<br>transport public' + (m.acces_metoda === 'rețea pietonală' ? ' (pe rețeaua pietonală)' : '') + ': stație la ' + fmt(m.dist_statie_m) + ' m' +
          (m.dist_tramvai_tren_m !== null ? ', tramvai/tren la ' + fmt(m.dist_tramvai_tren_m) + ' m' : '') + '; ' + m.statii_800m + ' stații la ≤ 800 m' +
          (m.acces_tp_800m ? '' : ' <b>(fără stație în 10 minute de mers pe jos)</b>') : '') +
        (m.construit_dupa_hcl_mp ? '<br><span class="note">construcții înscrise în eTerra după aprobare (până în 05.2023): ' + fmt(m.construit_dupa_hcl_mp) + ' mp amprentă</span>' : '') +
        ' <a href="metodologie.html" target="_blank">metodă</a>']);
    }
    var links = [];
    if (p.url_pdf) links.push('<a href="' + esc(p.url_pdf) + '" target="_blank" rel="noopener">HCL (PDF oficial)</a>');
    if (p.url_usr) links.push('<a href="' + esc(p.url_usr) + '" target="_blank" rel="noopener">text integral</a>');
    (p.apix_articole || '').split(' | ').filter(Boolean).slice(0, 3).forEach(function (u, i) {
      links.push('<a href="' + esc(u) + '" target="_blank" rel="noopener">apix.ro' + (i ? ' ' + (i + 1) : '') + '</a>');
    });
    return '<div class="pop"><h3>HCL ' + esc(p.hcl) + ' <span class="st" style="background:' + st[2] + '">' + esc(p.statut) + '</span></h3>' +
      (p.scop ? '<div class="scop">' + esc(p.scop) + '</div>' : '') +
      '<table>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>' +
      (iso ? '<div class="iso">' + iso + '</div>' : '') +
      links.join(' · ') + (p.nota ? '<div class="note">' + esc(p.nota) + '</div>' : '') + '</div>';
  }
  function srcNote(s) {
    if (!s) return '';
    if (s === 'HCL') return ' <span class="note">(din HCL)</span>';
    var m = s.match(/^(.*?):\s*(https?:\S+)$/);
    return m ? ' <span class="note">(<a href="' + esc(m[2]) + '" target="_blank" rel="noopener">' + esc(m[1]) + '</a>)</span>' : ' <span class="note">(' + esc(s) + ')</span>';
  }

  // PUZ-urile cu aceeași poziție (aceeași stradă / zonă) se desfac într-o spirală mică, doar la afișare
  function spread(list) {
    var seen = {}, out = {};
    list.forEach(function (p) {
      if (!p._ll) return;
      var k = p._ll[0].toFixed(5) + ',' + p._ll[1].toFixed(5), i = seen[k] = (seen[k] || 0) + 1;
      if (i === 1) { out[p.hcl] = p._ll; return; }
      var r = 45 * Math.sqrt(i - 1), a = (i - 1) * 2.39996;
      out[p.hcl] = [p._ll[0] + r * Math.sin(a) / 110540, p._ll[1] + r * Math.cos(a) / (111320 * Math.cos(p._ll[0] * Math.PI / 180))];
    });
    return out;
  }

  function drawPoints(list) {
    puzLayer.clearLayers();
    var showApprox = $('showApprox').checked, by = $('sizeBy').value;
    sizeMax = 1;
    if (by !== 'area' && MOB) list.forEach(function (p) { sizeMax = Math.max(sizeMax, mobVal(p, by)); });
    $('sizeNote').textContent = SIZE_LABEL[by] || SIZE_LABEL.area;
    var pos = spread(list.slice().sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); }));
    list.slice().sort(function (a, b) { return (b.suprafata_mp || 0) - (a.suprafata_mp || 0); }).forEach(function (p) {
      if (!p._ll) return;
      var approx = p.precizie === 'zonă';
      if (approx && !showApprox) return;
      var col = FUNC_COLOR[p.functiune] || FUNC_COLOR.altele;
      var rejected = !APPROVED[p.statut] && p.statut !== 'altul';
      isoEvents(L.circleMarker(pos[p.hcl] || p._ll, {
        renderer: renderer, radius: radius(p), color: rejected ? '#b3261e' : '#15171a', weight: rejected ? 2 : 1,
        dashArray: approx ? '3 3' : null, fillColor: col, fillOpacity: rejected ? 0.08 : 0.7, opacity: 0.9
      }).bindPopup(popup(p), { maxWidth: 360 }).bindTooltip(esc(p.adresa || p.hcl), { direction: 'top' }), p).addTo(puzLayer);
    });
  }

  // conturul parcelelor, doar la zoom de stradă și doar pentru PUZ-urile din selecția curentă
  function drawParcels() {
    parcelLayer.clearLayers();
    if (!PARCELS || !$('showParcels').checked || map.getZoom() < PARCEL_ZOOM) return;
    var sel = {};
    lastList.forEach(function (p) { sel[p.hcl] = p; });
    var view = map.getBounds().pad(0.2);
    PARCELS.features.forEach(function (f) {
      var p = sel[f.properties.hcl];
      if (!p) return;
      var layer = L.geoJSON(f, {
        style: { color: FUNC_COLOR[p.functiune] || FUNC_COLOR.altele, weight: 2, opacity: 0.9, fillOpacity: 0.12,
          dashArray: APPROVED[p.statut] ? null : '4 3' }
      });
      if (!view.intersects(layer.getBounds())) return;
      isoEvents(layer.bindPopup(popup(p), { maxWidth: 360 }).bindTooltip(esc(p.adresa || p.hcl), { sticky: true }), p).addTo(parcelLayer);
    });
  }
  map.on('zoomend moveend', drawParcels);
  map.on('zoomend', function () { if (lastList.length) drawGroups(lastList); });

  function summary(list) {
    var appr = list.filter(function (p) { return APPROVED[p.statut]; });
    var rej = list.filter(function (p) { return p.statut === 'respins'; });
    var sum = function (arr, k) { return arr.reduce(function (s, p) { return s + (p[k] || 0); }, 0); };
    var known = function (arr, k) { return arr.filter(function (p) { return p[k]; }).length; };
    var loc = list.filter(function (p) { return p._ll; }).length;
    $('summary').innerHTML =
      '<div><b>' + fmt(appr.length) + '</b><small>aprobate (din ' + fmt(list.length) + ' selectate; ' + fmt(rej.length) + ' respinse)</small></div>' +
      '<div><b>' + fmt(sum(appr, 'suprafata_mp') / 10000, 1) + ' ha</b><small>suprafață reglementată aprobată</small></div>' +
      '<div><b>' + fmt(sum(appr, 'apartamente')) + '</b><small>apartamente, cunoscute la ' + known(appr, 'apartamente') + ' PUZ-uri</small></div>' +
      '<div><b>' + fmt(sum(appr, 'locuri_parcare')) + '</b><small>locuri de parcare, cunoscute la ' + known(appr, 'locuri_parcare') + ' PUZ-uri</small></div>' +
      '<div style="grid-column:1/-1"><b>≈ ' + fmt(sum(appr, 'apartamente_capacitate')) + '</b><small>apartamente – capacitate teoretică a PUZ-urilor de locuințe colective și mixte (suprafață × CUT, 75 mp/apartament); plafon de comparație, nu număr de proiect</small></div>' +
      '<div style="grid-column:1/-1"><small>' + fmt(loc) + ' din ' + fmt(list.length) + ' sunt pe hartă; restul nu au putut fi localizate după adresă (vezi CSV-ul).</small></div>';
    if (MOB) {
      var tot = function (k) { return appr.reduce(function (s, p) { return s + mobVal(p, k); }, 0); };
      var other = $('scMob').value === 'RPL' ? 'PMUD' : 'RPL', sc = $('scConstr').value;
      var otherV = appr.reduce(function (s, p) { var m = MOB.puz[p.hcl]; return s + (m ? m[sc + '_' + other + '_auto_varf'] || 0 : 0); }, 0);
      var g = groupStats(appr), dens = { v: g.dens, ha: g.haM }, acc = { rail: g.acc, any: g.accAny, n: g.nAcc };
      $('mobSummary').innerHTML = '<div class="mobgrid">' +
        '<div><b>' + fmt(tot('loc')) + '</b><small>locuitori noi</small></div>' +
        '<div><b>' + fmt(tot('dep')) + '</b><small>deplasări produse pe zi</small></div>' +
        '<div><b>' + fmt(tot('autoV')) + '</b><small>autoturisme în ora de vârf a dimineții (' + other + ': ' + fmt(otherV) + ')</small></div>' +
        '<div><b>' + fmt(tot('atr')) + '</b><small>deplasări atrase pe zi de comerț, birouri, echipamente (separat; ' + ($('scAtr').value === 'lm' ? 'locuri de muncă' : 'ITE') + ')</small></div>' +
        '<div><b>' + fmt(tot('lm')) + '</b><small>locuri de muncă noi (Covăsnianu 2023, Tabelul nr. 4)</small></div>' +
        '<div><b>' + fmt(dens.v) + '</b><small>persoane/ha – densitate umană pe cele ' + fmt(dens.ha, 0) + ' ha reglementate</small></div>' +
        '<div style="grid-column:1/-1"><b>' + fmt(acc.rail, 0) + '% · ' + fmt(acc.any, 0) + '%</b><small>din locuitorii noi au o stație de tramvai/tren, respectiv orice stație, la ≤ 800 m pe rețeaua pietonală (10 minute pe jos); calculat pentru ' + fmt(acc.n) + ' PUZ-uri localizate</small></div></div>';
    }
  }

  // ---------------------------------------------------------------- agregare pe zone / cartiere / UAT
  function groups(list) {
    var key = $('groupBy').value, G = {};
    list.forEach(function (p) {
      if (!APPROVED[p.statut] || !p._ll) return;
      var k = key === 'zona' ? (p.zona_id ? p.zona_id + '|' + p.zona : null) : p[key];
      if (!k) k = key === 'zona' ? '|în afara celor 17 zone' : '|necunoscut';
      var g = G[k] || (G[k] = newGroup(k));
      g.cap += p.apartamente_capacitate || 0;
      addMob(g, p);
      g.n++;
      g.area += (p.suprafata_mp || 0) / 10000;
      if (p.apartamente) { g.apart += p.apartamente; g.nAp++; }
      if (p.locuri_parcare) { g.park += p.locuri_parcare; g.nPk++; }
      if (p.niveluri_max) { g.lvlSum += p.niveluri_max; g.lvlN++; }
    });
    return Object.keys(G).map(function (k) { var g = G[k]; g.lvl = g.lvlN ? g.lvlSum / g.lvlN : null; return finishMob(g); });
  }
  function newGroup(k) {
    return { key: k, n: 0, area: 0, apart: 0, park: 0, cap: 0, loc: 0, dep: 0, autoV: 0, atr: 0, lm: 0, lvlSum: 0, lvlN: 0, nAp: 0, nPk: 0,
      peopleM: 0, haM: 0, locAcc: 0, locRail: 0, locAny: 0, noAcc: 0, nAcc: 0 };
  }
  // indicatorii de mobilitate, densitate și acces ai unui PUZ, adunați în grup
  function addMob(g, p) {
    var loc = mobVal(p, 'loc'), lm = mobVal(p, 'lm');
    g.loc += loc; g.dep += mobVal(p, 'dep'); g.autoV += mobVal(p, 'autoV'); g.atr += mobVal(p, 'atr'); g.lm += lm;
    if (MOB && MOB.puz[p.hcl] && p.suprafata_mp) { g.peopleM += loc + lm; g.haM += p.suprafata_mp / 10000; }
    var any = mobAcc(p, 'acces_tp_800m');
    if (any !== null) {
      g.nAcc++; g.locAcc += loc;
      if (mobAcc(p, 'acces_tramvai_tren_800m')) g.locRail += loc;
      if (any) g.locAny += loc; else g.noAcc += loc;
    }
  }
  function finishMob(g) {
    g.dens = g.haM ? g.peopleM / g.haM : null;
    g.acc = g.locAcc ? 100 * g.locRail / g.locAcc : null;
    g.accAny = g.locAcc ? 100 * g.locAny / g.locAcc : null;
    return g;
  }
  function groupStats(list) { var g = newGroup(''); list.forEach(function (p) { addMob(g, p); }); return finishMob(g); }

  function colorAt(t) {
    var x = Math.min(0.9999, Math.max(0, t)) * (PALETTE.length - 1), i = Math.floor(x), f = x - i;
    var a = parseInt(PALETTE[i].slice(1), 16), b = parseInt(PALETTE[i + 1].slice(1), 16);
    var ch = function (s) { return ((a >> s & 255) + ((b >> s & 255) - (a >> s & 255)) * f) | 0; };
    return 'rgb(' + ch(16) + ',' + ch(8) + ',' + ch(0) + ')';
  }

  function drawGroups(list) {
    var metric = $('metric').value, key = $('groupBy').value, gs = groups(list);
    gs.sort(function (a, b) { return (b[metric] || 0) - (a[metric] || 0); });
    var zoneVal = {}, max = 0;
    if (key === 'zona') gs.forEach(function (g) { var id = g.key.split('|')[0]; if (id) { zoneVal[id] = g[metric] || 0; max = Math.max(max, zoneVal[id]); } });
    if (zoneLayer) zoneLayer.eachLayer(function (l) {
      var id = l.feature.properties.zone_id, v = zoneVal[id];
      var k = map.getZoom() >= PARCEL_ZOOM ? 0.25 : 1;   // la zoom de stradă zonele nu acoperă parcelele
      l.setStyle(key === 'zona' && max ? { fillColor: colorAt((v || 0) / max), fillOpacity: (v ? 0.45 : 0.05) * k } : { fillColor: '#ffffff', fillOpacity: 0.05 });
    });
    $('zoneLegend').innerHTML = key === 'zona' && max
      ? '<span>0</span><span class="bar" style="background:linear-gradient(to right,' + [0, .25, .5, .75, 1].map(colorAt).join(',') + ')"></span><span>' + fmt(max, METRICS[metric].fmt) + ' ' + METRICS[metric].label + '</span>'
      : '';
    var head = { zona: 'Zonă', cartier: 'Cartier', uat: 'UAT' }[key];
    var mobTable = MOB && $('tableMode').value === 'mob', densTable = MOB && $('tableMode').value === 'dens';
    if (densTable) {
      $('groupTable').innerHTML = '<thead><tr><th>' + head + '</th><th>PUZ</th><th title="locuitori noi estimați">locuitori</th><th title="locuri de muncă (Covăsnianu 2023, Tabelul nr. 4)">loc. muncă</th><th title="(locuitori + locuri de muncă) / ha reglementat">pers./ha</th><th title="locuitori noi cu stație de tramvai sau tren la ≤ 800 m">≤800 m tram.</th><th title="locuitori noi cu orice stație de transport public la ≤ 800 m">≤800 m TP</th></tr></thead><tbody>' +
        gs.map(function (g) {
          var parts = g.key.split('|'), label = key === 'zona' ? (parts[1] || parts[0]) : g.key.replace(/^\|/, '');
          var sw = key === 'zona' && parts[0] ? '<span class="sw" style="background:' + colorAt((zoneVal[parts[0]] || 0) / (max || 1)) + '"></span>' : '';
          var pct = function (v) { return v === null ? '–' : fmt(v) + '%'; };
          return '<tr data-k="' + esc(g.key) + '"><td>' + sw + esc(label) + '</td><td>' + g.n + '</td><td>' + fmt(g.loc) + '</td><td>' +
            fmt(g.lm) + '</td><td>' + fmt(g.dens) + '</td><td>' + pct(g.acc) + '</td><td>' + pct(g.accAny) + '</td></tr>';
        }).join('') + '</tbody>';
    } else if (mobTable) {
      $('groupTable').innerHTML = '<thead><tr><th>' + head + '</th><th>PUZ</th><th title="locuitori noi estimați">locuitori</th><th title="deplasări produse de locuitori pe zi">depl./zi</th><th title="autoturisme în ora de vârf a dimineții">auto vârf</th><th title="deplasări atrase de comerț, birouri, echipamente pe zi (separat)">atrase/zi</th></tr></thead><tbody>' +
        gs.map(function (g) {
          var parts = g.key.split('|'), label = key === 'zona' ? (parts[1] || parts[0]) : g.key.replace(/^\|/, '');
          var sw = key === 'zona' && parts[0] ? '<span class="sw" style="background:' + colorAt((zoneVal[parts[0]] || 0) / (max || 1)) + '"></span>' : '';
          return '<tr data-k="' + esc(g.key) + '"><td>' + sw + esc(label) + '</td><td>' + g.n + '</td><td>' + fmt(g.loc) + '</td><td>' +
            fmt(g.dep) + '</td><td>' + fmt(g.autoV) + '</td><td>' + fmt(g.atr) + '</td></tr>';
        }).join('') + '</tbody>';
    } else
    $('groupTable').innerHTML = '<thead><tr><th>' + head + '</th><th>PUZ</th><th>ha</th><th title="apartamente cunoscute">apart.</th><th title="locuri de parcare cunoscute">parcări</th><th title="capacitate teoretică din suprafață × CUT">cap.</th><th title="niveluri maxime, medie">niv.</th></tr></thead><tbody>' +
      gs.map(function (g) {
        var parts = g.key.split('|'), label = key === 'zona' ? (parts[1] || parts[0]) : g.key.replace(/^\|/, '');
        var sw = key === 'zona' && parts[0] ? '<span class="sw" style="background:' + colorAt((zoneVal[parts[0]] || 0) / (max || 1)) + '"></span>' : '';
        return '<tr data-k="' + esc(g.key) + '"><td>' + sw + esc(label) + '</td><td>' + g.n + '</td><td>' + fmt(g.area, 1) + '</td><td>' +
          (g.nAp ? fmt(g.apart) : '–') + '</td><td>' + (g.nPk ? fmt(g.park) : '–') + '</td><td>' + (g.cap ? fmt(g.cap) : '–') + '</td><td>' + fmt(g.lvl, 1) + '</td></tr>';
      }).join('') + '</tbody>';
    Array.prototype.forEach.call($('groupTable').querySelectorAll('tbody tr'), function (tr) {
      tr.onclick = function () { focusGroup(tr.getAttribute('data-k'), list); };
    });
  }

  function focusGroup(k, list) {
    var key = $('groupBy').value;
    if (key === 'zona' && zoneLayer) {
      var id = k.split('|')[0], hit = null;
      zoneLayer.eachLayer(function (l) { if (l.feature.properties.zone_id === id) hit = l; });
      if (hit) { map.fitBounds(hit.getBounds(), { maxZoom: 15 }); return; }
    }
    var pts = list.filter(function (p) {
      if (!p._ll || !APPROVED[p.statut]) return false;
      var v = key === 'zona' ? (p.zona_id ? p.zona_id + '|' + p.zona : '|în afara celor 17 zone') : (p[key] || '|necunoscut');
      return v === k;
    }).map(function (p) { return p._ll; });
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { maxZoom: 16, padding: [30, 30] });
  }

  // ---------------------------------------------------------------- izocrona de 10 minute pe jos
  // Aceeași rețea pietonală și aceleași reguli ca indicatorul de acces din scripts/puz_mobilitate.py:
  // 800 m în 10 minute (≈ 1,33 m/s, teren plat), PUZ-ul legat de nodurile din 150 m, stația de nodurile din 60 m.
  var ISO_DIR = '../15min/data/iasi/', ISO_T = 600, ISO_PROF = { speed: 800 / 600, avoid: false, slope: false, maxGrade: 0 };
  var ISO_SNAP_PUZ = 150, ISO_SNAP_STATION = 60, ISO_SNAP_MAX = 500;
  var MODE_COLOR = { 1: '#6b0f1a', 2: '#1f7a99', 3: '#e8743b' }, MODE_NAME = { 1: 'tren', 2: 'tramvai', 3: 'autobuz' };
  var isoLayer = L.layerGroup().addTo(map), isoNet = null, isoLoading = null, isoFor = null, isoPinned = null, isoCache = {};

  function loadIso() {
    var C = window.Min15Core;
    if (!isoLoading) isoLoading = !C ? Promise.resolve(false) : Promise.all([
      fetch(ISO_DIR + 'graph.bin').then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
      fetch(ISO_DIR + 'pois.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    ]).then(function (res) {
      var g = C.parseGraph(res[0]), net = { C: C, g: g, grid: C.buildGrid(g), ws: C.workspace(g), stations: [] };
      res[1].pts.forEach(function (s) {
        if (s[2] !== C.STATION) return;
        var links = nodesNear(net, s[0], s[1], ISO_SNAP_STATION, 150);
        if (links.length) net.stations.push({ lon: s[0], lat: s[1], mode: s[4], links: links });
      });
      return (isoNet = net);
    }).catch(function (e) { console.warn('Rețeaua pietonală nu s-a putut încărca:', e); return (isoNet = false); });
    return isoLoading;
  }

  // nodurile la cel mult r metri de punct (cel puțin cel mai apropiat, dacă e la cel mult maxSnap): [[nod, metri], …]
  function nodesNear(net, lon, lat, r, maxSnap) {
    var C = net.C, g = net.g, grid = net.grid, near = C.nearestNode(g, grid, lon, lat, 8);
    if (near.node < 0 || near.dist > maxSnap) return [];
    var out = [[near.node, near.dist]], cosL = Math.cos(lat * Math.PI / 180);
    var cx = Math.floor((lon - grid.minLon) / grid.cellLon), cy = Math.floor((lat - grid.minLat) / grid.cellLat);
    for (var y = cy - 2; y <= cy + 2; y++) for (var x = cx - 2; x <= cx + 2; x++) {
      if (x < 0 || y < 0 || x >= grid.W || y >= grid.H) continue;
      for (var i = grid.head[y * grid.W + x]; i !== -1; i = grid.next[i]) {
        var d = Math.hypot((g.lon[i] - lon) * cosL * C.R_LON, (g.lat[i] - lat) * C.R_LAT);
        if (i !== near.node && d <= r) out.push([i, d]);
      }
    }
    return out;
  }

  function unmerc(x, y) { return [Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI, (x - 0.5) * 360]; }

  // străzile atinse în 10 minute și stațiile din izocronă; null dacă punctul nu e legat de rețea
  function isoCompute(p) {
    if (isoCache[p.hcl] !== undefined) return isoCache[p.hcl];
    var net = isoNet, C = net.C, g = net.g, sp = ISO_PROF.speed;
    var links = nodesNear(net, p._ll[1], p._ll[0], ISO_SNAP_PUZ, ISO_SNAP_MAX);
    if (!links.length) return (isoCache[p.hcl] = null);
    var dist = C.dijkstraMulti(g, links.map(function (l) { return [l[0], l[1] / sp]; }), ISO_PROF, ISO_T, net.ws);
    var lines = C.collectReach(g, dist, ISO_T, ISO_PROF).items.map(function (it) {
      var pts = C.edgePath(g, it.e, !it.fromLow), ll = [];
      if (it.frac < 1) pts = C.cutPath(pts, it.frac);
      for (var i = 0; i < pts.length; i += 2) ll.push(unmerc(pts[i], pts[i + 1]));
      return ll;
    });
    var st = net.stations.filter(function (s) {
      return s.links.some(function (l) { return dist[l[0]] + l[1] / sp <= ISO_T; });
    });
    return (isoCache[p.hcl] = { lines: lines, stations: st });
  }

  function isoText(p, r) {
    if (p.precizie === 'zonă') return '<span class="note">PUZ localizat doar pe zonă – izocrona nu se calculează.</span>';
    if (r === false) return '<span class="note">Rețeaua pietonală nu s-a putut încărca.</span>';
    if (!r) return '<span class="note">În afara rețelei pietonale a hărții 15 minute.</span>';
    var by = { 1: 0, 2: 0, 3: 0 };
    r.stations.forEach(function (s) { by[s.mode] = (by[s.mode] || 0) + 1; });
    var parts = [1, 2, 3].filter(function (m) { return by[m]; }).map(function (m) { return by[m] + ' ' + MODE_NAME[m]; });
    return '<b>Pe jos, în 10 minute</b> (≈ 800 m pe rețeaua pietonală): ' +
      (r.stations.length ? r.stations.length + (r.stations.length === 1 ? ' stație' : ' stații') + ' – ' + parts.join(', ') :
        '<b>nicio stație de transport public</b>') + ' <a href="metodologie.html" target="_blank">metodă</a>';
  }

  function clearIso() { isoLayer.clearLayers(); isoFor = null; }
  function drawIso(p, r) {
    isoLayer.clearLayers();
    isoFor = p.hcl;
    if (!r) return;
    L.polyline(r.lines, { renderer: isoRenderer, color: '#1f7a99', weight: 2.5, opacity: 0.85, interactive: false }).addTo(isoLayer);
    r.stations.forEach(function (s) {
      L.circleMarker([s.lat, s.lon], { renderer: isoRenderer, radius: 5, color: '#fff', weight: 1.5, fillColor: MODE_COLOR[s.mode] || '#555',
        fillOpacity: 1, interactive: false }).addTo(isoLayer);
    });
  }
  // la hover: izocrona temporară; la deschiderea fișei: izocrona rămâne și fișa primește numărul de stații
  function showIso(p, pop) {
    if (!$('showIso').checked || !p._ll) return;
    if (p.precizie === 'zonă') { if (pop) pop.setContent(popup(p, isoText(p))); return; }
    isoFor = p.hcl;
    loadIso().then(function (net) {
      if (!pop && (isoFor !== p.hcl || (isoPinned && isoPinned !== p.hcl))) return;   // mouse-ul a plecat între timp
      var r = net ? isoCompute(p) : false;
      drawIso(p, r);
      if (pop && pop.isOpen()) pop.setContent(popup(p, isoText(p, r)));
    });
  }
  function isoEvents(layer, p) {
    return layer.on('mouseover', function () { if (!isoPinned) showIso(p); })
      .on('mouseout', function () { if (!isoPinned && isoFor === p.hcl) clearIso(); })
      .on('popupopen', function (e) { isoPinned = p.hcl; showIso(p, e.popup); })
      .on('popupclose', function () { if (isoPinned === p.hcl) { isoPinned = null; clearIso(); } });
  }

  // ---------------------------------------------------------------- export
  function downloadCsv() {
    var list = selected();
    var cols = ['hcl', 'data', 'statut', 'adresa', 'functiune', 'scop', 'suprafata_mp', 'regim_inaltime', 'niveluri_max', 'h_max_m',
      'pot_max', 'cut_max', 'spatii_verzi_min', 'adc_max_mp', 'apartamente_capacitate', 'apartamente', 'sursa_apartamente', 'locuri_parcare', 'sursa_parcare',
      'vot_pentru', 'vot_impotriva', 'vot_abtineri', 'zona_id', 'zona', 'cartier', 'uat', 'lat', 'lon', 'precizie', 'cadastral', 'url_pdf', 'url_usr'];
    var q = function (v) { v = v === null || v === undefined ? '' : String(v); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var mcols = MOB ? ['realist_locuitori', 'maxim_locuitori', 'realist_PMUD_deplasari_zi', 'realist_RPL_deplasari_zi',
      'realist_PMUD_auto_varf', 'realist_RPL_auto_varf', 'maxim_PMUD_auto_varf', 'maxim_RPL_auto_varf', 'realist_atractie_deplasari_zi',
      'realist_atractie_lm_deplasari_zi', 'locuri_munca', 'zona_functionala_lm', 'realist_densitate_umana', 'maxim_densitate_umana',
      'dist_statie_m', 'dist_tramvai_tren_m', 'statii_800m', 'acces_tp_800m', 'acces_tramvai_tren_800m', 'acces_metoda',
      'dist_statie_linie_dreapta_m', 'dist_tramvai_tren_linie_dreapta_m', 'construit_dupa_hcl_mp'] : [];
    var lines = [cols.concat(mcols).join(',')].concat(list.map(function (p) {
      var m = (MOB && MOB.puz[p.hcl]) || {};
      return cols.map(function (c) { return q(c === 'lat' ? (p._ll && p._ll[0]) : c === 'lon' ? (p._ll && p._ll[1]) : p[c]); })
        .concat(mcols.map(function (c) { return q(m[c]); })).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'puz_iasi_' + $('yFrom').value + '-' + $('yTo').value + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------------------------------------------------------------- actualizare
  function update() {
    var list = selected();
    // contoare pe butoane, pentru selecția de ani
    var y0 = +$('yFrom').value, y1 = +$('yTo').value, cnt = {};
    ALL.forEach(function (p) {
      if (p.an < y0 || p.an > y1) return;
      cnt['s:' + p.statut] = (cnt['s:' + p.statut] || 0) + 1;
      cnt['f:' + p.functiune] = (cnt['f:' + p.functiune] || 0) + 1;
    });
    Array.prototype.forEach.call(document.querySelectorAll('#statusChips small'), function (s) { s.textContent = cnt['s:' + s.getAttribute('data-k')] || 0; });
    Array.prototype.forEach.call(document.querySelectorAll('#funcChips small'), function (s) { s.textContent = cnt['f:' + s.getAttribute('data-k')] || 0; });
    lastList = list;
    drawPoints(list);
    drawParcels();
    summary(list);
    drawGroups(list);
    writeHash();
  }

  // ---------------------------------------------------------------- încărcare
  Promise.all([
    fetch(DATA_URL).then(function (r) { if (!r.ok) throw new Error('puz_iasi.geojson: ' + r.status); return r.json(); }),
    fetch(ZONES_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch(PARCELS_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch(MOBILITY_URL).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    MOB = res[3];
    if (MOB) $('mobBox').hidden = false;
    else Array.prototype.forEach.call(document.querySelectorAll('option[data-mob]'), function (o) { o.remove(); });
    PARCELS = res[2];
    if (!PARCELS) $('parcelsToggle').hidden = true;
    META = res[0].metadata || {};
    ALL = res[0].features.map(function (f) {
      var p = f.properties;
      p._ll = f.geometry ? [f.geometry.coordinates[1], f.geometry.coordinates[0]] : null;
      if (!(p.functiune in FUNC_COLOR)) p.functiune = 'altele';
      p._search = fold([p.hcl, p.adresa, p.cadastral, p.scop, p.zona, p.cartier, p.titlu].join(' '));
      return p;
    });
    ZONES = res[1];
    if (ZONES) {
      zoneLayer = L.geoJSON(ZONES, {
        pane: 'zones',
        style: { color: '#15171a', weight: 1, opacity: 0.5, fillColor: '#fff', fillOpacity: 0.05 },
        onEachFeature: function (f, l) { l.bindTooltip(f.properties.zone_name, { permanent: false, className: 'zone-label', direction: 'center' }); }
      }).addTo(map);
    }
    if (ALL.filter(function (p) { return p.cartier; }).length < ALL.length / 2) {
      var opt = $('groupBy').querySelector('option[value=cartier]');
      opt.disabled = true;
      opt.textContent = 'cartiere (OpenStreetMap) – la următoarea actualizare';
    }
    $('dataInfo').textContent = 'Date generate la ' + (META.generat || '?') + ': ' + fmt(META.total) + ' hotărâri PUZ, din care ' + fmt(META.localizate) + ' localizate.';
    initControls();
    update();
  }).catch(function (e) {
    $('summary').innerHTML = '<div style="grid-column:1/-1">Nu s-au putut încărca datele: ' + esc(e.message) + '</div>';
  });
})();
