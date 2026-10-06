/* Dashboard administrativ – Mobilitate Iași v0.5 */
(function () {
  'use strict';

  var API = '../api/admin/';
  var state = { meta: null, tab: 'summary', page: 0, pageSize: 100, odMap: null, odLayer: null, currentTrip: null };
  var MODES = Domain.byCode(Domain.MODES), PURPOSES = Domain.byCode(Domain.PURPOSES);
  var LABELS = {
    repeat_type: { recurrent: 'Recurent', occasional: 'Ocazional' },
    day_type: { weekday: 'Zi lucrătoare', weekend: 'Weekend' },
    unit_type: { IAS_ZONE: 'Zonă Iași', LOCALITY: 'Localitate', UAT_REST: 'UAT (rest)', OUT_ZMI: 'Exterior ZMI' }
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(v, d) {
    if (v === null || v === undefined || v === '') return '–';
    return Number(v).toLocaleString('ro-RO', { maximumFractionDigits: d === undefined ? 1 : d });
  }
  function fmtDate(s) { if (!s) return ''; var p = s.slice(0, 10).split('-'); return p[2] + '.' + p[1] + '.' + p[0]; }
  function fmtTs(s) { if (!s) return ''; var d = new Date(s); return d.toLocaleString('ro-RO'); }

  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: { 'X-Requested-With': 'mobilitate-admin' }, credentials: 'same-origin' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (r.status === 401) { showLogin(); throw new Error(b.error || 'Autentificare necesară.'); }
        if (!r.ok) throw new Error(b.error || ('Eroare ' + r.status));
        return b;
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Autentificare
  // ---------------------------------------------------------------------------
  function showLogin(msg) {
    $('app').hidden = true;
    $('login').hidden = false;
    if (msg) { $('loginErr').textContent = msg; $('loginErr').hidden = false; }
    $('pwd').focus();
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    $('loginErr').hidden = true;
    fetch(API + 'login', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mobilitate-admin' },
      body: JSON.stringify({ password: $('pwd').value })
    }).then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error); }); })
      .then(function () { $('pwd').value = ''; boot(); })
      .catch(function (err) { $('loginErr').textContent = err.message || 'Eroare'; $('loginErr').hidden = false; });
  });

  $('btnLogout').addEventListener('click', function () {
    api('logout', { method: 'POST' }).then(function () { showLogin(); }, function () { showLogin(); });
  });

  // ---------------------------------------------------------------------------
  // Filtre
  // ---------------------------------------------------------------------------
  function option(value, label) { var o = document.createElement('option'); o.value = value; o.textContent = label; return o; }

  function fillSelect(sel, items, allLabel) {
    sel.innerHTML = '';
    sel.appendChild(option('', allLabel || 'toate'));
    items.forEach(function (it) { sel.appendChild(option(it[0], it[1])); });
  }

  function setupFilters() {
    var m = state.meta;
    var groups = { IAS_ZONE: [], LOCALITY: [], UAT_REST: [], OUT_ZMI: [] };
    m.units.forEach(function (u) { (groups[u.unit_type] || (groups[u.unit_type] = [])).push(u); });
    document.querySelectorAll('select[data-units]').forEach(function (sel) {
      sel.innerHTML = '';
      sel.appendChild(option('', 'toate'));
      Object.keys(groups).forEach(function (k) {
        if (!groups[k].length) return;
        var og = document.createElement('optgroup');
        og.label = LABELS.unit_type[k];
        groups[k].sort(function (a, b) { return a.unit_name.localeCompare(b.unit_name, 'ro'); }).forEach(function (u) {
          og.appendChild(option(u.unit_id, u.unit_name + (u.unit_type === 'LOCALITY' && u.uat_name ? ' (' + u.uat_name + ')' : '')));
        });
        sel.appendChild(og);
      });
    });
    fillSelect($('fUat'), m.uats.map(function (u) { return [u.siruta, u.name]; }));
    fillSelect($('fMode'), Domain.MODES.map(function (x) { return [x.code, x.label]; }));
    fillSelect($('fPurpose'), Domain.PURPOSES.map(function (x) { return [x.code, x.label]; }));
    fillSelect($('fRepeat'), [['recurrent', 'Recurent'], ['occasional', 'Ocazional']]);
    var periods = m.periods.map(function (p) { return [p.tag, p.label]; });
    fillSelect($('fPeriod'), periods);
    var fl = $('fFlag');
    m.flags.forEach(function (f) { fl.appendChild(option(f.code, f.code + ' – ' + f.label)); });
  }

  function filterQuery(extra) {
    var f = $('filters');
    var p = new URLSearchParams();
    ['date_from', 'date_to', 'origin', 'destination', 'uat', 'mode', 'purpose', 'repeat_type', 'period_tag', 'day_type', 'campaign_source'].forEach(function (n) {
      var v = f.elements[n].value.trim();
      if (v) p.set(n, v);
    });
    var st = Array.prototype.filter.call(f.querySelectorAll('input[name=st]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    p.set('status', st.join(','));
    Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== '' && extra[k] !== null && extra[k] !== undefined) p.set(k, extra[k]); });
    return p.toString();
  }

  $('filters').addEventListener('submit', function (e) { e.preventDefault(); state.page = 0; refresh(); });
  $('btnResetFilters').addEventListener('click', function () {
    $('filters').reset();
    state.page = 0;
    refresh();
  });

  // ---------------------------------------------------------------------------
  // Tab-uri
  // ---------------------------------------------------------------------------
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.tab = b.getAttribute('data-tab');
      document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      document.querySelectorAll('.tab').forEach(function (t) { t.hidden = t.id !== 'tab-' + state.tab; });
      refresh();
    });
  });

  function refresh() {
    var fn = { summary: loadSummary, trips: loadTrips, od: loadOd, coverage: loadCoverage, data: loadData, audit: loadAudit }[state.tab];
    fn().catch(function (e) { console.error(e); });
  }

  // ---------------------------------------------------------------------------
  // Sumar
  // ---------------------------------------------------------------------------
  function kpi(value, label, sub) {
    return '<div class="kpi"><div class="v">' + value + '</div><div class="l">' + esc(label) + '</div>' + (sub ? '<div class="s">' + sub + '</div>' : '') + '</div>';
  }

  function bars(id, items, labelFn) {
    var box = $(id);
    if (!items.length) { box.innerHTML = '<p class="empty">Fără date pentru filtrele curente.</p>'; return; }
    var max = Math.max.apply(null, items.map(function (x) { return x.n; }));
    var total = items.reduce(function (a, x) { return a + x.n; }, 0);
    box.innerHTML = items.map(function (x) {
      var label = labelFn ? labelFn(x.key) : x.key;
      var pct = Math.round((100 * x.n) / total);
      return '<div class="bar-row" title="' + esc(label) + ': ' + x.n + ' deplasări (' + pct + '%)">' +
        '<span class="lbl">' + esc(label) + '</span>' +
        '<span class="track"><span class="fill" style="display:block;width:' + (100 * x.n / max).toFixed(1) + '%"></span></span>' +
        '<span class="val">' + fmtNum(x.n, 0) + '</span></div>';
    }).join('');
  }

  function loadSummary() {
    return api('summary?' + filterQuery()).then(function (s) {
      var d = s.duration_valid;
      $('kpis').innerHTML =
        kpi(fmtNum(s.n_trips, 0), 'Deplasări (filtrate)', 'din ' + fmtNum(s.n_raw_total, 0) + ' primite' + (s.n_unprocessable ? ' · ' + s.n_unprocessable + ' neprocesabile' : '')) +
        kpi(fmtNum(s.n_participants, 0), 'Participanți unici', 'mediană ' + fmtNum(s.trips_per_participant.median) + ' depl./participant') +
        kpi(fmtNum(s.n_days, 0), 'Zile acoperite') +
        kpi('<span class="status VALID">VALID</span> ' + fmtNum(s.status.VALID, 0), 'Coerente') +
        kpi('<span class="status CHECK">CHECK</span> ' + fmtNum(s.status.CHECK, 0), 'De revizuit') +
        kpi('<span class="status EXCLUDE">EXCLUDE</span> ' + fmtNum(s.status.EXCLUDE, 0), 'Excluse') +
        kpi(fmtNum(s.n_external, 0), 'Fluxuri externe ZMI') +
        kpi(d.n ? fmtNum(d.median) + ' min' : '–', 'Durată mediană (VALID)', d.n ? 'P25 ' + fmtNum(d.p25) + ' · P75 ' + fmtNum(d.p75) + ' · P90 ' + fmtNum(d.p90) : '');
      bars('chDate', s.by_date, fmtDate);
      bars('chBand', s.by_departure_band);
      bars('chMode', s.by_mode, function (k) { return MODES[k] ? MODES[k].label : k; });
      bars('chPurpose', s.by_purpose, function (k) { return PURPOSES[k] ? PURPOSES[k].label : k; });
      bars('chRepeat', s.by_repeat, function (k) { return LABELS.repeat_type[k] || k; });
      var periodLabels = {};
      state.meta.periods.forEach(function (p) { periodLabels[p.tag] = p.label; });
      bars('chPeriod', s.by_period, function (k) { return periodLabels[k] || k; });
      bars('chSource', s.by_source, function (k) { return k === '–' ? '(direct)' : k; });
      bars('chDay', s.by_day_type, function (k) { return LABELS.day_type[k] || k; });
    });
  }

  // ---------------------------------------------------------------------------
  // Deplasări
  // ---------------------------------------------------------------------------
  function unitCell(name, type, uat) {
    return esc(name) + '<span class="unit-sub">' + esc(LABELS.unit_type[type] || type) + (uat && type === 'LOCALITY' ? ' · ' + esc(uat) : '') + '</span>';
  }

  function statusBadge(r) {
    return '<span class="status ' + r.validation_status + '">' + r.validation_status + '</span>' + (r.manual_status ? '<span class="manual" title="Decizie manuală">manual</span>' : '');
  }

  function loadTrips() {
    var id = $('fId').value.trim();
    var extra = { limit: state.pageSize, offset: state.page * state.pageSize, flag: $('fFlag').value };
    if (/^[0-9a-f-]{4,36}$/i.test(id)) extra.trip_id = id;
    return api('trips?' + filterQuery(extra)).then(function (res) {
      var from = res.total ? res.offset + 1 : 0, to = res.offset + res.rows.length;
      $('tripsCount').textContent = from + '–' + to + ' din ' + fmtNum(res.total, 0);
      $('prevPage').disabled = state.page === 0;
      $('nextPage').disabled = to >= res.total;
      var tb = document.querySelector('#tripsTable tbody');
      $('tripsTable').classList.add('clickable');
      if (!res.rows.length) { tb.innerHTML = '<tr><td colspan="9" class="empty">Nicio deplasare pentru filtrele curente.</td></tr>'; return; }
      tb.innerHTML = res.rows.map(function (r) {
        return '<tr data-id="' + r.trip_id + '">' +
          '<td>' + fmtDate(r.trip_date) + '</td>' +
          '<td>' + r.departure_time + '–' + r.arrival_time + (r.overnight ? ' <small>(+1)</small>' : '') + '</td>' +
          '<td class="num">' + r.duration_min + ' min</td>' +
          '<td>' + unitCell(r.origin_unit_name, r.origin_unit_type, r.origin_uat_name) + '</td>' +
          '<td>' + unitCell(r.destination_unit_name, r.destination_unit_type, r.destination_uat_name) + '</td>' +
          '<td>' + esc(MODES[r.mode] ? MODES[r.mode].label : r.mode) + (r.pt_line ? ' <small>' + esc(r.pt_line) + '</small>' : '') + '</td>' +
          '<td>' + esc(PURPOSES[r.purpose] ? PURPOSES[r.purpose].label : r.purpose) + '</td>' +
          '<td>' + statusBadge(r) + '</td>' +
          '<td class="flags">' + esc(r.validation_flags.split(',').filter(Boolean).join(', ')) + '</td></tr>';
      }).join('');
    });
  }

  document.querySelector('#tripsTable tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (tr) openTrip(tr.getAttribute('data-id'));
  });
  $('prevPage').addEventListener('click', function () { if (state.page > 0) { state.page--; loadTrips(); } });
  $('nextPage').addEventListener('click', function () { state.page++; loadTrips(); });
  $('fFlag').addEventListener('change', function () { state.page = 0; loadTrips(); });
  $('fId').addEventListener('change', function () { state.page = 0; loadTrips(); });

  function kvList(pairs) {
    return '<dl class="kv">' + pairs.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + p[1] + '</dd>'; }).join('') + '</dl>';
  }

  function openTrip(id) {
    api('trips/' + id).then(function (d) {
      state.currentTrip = id;
      var r = d.row;
      var flagMeta = {};
      state.meta.flags.forEach(function (f) { flagMeta[f.code] = f; });
      var flags = r.validation_flags.split(',').filter(Boolean);
      $('dTripId').textContent = r.trip_id.slice(0, 8);
      var ep = function (p) {
        return kvList([
          ['Unitate O–D', esc(r[p + '_unit_name']) + ' <code>' + esc(r[p + '_unit_id']) + '</code>'],
          ['Tip', esc(LABELS.unit_type[r[p + '_unit_type']] || r[p + '_unit_type'])],
          ['UAT', esc(r[p + '_uat_name'] || '–') + (r[p + '_uat'] ? ' <code>' + esc(r[p + '_uat']) + '</code>' : '')],
          ['Declarat', esc(r[p + '_label']) + ' <small>(' + esc(r[p + '_source']) + ')</small>'],
          ['Coordonate', r[p + '_lat'] !== null ? r[p + '_lat'] + ', ' + r[p + '_lng'] : '–']
        ]);
      };
      $('dContent').innerHTML =
        '<div class="detail-grid">' +
        '<div><h3>Origine</h3>' + ep('origin') + '</div>' +
        '<div><h3>Destinație</h3>' + ep('destination') + '</div>' +
        '<div><h3>Deplasare</h3>' + kvList([
          ['Data', fmtDate(r.trip_date) + ' (' + esc(LABELS.day_type[r.day_type]) + ', ' + esc(r.period_tag) + ')'],
          ['Interval', r.departure_time + ' – ' + r.arrival_time + (r.overnight ? ' (peste miezul nopții)' : '')],
          ['Durată', r.duration_min + ' min'],
          ['Distanță linie dreaptă', r.distance_km !== null ? fmtNum(r.distance_km, 2) + ' km' : '–'],
          ['Mod', esc(MODES[r.mode] ? MODES[r.mode].label : r.mode) + (r.car_role ? ' · ' + (r.car_role === 'driver' ? 'șofer' : 'pasager') + ', ' + r.occupancy + (r.occupancy === 5 ? '+' : '') + ' pers.' : '') + (r.pt_line ? ' · linia ' + esc(r.pt_line) : '')],
          ['Scop', esc(PURPOSES[r.purpose] ? PURPOSES[r.purpose].label : r.purpose)],
          ['Recurență', esc(LABELS.repeat_type[r.repeat_type])]
        ]) + '</div>' +
        '<div><h3>Proveniență și validare</h3>' + kvList([
          ['Participant', '<code>' + esc(r.participant_id.slice(0, 8)) + '…</code> (' + d.participant_trips + ' depl.)'],
          ['Trimisă', fmtTs(r.submitted_at) + ' · întârziere ' + fmtNum(r.reporting_delay_hours) + ' h'],
          ['Sursă campanie', esc(r.campaign_source || '(direct)')],
          ['Zonare', esc(r.geometry_version)],
          ['Status automat', '<span class="status ' + r.auto_status + '">' + r.auto_status + '</span>'],
          ['Status final', statusBadge(r) + (r.review_note ? '<br><small>' + esc(r.review_note) + '</small>' : '')],
          ['Flag-uri', flags.length ? flags.map(function (f) {
            var m = flagMeta[f];
            return '<div><code>' + esc(f) + '</code> ' + (m && m.severity !== 'INFO' ? '<span class="status ' + m.severity + '">' + m.severity + '</span> ' : '') + '<small>' + esc(m ? m.label : '') + '</small></div>';
          }).join('') : '–']
        ]) + '</div>' +
        '</div>' +
        '<details><summary>Date brute (TRIPS_RAW, nemodificate)</summary><pre class="raw">' + esc(JSON.stringify(d.raw.payload, null, 2)) + '</pre></details>' +
        (d.audit.length ? '<details open><summary>Istoric decizii</summary><ul class="small">' + d.audit.map(function (a) {
          return '<li>' + fmtTs(a.at) + ' – ' + esc(a.action) + ': ' + esc(a.old_status || '') + ' → ' + esc(a.new_status || '') + (a.note ? ' (' + esc(a.note) + ')' : '') + '</li>';
        }).join('') + '</ul></details>' : '');
      $('dNote').value = r.review_note || '';
      var dlg = $('tripDialog');
      if (!dlg.open) dlg.showModal();
    }).catch(function (e) { alert(e.message); });
  }

  $('dClose').addEventListener('click', function () { $('tripDialog').close(); });
  document.querySelectorAll('[data-status]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (!state.currentTrip) return;
      api('trips/' + state.currentTrip + '/status', { method: 'POST', body: { status: b.getAttribute('data-status'), note: $('dNote').value } })
        .then(function () { openTrip(state.currentTrip); loadTrips(); })
        .catch(function (e) { alert(e.message); });
    });
  });

  // ---------------------------------------------------------------------------
  // Relații O–D
  // ---------------------------------------------------------------------------
  function ensureOdMap() {
    if (state.odMap) { setTimeout(function () { state.odMap.invalidateSize(); }, 50); return; }
    var cfg = state.meta.config;
    state.odMap = L.map('odMap', { preferCanvas: true });
    L.tileLayer(cfg.tile_url, { maxZoom: 18, attribution: cfg.tile_attribution, opacity: 0.6 }).addTo(state.odMap);
    var b = state.meta.geo.bbox;
    state.odMap.fitBounds(b ? [[b[1], b[0]], [b[3], b[2]]] : [[46.98, 27.30], [47.33, 27.90]]);
    state.odLayer = L.layerGroup().addTo(state.odMap);
  }

  function fmtModes(str) {
    return String(str || '').split(' ').filter(Boolean).map(function (x) {
      var p = x.split(':');
      return esc(MODES[p[0]] ? MODES[p[0]].label : p[0]) + ' ' + p[1];
    }).join('<br>');
  }

  function loadOd() {
    ensureOdMap();
    var extra = { level: $('odLevel').value, min_trips: $('odMin').value };
    var q = filterQuery(extra);
    var p1 = api('od?' + q).then(function (od) {
      var tb = document.querySelector('#odTable tbody');
      if (!od.rows.length) { tb.innerHTML = '<tr><td colspan="14" class="empty">Nicio relație pentru filtrele curente.</td></tr>'; return; }
      tb.innerHTML = od.rows.map(function (r) {
        return '<tr><td>' + esc(r.origin_name) + '</td><td>' + esc(r.destination_name) + '</td>' +
          '<td class="num">' + r.n_trips + '</td><td class="num">' + r.n_participants + '</td><td class="num">' + r.n_days + '</td>' +
          '<td class="num"><strong>' + fmtNum(r.median_min) + '</strong></td><td class="num">' + fmtNum(r.mean_min) + '</td>' +
          '<td class="num">' + fmtNum(r.p25_min) + '</td><td class="num">' + fmtNum(r.p75_min) + '</td><td class="num">' + fmtNum(r.p90_min) + '</td>' +
          '<td class="num">' + fmtNum(r.p90_minus_median) + '</td><td>' + esc(r.peak_departure_band || '') + '</td>' +
          '<td class="small nowrap">' + fmtModes(r.modes) + '</td><td class="small nowrap">' + esc(r.volume_class) + '</td></tr>';
      }).join('');
    });
    var p2 = fetch(API + 'export/od.geojson?' + q, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (gj) {
      state.odLayer.clearLayers();
      var max = Math.max.apply(null, [1].concat(gj.features.map(function (f) { return f.properties.n_trips; })));
      gj.features.forEach(function (f) {
        var p = f.properties;
        var tip = '<strong>' + esc(p.origin_name) + ' → ' + esc(p.destination_name) + '</strong><br>' +
          p.n_trips + ' deplasări · ' + p.n_participants + ' participanți · ' + p.n_days + ' zile<br>' +
          'mediană ' + fmtNum(p.median_min) + ' min · P90 ' + fmtNum(p.p90_min) + ' min';
        var w = 1.5 + 10 * Math.sqrt(p.n_trips / max);
        var layer;
        if (f.geometry.type === 'Point') {
          layer = L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], { radius: 3 + w / 1.5, color: '#fff', weight: 2, fillColor: '#3b6fb6', fillOpacity: 0.8 });
        } else {
          var c = f.geometry.coordinates;
          layer = L.polyline([[c[0][1], c[0][0]], [c[1][1], c[1][0]]], { color: '#3b6fb6', weight: w, opacity: 0.65, lineCap: 'round' });
        }
        layer.bindTooltip(tip, { sticky: true });
        layer.addTo(state.odLayer);
      });
    });
    return Promise.all([p1, p2]);
  }
  $('odLevel').addEventListener('change', loadOd);
  $('odMin').addEventListener('change', loadOd);

  // ---------------------------------------------------------------------------
  // Acoperire
  // ---------------------------------------------------------------------------
  function loadCoverage() {
    return api('coverage?' + filterQuery({ threshold: $('covThreshold').value })).then(function (c) {
      var under = c.rows.filter(function (r) { return r.undercovered && r.unit_type !== 'OUT_ZMI'; }).length;
      $('covInfo').textContent = under + ' unități sub pragul de ' + c.threshold + ' observații (O + D).';
      document.querySelector('#covTable tbody').innerHTML = c.rows.map(function (r) {
        return '<tr><td>' + esc(r.unit_name) + ' <code class="small">' + esc(r.unit_id) + '</code></td><td>' + esc(LABELS.unit_type[r.unit_type] || r.unit_type) + '</td>' +
          '<td>' + esc(r.uat_name || '') + '</td><td class="num">' + r.as_origin + '</td><td class="num">' + r.as_destination + '</td>' +
          '<td class="num"><strong>' + r.total + '</strong></td><td>' + (r.undercovered && r.unit_type !== 'OUT_ZMI' ? '<span class="under">▲ subacoperită</span>' : '') + '</td></tr>';
      }).join('');
    });
  }
  $('covThreshold').addEventListener('change', loadCoverage);

  // ---------------------------------------------------------------------------
  // Export & date geografice
  // ---------------------------------------------------------------------------
  function renderGeoStatus(g) {
    var c = g.counts;
    $('geoStatus').innerHTML = kvList([
      ['Zonare', esc(state.meta.config.geometry_version)],
      ['Zone Iași cu geometrie', c.zones_with_geometry + ' / 17'],
      ['UAT-uri ZMI', String(c.uats) + (g.iasi_uat ? ' (Iași: SIRUTA ' + esc(g.iasi_uat.siruta) + ')' : ' – <strong>Municipiul Iași negăsit</strong>')],
      ['Localități SIRUTA', c.localities + ' (' + c.localities_with_coords + ' cu coordonate)'],
      ['Repere', String(c.pois)]
    ]) + (g.warnings.length ? '<p class="small"><strong>Avertismente (' + g.warnings.length + '):</strong></p><ul class="warnings">' + g.warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');
    var missing = !g.files.zones || !g.files.uats || !g.files.localities;
    $('geoBanner').hidden = !missing;
    $('geoBanner').textContent = missing
      ? 'Date geografice incomplete: copiați fișierele GeoJSON/SIRUTA în public/data (vezi public/data/README.md); pe Netlify, publicați din nou site-ul, apoi „Reîncarcă datele geografice”.'
      : '';
  }

  function loadData() {
    var q = filterQuery();
    var odq = filterQuery({ level: 'unit' }), uatq = filterQuery({ level: 'uat' });
    var items = [
      ['Deplasări – TRIPS_ANALYSIS', 'export/trips.csv?' + q, true],
      ['Matrice O–D – zone/localități', 'export/od.csv?' + odq, true],
      ['Matrice O–D – UAT', 'export/od.csv?' + uatq, true],
      ['Fluxuri O–D (GeoJSON)', 'export/od.geojson?' + odq, false],
      ['Acoperire pe unități', 'export/coverage.csv?' + q, true],
      ['Jurnal de audit', 'export/audit.csv', true],
      ['Date brute – TRIPS_RAW (JSONL, toate)', 'export/raw.jsonl', false]
    ];
    $('exports').innerHTML = items.map(function (it) {
      var links = '<a href="' + API + it[1] + '">' + (it[2] ? 'CSV' : 'descarcă') + '</a>';
      if (it[2]) links += ' · <a href="' + API + it[1] + (it[1].indexOf('?') >= 0 ? '&' : '?') + 'format=excel_ro">Excel RO</a>';
      return '<li><span>' + esc(it[0]) + '</span><span>' + links + '</span></li>';
    }).join('');
    $('flagsTable').querySelector('tbody').innerHTML = state.meta.flags.map(function (f) {
      return '<tr><td><code>' + esc(f.code) + '</code></td><td>' + (f.severity === 'INFO' ? 'informativ' : '<span class="status ' + f.severity + '">' + f.severity + '</span>') + '</td><td>' + esc(f.label) + '</td></tr>';
    }).join('');
    renderGeoStatus(state.meta.geo);
    return Promise.resolve();
  }

  $('btnReloadGeo').addEventListener('click', function () {
    var b = this;
    b.disabled = true;
    api('reload-geo', { method: 'POST' }).then(function (g) {
      $('opResult').textContent = 'Date geografice reîncărcate. Deplasări verificate: ' + g.repair.checked + (g.repair.repaired ? ', readăugate în index: ' + g.repair.repaired : '') + '.';
      return api('meta').then(function (m) { state.meta = m; setupFilters(); renderGeoStatus(g); });
    }).catch(function (e) { $('opResult').textContent = e.message; }).then(function () { b.disabled = false; });
  });

  $('btnPurge').addEventListener('click', function () {
    var days = parseInt($('purgeDays').value, 10);
    if (!(days >= 1)) return;
    if (!confirm('Eliminați definitiv coordonatele precise pentru deplasările primite acum mai mult de ' + days + ' zile? Clasificarea se păstrează.')) return;
    var b = this;
    b.disabled = true;
    api('purge-coords', { method: 'POST', body: { older_than_days: days } }).then(function (r) {
      $('opResult').textContent = 'Coordonate eliminate pentru ' + r.purged + ' deplasări.';
    }).catch(function (e) { $('opResult').textContent = e.message; }).then(function () { b.disabled = false; });
  });

  // ---------------------------------------------------------------------------
  // Audit
  // ---------------------------------------------------------------------------
  function loadAudit() {
    return api('audit?limit=500').then(function (a) {
      document.querySelector('#auditTable tbody').innerHTML = a.rows.length ? a.rows.map(function (r) {
        return '<tr><td>' + r.id + '</td><td>' + fmtTs(r.at) + '</td><td>' + esc(r.actor) + '</td><td>' + esc(r.action) + '</td>' +
          '<td>' + (r.trip_id ? '<code>' + esc(r.trip_id.slice(0, 8)) + '</code>' : '') + '</td><td>' + esc(r.old_status || '') + '</td><td>' + esc(r.new_status || '') + '</td><td>' + esc(r.note || '') + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="empty">Jurnal gol.</td></tr>';
    });
  }

  // ---------------------------------------------------------------------------
  function boot() {
    fetch(API + 'session', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (s) {
      if (!s.enabled) return showLogin('Administrarea este dezactivată pe acest server (ADMIN_PASSWORD nesetat).');
      if (!s.authenticated) return showLogin();
      return api('meta').then(function (m) {
        state.meta = m;
        $('login').hidden = true;
        $('app').hidden = false;
        $('topMeta').textContent = 'v' + m.config.app_version + ' · zonare ' + m.config.geometry_version + ' · colectare ' + fmtDate(m.config.study_start) + '–' + fmtDate(m.config.study_end) + ' · stocare ' + m.storage;
        setupFilters();
        renderGeoStatus(m.geo);
        refresh();
      });
    }).catch(function (e) { showLogin(e.message); });
  }

  boot();
})();
