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
    ['date_from', 'date_to', 'origin', 'destination', 'uat', 'mode', 'purpose', 'repeat_type', 'stops', 'period_tag', 'day_type', 'campaign_source'].forEach(function (n) {
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
      $('filters').hidden = state.tab === 'pois' || state.tab === 'audit';
      refresh();
    });
  });

  function refresh() {
    var fn = { summary: loadSummary, trips: loadTrips, od: loadOd, coverage: loadCoverage, pois: loadPois, data: loadData, audit: loadAudit }[state.tab];
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
      var stopTypes = Domain.byCode(Domain.STOP_TYPES);
      bars('chStops', s.by_stops || [], function (k) { return k === 'neprecizat' ? 'Neprecizat' : (stopTypes[k] ? stopTypes[k].label : k); });
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
          ['Recurență', esc(LABELS.repeat_type[r.repeat_type])],
          ['Opriri pe drum', r.stops ? esc(String(r.stops).split(';').map(function (c) { var t = Domain.byCode(Domain.STOP_TYPES)[c]; return t ? t.label : c; }).join('; ')) : 'neprecizat']
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
      if (!od.rows.length) { tb.innerHTML = '<tr><td colspan="16" class="empty">Nicio relație pentru filtrele curente.</td></tr>'; return; }
      tb.innerHTML = od.rows.map(function (r) {
        return '<tr><td>' + esc(r.origin_name) + '</td><td>' + esc(r.destination_name) + '</td>' +
          '<td class="num">' + r.n_trips + '</td><td class="num">' + r.n_participants + '</td><td class="num">' + r.n_days + '</td>' +
          '<td class="num"><strong>' + fmtNum(r.median_min) + '</strong></td><td class="num">' + fmtNum(r.mean_min) + '</td>' +
          '<td class="num">' + fmtNum(r.p25_min) + '</td><td class="num">' + fmtNum(r.p75_min) + '</td><td class="num">' + fmtNum(r.p90_min) + '</td>' +
          '<td class="num">' + fmtNum(r.p90_minus_median) + '</td><td class="num">' + fmtNum(r.median_without_stops_min) + '</td><td class="num">' + (r.share_with_stops || 0) + '%</td>' +
          '<td>' + esc(r.peak_departure_band || '') + '</td>' +
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
      ['Repere', 'export/pois.csv', true],
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
  // Repere
  // ---------------------------------------------------------------------------
  var CATS = Domain.byCode(Domain.POI_CATEGORIES);
  var poiState = { rows: [], editing: null, map: null, marker: null, lat: null, lng: null, locating: false };

  function fillCategorySelect(sel, withAll) {
    sel.innerHTML = '';
    if (withAll) sel.appendChild(option('', 'toate'));
    Domain.POI_CATEGORIES.forEach(function (c) { sel.appendChild(option(c.code, c.icon + ' ' + c.label)); });
  }

  function poiStateBadge(p) {
    if (p.lat === null) return '<span class="badge-state none">fără coordonate</span>';
    return p.verified ? '<span class="badge-state ok">✓ verificat</span>' : '<span class="badge-state warn">? neverificat</span>';
  }

  function loadPois() {
    return api('pois').then(function (r) {
      poiState.rows = r.rows;
      renderPois();
    });
  }

  function renderPois() {
    var q = GeoCore.normalize($('poiFilter').value);
    var cat = $('poiCatFilter').value, st = $('poiStateFilter').value;
    var rows = poiState.rows.filter(function (p) {
      if (cat && p.category !== cat) return false;
      if (st === 'nocoords' && p.lat !== null) return false;
      if (st === 'unverified' && (p.lat === null || p.verified)) return false;
      if (st === 'verified' && !p.verified) return false;
      if (q && [p.name].concat(p.aliases).every(function (x) { return GeoCore.normalize(x).indexOf(q) < 0; })) return false;
      return true;
    });
    var all = poiState.rows;
    $('poiCount').textContent = rows.length + ' din ' + all.length + ' · ' +
      all.filter(function (p) { return p.lat === null; }).length + ' fără coordonate · ' +
      all.filter(function (p) { return p.lat !== null && !p.verified; }).length + ' neverificate';
    var tb = document.querySelector('#poiTable tbody');
    tb.innerHTML = rows.length ? rows.map(function (p) {
      var c = CATS[p.category] || CATS.altul;
      return '<tr data-id="' + esc(p.id) + '"><td><strong>' + esc(p.name) + '</strong>' +
        (p.aliases.length ? '<span class="unit-sub">' + esc(p.aliases.join(' · ')) + '</span>' : '') + '</td>' +
        '<td>' + c.icon + ' ' + esc(c.single) + '</td>' +
        '<td>' + (p.unit_name ? esc(p.unit_name) + (p.uat_name && p.unit_name !== p.uat_name ? '<span class="unit-sub">' + esc(p.uat_name) + '</span>' : '') : '–') + '</td>' +
        '<td>' + poiStateBadge(p) + '</td><td class="small muted">' + esc(p.source) + '</td>' +
        '<td class="row-actions-sm"><button type="button" data-edit>Editează</button> <button type="button" class="ghost" data-del>Șterge</button></td></tr>';
    }).join('') : '<tr><td colspan="6" class="empty">Niciun reper pentru filtrele alese.</td></tr>';
  }

  ['poiFilter', 'poiCatFilter', 'poiStateFilter'].forEach(function (id) { $(id).addEventListener('input', renderPois); });

  document.querySelector('#poiTable tbody').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    var p = poiState.rows.find(function (x) { return x.id === tr.getAttribute('data-id'); });
    if (!p) return;
    if (e.target.hasAttribute('data-edit')) openPoi(p);
    else if (e.target.hasAttribute('data-del')) {
      if (!confirm('Ștergi reperul „' + p.name + '”? Nu va mai apărea în căutarea participanților.')) return;
      api('pois/delete', { method: 'POST', body: { id: p.id } }).then(loadPois).catch(function (err) { alert(err.message); });
    }
  });

  function geocode(q, bounded) {
    var url = state.meta.config.geocoder_url;
    if (!url) return Promise.reject(new Error('Geocodarea nu este configurată.'));
    var b = state.meta.geo.bbox || [27.28, 46.87, 27.99, 47.39];
    var params = new URLSearchParams({
      q: q, format: 'jsonv2', limit: '6', countrycodes: 'ro', 'accept-language': 'ro',
      viewbox: [b[0], b[3], b[2], b[1]].join(','), bounded: bounded ? '1' : '0'
    });
    return fetch(url + '?' + params.toString(), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('Geocodare indisponibilă (' + r.status + ')'); return r.json(); });
  }

  function cleanForSearch(name) { return String(name).replace(/[„”"“]/g, '').replace(/\s+/g, ' ').trim(); }

  function setPoiPoint(lat, lng, zoom) {
    poiState.lat = Math.round(lat * 1e6) / 1e6;
    poiState.lng = Math.round(lng * 1e6) / 1e6;
    $('poiCoords').textContent = poiState.lat + ', ' + poiState.lng;
    if (!poiState.marker) {
      poiState.marker = L.marker([lat, lng], { draggable: true }).addTo(poiState.map);
      poiState.marker.on('dragend', function (e) { var ll = e.target.getLatLng(); setPoiPoint(ll.lat, ll.lng); });
    } else poiState.marker.setLatLng([lat, lng]);
    if (zoom) poiState.map.setView([lat, lng], 16);
  }

  function openPoi(p) {
    poiState.editing = p || null;
    $('poiDialogTitle').textContent = p ? 'Editează reperul' : 'Reper nou';
    $('poiName').value = p ? p.name : '';
    $('poiCategory').value = p ? p.category : 'altul';
    $('poiAliases').value = p ? p.aliases.join('; ') : '';
    $('poiVerified').checked = !!(p && p.verified);
    $('poiSearch').value = p ? cleanForSearch(p.name) : '';
    $('poiResults').innerHTML = '';
    $('poiErr').hidden = true;
    $('poiCoords').textContent = '– (apasă pe hartă sau caută)';
    poiState.lat = null; poiState.lng = null;
    $('poiDialog').showModal();
    var cfg = state.meta.config;
    if (!poiState.map) {
      poiState.map = L.map('poiMap');
      L.tileLayer(cfg.tile_url, { maxZoom: 19, attribution: cfg.tile_attribution }).addTo(poiState.map);
      poiState.map.on('click', function (e) { setPoiPoint(e.latlng.lat, e.latlng.lng); $('poiVerified').checked = true; });
    }
    if (poiState.marker) { poiState.map.removeLayer(poiState.marker); poiState.marker = null; }
    setTimeout(function () {
      poiState.map.invalidateSize();
      if (p && p.lat !== null) setPoiPoint(p.lat, p.lng, true);
      else poiState.map.setView([47.1585, 27.6014], 12);
    }, 50);
  }

  function runPoiSearch() {
    var q = $('poiSearch').value.trim();
    if (!q) return;
    var ul = $('poiResults');
    ul.innerHTML = '<li>Se caută…</li>';
    geocode(/ia[sș]i/i.test(q) ? q : q + ', Iași', false).then(function (list) {
      ul.innerHTML = '';
      if (!list.length) { ul.innerHTML = '<li>Niciun rezultat. Încearcă altă formulare sau apasă direct pe hartă.</li>'; return; }
      list.forEach(function (r) {
        var li = document.createElement('li');
        li.textContent = r.display_name;
        li.addEventListener('click', function () { setPoiPoint(parseFloat(r.lat), parseFloat(r.lon), true); });
        ul.appendChild(li);
      });
    }).catch(function (e) { ul.innerHTML = '<li>' + esc(e.message) + '</li>'; });
  }

  $('poiSearchBtn').addEventListener('click', runPoiSearch);
  $('poiSearch').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runPoiSearch(); } });
  $('btnPoiAdd').addEventListener('click', function () { openPoi(null); });
  $('poiClose').addEventListener('click', function () { $('poiDialog').close(); });
  $('poiCancel').addEventListener('click', function () { $('poiDialog').close(); });

  $('poiForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var body = {
      id: poiState.editing ? poiState.editing.id : undefined,
      name: $('poiName').value,
      category: $('poiCategory').value,
      aliases: $('poiAliases').value,
      lat: poiState.lat, lng: poiState.lng,
      verified: $('poiVerified').checked
    };
    api('pois', { method: 'POST', body: body }).then(function () {
      $('poiDialog').close();
      return loadPois();
    }).catch(function (err) { $('poiErr').textContent = err.message; $('poiErr').hidden = false; });
  });

  // --- import listă / Excel ---
  function categoryFrom(text, def) {
    var t = GeoCore.normalize(text);
    if (!t) return def;
    var hit = Domain.POI_CATEGORIES.find(function (c) {
      return c.code === t || GeoCore.normalize(c.label) === t || GeoCore.normalize(c.single) === t ||
        c.keywords.some(function (k) { return GeoCore.normalize(k) === t; });
    }) || Domain.POI_CATEGORIES.find(function (c) {
      return GeoCore.normalize(c.label).indexOf(t) === 0 || GeoCore.normalize(c.single).indexOf(t) === 0;
    });
    return hit ? hit.code : def;
  }

  function parseImport(text, defCat) {
    var lines = text.split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ''); }).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var sep = /\t/.test(lines[0]) ? '\t' : /;/.test(lines[0]) ? ';' : null;
    if (!sep) return lines.map(function (l) { return { name: l.trim(), category: defCat }; });
    var split = function (l) { return l.split(sep).map(function (c) { return c.replace(/^"|"$/g, '').trim(); }); };
    var head = split(lines[0]).map(function (h) { return GeoCore.normalize(h); });
    var hasHeader = head.some(function (h) { return ['nume', 'name', 'denumire', 'categorie', 'category'].indexOf(h) >= 0; });
    var idx = { id: -1, name: 0, category: 1, aliases: 2, lat: 3, lng: 4, verified: -1 };
    if (hasHeader) {
      var find = function (names) { for (var i = 0; i < head.length; i++) if (names.indexOf(head[i]) >= 0) return i; return -1; };
      idx = {
        id: find(['id']), name: find(['nume', 'name', 'denumire']), category: find(['categorie', 'category']),
        aliases: find(['aliasuri', 'alias uri', 'alias', 'aliases', 'alte denumiri']), lat: find(['lat', 'latitudine', 'latitude']),
        lng: find(['lng', 'lon', 'longitudine', 'longitude']), verified: find(['verificat', 'verified'])
      };
      lines = lines.slice(1);
    }
    return lines.map(function (l) {
      var c = split(l);
      var get = function (i) { return i >= 0 && i < c.length ? c[i] : ''; };
      return {
        id: get(idx.id) || undefined,
        name: get(idx.name),
        category: categoryFrom(get(idx.category), defCat),
        aliases: get(idx.aliases).split(/[;|,]/).map(function (a) { return a.trim(); }).filter(Boolean),
        lat: get(idx.lat), lng: get(idx.lng),
        verified: GeoCore.normalize(get(idx.verified)) === 'da'
      };
    }).filter(function (r) { return r.name && r.name.length >= 2; });
  }

  function updateImportPreview() {
    var items = parseImport($('importText').value, $('importCategory').value);
    var withCoords = items.filter(function (i) { return i.lat && i.lng; }).length;
    $('importPreview').textContent = items.length ? items.length + ' repere de importat (' + withCoords + ' cu coordonate). Primul: „' + items[0].name + '” – ' + CATS[items[0].category].single : '';
  }
  $('importText').addEventListener('input', updateImportPreview);
  $('importCategory').addEventListener('change', updateImportPreview);
  $('btnPoiImport').addEventListener('click', function () { $('importText').value = ''; $('importPreview').textContent = ''; $('importDialog').showModal(); });
  $('importClose').addEventListener('click', function () { $('importDialog').close(); });
  $('importCancel').addEventListener('click', function () { $('importDialog').close(); });
  $('importForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var items = parseImport($('importText').value, $('importCategory').value);
    if (!items.length) return;
    api('pois/import', { method: 'POST', body: { items: items, default_category: $('importCategory').value } }).then(function (r) {
      $('importDialog').close();
      $('poiProgress').textContent = 'Import: ' + r.added + ' repere noi, ' + r.updated + ' actualizate.';
      return loadPois();
    }).catch(function (err) { $('importPreview').textContent = err.message; });
  });

  // --- localizare automată (OpenStreetMap, câte o cerere pe secundă) ---
  $('btnPoiLocate').addEventListener('click', function () {
    var btn = this;
    if (poiState.locating) { poiState.locating = false; return; }
    var todo = poiState.rows.filter(function (p) { return p.lat === null; });
    if (!todo.length) { $('poiProgress').textContent = 'Toate reperele au coordonate.'; return; }
    poiState.locating = true;
    btn.textContent = 'Oprește localizarea';
    var found = 0, missed = [], i = 0;
    var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    function next() {
      if (!poiState.locating || i >= todo.length) {
        poiState.locating = false;
        btn.textContent = 'Localizează automat reperele fără coordonate';
        $('poiProgress').textContent = 'Localizare terminată: ' + found + ' găsite (marcate „neverificat” – verifică-le pe hartă)' +
          (missed.length ? '; negăsite: ' + missed.join(', ') + ' – folosește „Editează” → „Caută”.' : '.');
        return loadPois();
      }
      var p = todo[i++];
      $('poiProgress').textContent = 'Se caută ' + i + '/' + todo.length + ': ' + p.name + '…';
      var queries = [cleanForSearch(p.name) + ', Iași'].concat(p.aliases.slice(0, 1).map(function (a) { return a + ', Iași'; }));
      var tryQ = function (k) {
        if (k >= queries.length) return Promise.resolve(null);
        return geocode(queries[k], true).then(function (list) { return list[0] || wait(1100).then(function () { return tryQ(k + 1); }); });
      };
      return tryQ(0).then(function (hit) {
        if (!hit) { missed.push(p.name); return; }
        found++;
        return api('pois', { method: 'POST', body: { id: p.id, name: p.name, category: p.category, aliases: p.aliases, lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), verified: false } });
      }).catch(function () { missed.push(p.name); }).then(function () { return wait(1100); }).then(next);
    }
    next();
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
        fillCategorySelect($('poiCatFilter'), true);
        fillCategorySelect($('poiCategory'), false);
        fillCategorySelect($('importCategory'), false);
        renderGeoStatus(m.geo);
        refresh();
      });
    }).catch(function (e) { showLogin(e.message); });
  }

  boot();
})();
