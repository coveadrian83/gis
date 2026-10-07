/* Mobilitate Iași – aplicația publică de raportare O–D (v0.5) */
(function () {
  'use strict';

  var APP_VERSION = '0.8.0';
  var DATA_FILES = {
    zones: 'data/iasi_17_zone_mva_mvi.geojson',
    uats: 'data/zmi_uat_web.geojson',
    localities: 'data/zmi_localitati_siruta_2025.json',
    localitiesCsv: 'data/zmi_localitati_siruta_2025.csv',
    pois: 'data/mvi_poi_aliases.json'
  };
  var ZMI_FALLBACK_BOUNDS = [[46.98, 27.30], [47.33, 27.90]];
  var LS = {
    pid: 'mob_pid', queue: 'mob_queue', history: 'mob_history', saved: 'mob_saved', refine: 'mob_refine_cache'
  };

  // ---------------------------------------------------------------------------
  // Utilitare
  // ---------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var store = {
    get: function (k, def) {
      try { var v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stocare indisponibilă */ } }
  };
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  }
  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); };
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function localDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(dateStr, n) {
    var p = dateStr.split('-').map(Number);
    return localDateStr(new Date(p[0], p[1] - 1, p[2] + n));
  }
  function fmtDate(s) {
    if (!s) return '';
    var p = s.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }
  function round(v, d) { var f = Math.pow(10, d); return Math.round(v * f) / f; }

  function getParticipantId() {
    var id = store.get(LS.pid, null);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) { id = uuid(); store.set(LS.pid, id); }
    return id;
  }

  function campaignSource() {
    var s = null;
    try {
      var p = new URLSearchParams(location.search).get('source');
      if (p && /^[A-Za-z0-9_.-]{1,40}$/.test(p)) { sessionStorage.setItem('mob_source', p); s = p; }
      else s = sessionStorage.getItem('mob_source');
    } catch (e) { /* ignorat */ }
    return s;
  }

  // ---------------------------------------------------------------------------
  // Stare
  // ---------------------------------------------------------------------------
  var state = {
    cfg: null,
    backend: true,
    geo: null,
    step: 1,
    active: 'origin',
    panMode: false,
    pickMode: false,
    ep: { origin: null, destination: null },
    lastTrip: null
  };
  var map, markers = { origin: null, destination: null }, odLine = null;

  // ---------------------------------------------------------------------------
  // Încărcare configurație și date geografice
  // ---------------------------------------------------------------------------
  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function fetchText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }
  function optional(p) { return p.then(function (x) { return x; }, function () { return null; }); }

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    function split(line) {
      var out = [], f = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (q) { if (c === '"') { if (line[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"') q = true;
        else if (c === sep) { out.push(f); f = ''; }
        else f += c;
      }
      out.push(f);
      return out;
    }
    var head = split(lines[0]).map(function (h) { return h.trim(); });
    return lines.slice(1).map(function (l) {
      var v = split(l), o = {};
      head.forEach(function (h, i) { o[h] = (v[i] || '').trim(); });
      return o;
    });
  }

  function localConfig() {
    var today = localDateStr(new Date());
    return {
      app_version: APP_VERSION, geometry_version: '?', study_start: '2026-10-01', study_end: '2027-04-30',
      max_days_back: 7, today: today, min_date: addDays(today, -7), max_date: today, collection_open: true,
      geocoder_url: 'https://nominatim.openstreetmap.org/search',
      tile_url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      tile_attribution: '&copy; contribuitorii <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      coord_decimals: 4
    };
  }

  function load() {
    var cfgP = fetchJson('api/config').then(function (c) { state.backend = true; return c; }, function () {
      state.backend = false;
      return localConfig();
    });
    var locP = optional(fetchJson(DATA_FILES.localities)).then(function (j) {
      return j || optional(fetchText(DATA_FILES.localitiesCsv)).then(function (t) { return t ? parseCsv(t) : null; });
    });
    return Promise.all([
      cfgP,
      optional(fetchJson(DATA_FILES.zones)),
      optional(fetchJson(DATA_FILES.uats)),
      locP,
      // reperele: lista curentă de la server (inclusiv cele adăugate din dashboard); altfel fișierul
      optional(fetchJson('api/pois')).then(function (p) { return p || optional(fetchJson(DATA_FILES.pois)); })
    ]).then(function (r) {
      state.cfg = r[0];
      state.geo = GeoCore.buildModel({ zones: r[1], uats: r[2], localities: r[3], pois: r[4], poiCategories: Domain.POI_CATEGORIES });
    });
  }

  // ---------------------------------------------------------------------------
  // Hartă
  // ---------------------------------------------------------------------------
  function zmiBounds() {
    var b = state.geo && state.geo.bbox;
    return b ? [[b[1], b[0]], [b[3], b[2]]] : ZMI_FALLBACK_BOUNDS;
  }

  function polygonsToLatLngs(polys) {
    return polys.map(function (poly) {
      return poly.map(function (ring) { return ring.map(function (c) { return [c[1], c[0]]; }); });
    });
  }

  function initMap() {
    map = L.map('map', { zoomControl: true, tap: true, doubleClickZoom: true, scrollWheelZoom: true });
    L.tileLayer(state.cfg.tile_url, { maxZoom: 19, attribution: state.cfg.tile_attribution }).addTo(map);
    map.fitBounds(zmiBounds());

    var overlays = {};
    if (state.geo.uats.length) {
      var uatLayer = L.layerGroup();
      state.geo.uats.forEach(function (u) {
        L.polygon(polygonsToLatLngs(u.polygons), {
          color: '#5b6878', weight: 1, fill: false, dashArray: '4 3', interactive: false
        }).addTo(uatLayer);
      });
      uatLayer.addTo(map);
      overlays['Limite UAT ZMI'] = uatLayer;
    }
    if (state.geo.hasZones) {
      var zoneLayer = L.layerGroup();
      state.geo.zones.forEach(function (z) {
        if (!z.polygons.length) return;
        L.polygon(polygonsToLatLngs(z.polygons), {
          color: '#1d5aa6', weight: 1.2, fillOpacity: 0.04, interactive: false
        }).addTo(zoneLayer);
        if (z.centroid) {
          L.tooltip({ permanent: true, direction: 'center', className: 'zone-label', interactive: false })
            .setLatLng(z.centroid).setContent(z.name).addTo(zoneLayer);
        }
      });
      zoneLayer.addTo(map);
      overlays['Zone de analiză Iași'] = zoneLayer;
      // etichetele zonelor doar la zoom suficient
      var toggleLabels = function () {
        var show = map.getZoom() >= 13;
        document.querySelectorAll('.zone-label').forEach(function (e) { e.style.display = show ? '' : 'none'; });
      };
      map.on('zoomend', toggleLabels);
      toggleLabels();
    }
    if (Object.keys(overlays).length) L.control.layers(null, overlays, { position: 'bottomleft', collapsed: true }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

    map.on('click', function (e) {
      if (state.step !== 1 || state.panMode) return;
      // un punct deja ales se schimbă de pe hartă doar după „Schimbă … pe hartă” (evită atingerile accidentale)
      var target = mapTarget();
      if (!target) return;
      state.pickMode = false;
      setFromPoint(target, e.latlng.lat, e.latlng.lng, 'map');
    });

    $('btnPan').addEventListener('click', function () {
      state.panMode = !state.panMode;
      this.setAttribute('aria-pressed', state.panMode ? 'true' : 'false');
      updateHint();
    });
    $('btnFit').addEventListener('click', function () { map.fitBounds(zmiBounds()); });
    $('btnCenter').addEventListener('click', function () {
      var iasi = state.geo.iasiUat;
      if (iasi && iasi.bbox) map.fitBounds([[iasi.bbox[1], iasi.bbox[0]], [iasi.bbox[3], iasi.bbox[2]]]);
      else map.setView(GeoCore.IASI_CENTER, 13);
    });
    $('btnLocate').addEventListener('click', locateMe);
  }

  function locateMe() {
    if (!navigator.geolocation) return toast('Browserul nu permite localizarea.', true);
    if (state.step !== 1) return;
    var which = mapTarget() || state.active;
    var btn = $('btnLocate');
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.disabled = false;
      setFromPoint(which, pos.coords.latitude, pos.coords.longitude, 'map', 'Locația mea');
      map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 14));
    }, function () {
      btn.disabled = false;
      toast('Locația nu a putut fi determinată. Caută sau atinge harta.', true);
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function markerIcon(which) {
    return L.divIcon({
      className: '',
      html: '<div class="od-marker ' + (which === 'origin' ? 'o' : 'd') + '"><span>' + (which === 'origin' ? 'O' : 'D') + '</span></div>',
      iconSize: [30, 30], iconAnchor: [15, 30]
    });
  }

  function drawEndpoint(which) {
    var ep = state.ep[which];
    if (markers[which]) { map.removeLayer(markers[which]); markers[which] = null; }
    if (ep) {
      markers[which] = L.marker([ep.lat, ep.lng], { icon: markerIcon(which), draggable: true, keyboard: false, title: ep.label })
        .addTo(map);
      markers[which].on('dragend', function (e) {
        var ll = e.target.getLatLng();
        var cur = state.ep[which];
        if (cur && cur.source === 'locality') {
          // identitatea SIRUTA rămâne; se rafinează doar poziția markerului
          cur.lat = ll.lat; cur.lng = ll.lng; cur.approx = false;
          cur.cls = GeoCore.classifyEndpoint(state.geo, cur);
          renderEndpoint(which);
          drawLine();
        } else {
          setFromPoint(which, ll.lat, ll.lng, 'map');
        }
      });
    }
    drawLine();
  }

  function drawLine() {
    if (odLine) { map.removeLayer(odLine); odLine = null; }
    var o = state.ep.origin, d = state.ep.destination;
    if (o && d) {
      odLine = L.polyline([[o.lat, o.lng], [d.lat, d.lng]], { color: '#123a6b', weight: 3, dashArray: '6 6', opacity: 0.7, interactive: false }).addTo(map);
    }
  }

  function fitOD() {
    var o = state.ep.origin, d = state.ep.destination;
    map.stop();
    if (o && d) map.fitBounds([[o.lat, o.lng], [d.lat, d.lng]], { padding: [50, 50], maxZoom: 15, animate: false });
    else if (o || d) { var p = o || d; map.setView([p.lat, p.lng], Math.max(map.getZoom(), 13), { animate: false }); }
  }

  /** Ce punct setează o atingere a hărții: cel activ dacă e gol sau dacă s-a cerut „Schimbă … pe hartă”, altfel cel încă gol. */
  function mapTarget() {
    if (state.pickMode || !state.ep[state.active]) return state.active;
    if (!state.ep.origin) return 'origin';
    if (!state.ep.destination) return 'destination';
    return null;
  }

  function updateHint() {
    var h = $('mapHint');
    h.className = 'map-hint';
    h.textContent = '';
    if (state.step !== 1) return;
    if (state.panMode) { h.textContent = 'Mod Pan activ – apasă „Pan” din nou pentru a selecta pe hartă'; return; }
    var t = mapTarget();
    if (!t) return;
    h.textContent = 'Atinge harta pentru a alege ' + (t === 'origin' ? 'ORIGINEA' : 'DESTINAȚIA');
    h.classList.add(t);
  }

  // ---------------------------------------------------------------------------
  // Selecția originii / destinației
  // ---------------------------------------------------------------------------
  function unitDescription(c) {
    if (!c) return '';
    switch (c.unit_type) {
      case 'IAS_ZONE': return 'Iași · zona ' + c.unit_name + ' (' + c.unit_id + ')';
      case 'LOCALITY': return 'Localitatea ' + c.unit_name + (c.uat_name && c.uat_name !== c.unit_name ? ', UAT ' + c.uat_name : '') + ' · SIRUTA ' + c.locality_siruta;
      case 'UAT_REST': return c.flags && c.flags.indexOf('IASI_NO_ZONE') >= 0 ? 'Municipiul Iași · în afara celor 17 zone de analiză' : 'Comuna ' + c.uat_name + ' (pentru sat, caută-l după nume)';
      default: return c.flags && c.flags.indexOf('GEO_MISSING') >= 0 ? 'Clasificare la server' : 'În afara Zonei Metropolitane Iași (acceptat, marcat separat)';
    }
  }

  function setEndpoint(which, ep) {
    state.pickMode = false;
    ep.cls = GeoCore.classifyEndpoint(state.geo, ep);
    state.ep[which] = ep;
    $('q-' + which).value = ep.label;
    closeResults(which);
    renderEndpoint(which);
    drawEndpoint(which);
    if (which === 'origin' && !state.ep.destination) setActive('destination');
    else if (which === 'destination' && !state.ep.origin) setActive('origin');
    else updateHint();
    fitOD();
    updateStep1();
  }

  function setFromPoint(which, lat, lng, source, label) {
    var c = GeoCore.classifyPoint(state.geo, lat, lng);
    var name = label || 'Punct pe hartă';
    if (!label && c.unit_type !== 'OUT_ZMI') name = 'Punct pe hartă – ' + c.unit_name;
    setEndpoint(which, { source: source, ref: null, label: name, lat: lat, lng: lng, approx: false });
  }

  function renderEndpoint(which) {
    var ep = state.ep[which];
    var box = $('s-' + which);
    var wrap = $('ep-' + which);
    box.innerHTML = '';
    wrap.classList.toggle('ok', !!ep);
    if (!ep) return;
    box.appendChild(el('span', { class: 'ok', text: '✓ ' + (which === 'origin' ? 'Origine selectată' : 'Destinație selectată') }));
    box.appendChild(el('span', { class: 'unit', text: unitDescription(ep.cls) }));
    if (ep.approx) box.appendChild(el('span', { class: 'warn', text: 'Poziția pe hartă este provizorie (centrul UAT). Localitatea aleasă rămâne valabilă; poți muta markerul.' }));
    if (ep.refining) box.appendChild(el('span', { class: 'unit', text: 'Se rafinează poziția pe hartă…' }));
  }

  function clearEndpoint(which) {
    state.ep[which] = null;
    $('q-' + which).value = '';
    renderEndpoint(which);
    drawEndpoint(which);
    setActive(which);
    updateStep1();
  }

  function setActive(which) {
    state.active = which;
    $('ep-origin').classList.toggle('active', which === 'origin');
    $('ep-destination').classList.toggle('active', which === 'destination');
    updateHint();
  }

  function updateStep1() {
    $('btnStep2').disabled = !(state.ep.origin && state.ep.destination);
  }

  // --- rafinarea poziției unei localități SIRUTA prin geocodare (Metodologie §7) ---
  function refineLocality(which, ep, loc) {
    var cache = store.get(LS.refine, {});
    var key = loc.siruta;
    var uat = state.geo.uatBySiruta[loc.uat_siruta];
    function apply(lat, lng) {
      var cur = state.ep[which];
      if (!cur || cur !== ep) return;
      cur.lat = lat; cur.lng = lng; cur.approx = false; cur.refining = false;
      cur.cls = GeoCore.classifyEndpoint(state.geo, cur);
      renderEndpoint(which); drawEndpoint(which); fitOD();
    }
    if (cache[key]) return apply(cache[key][0], cache[key][1]);
    if (!state.cfg.geocoder_url) { ep.refining = false; renderEndpoint(which); return; }
    var q = loc.name + ', ' + (loc.uat_name || '') + ', județul Iași, România';
    geocode(q, 3).then(function (list) {
      var hit = list.filter(function (r) {
        return !uat || GeoCore.inPolygons(uat.polygons, r.lng, r.lat);
      })[0];
      if (hit) {
        cache[key] = [round(hit.lat, 5), round(hit.lng, 5)];
        store.set(LS.refine, cache);
        apply(hit.lat, hit.lng);
      } else {
        var cur = state.ep[which];
        if (cur === ep) { cur.refining = false; renderEndpoint(which); }
      }
    }, function () {
      var cur = state.ep[which];
      if (cur === ep) { cur.refining = false; renderEndpoint(which); }
    });
  }

  function selectEntry(which, entry) {
    var g = state.geo;
    if (entry.kind === 'poi') {
      setEndpoint(which, { source: 'poi', ref: entry.ref, label: entry.label, lat: entry.lat, lng: entry.lng, approx: false });
    } else if (entry.kind === 'locality') {
      var loc = g.localityBySiruta[entry.ref];
      var label = loc.name + (loc.uat_name && loc.uat_name !== loc.name ? ', ' + loc.uat_name : '');
      var lat = loc.lat, lng = loc.lng, approx = false;
      if (lat === null || lng === null) {
        var u = g.uatBySiruta[loc.uat_siruta];
        var c = u ? u.centroid : GeoCore.IASI_CENTER;
        lat = c[0]; lng = c[1]; approx = true;
      }
      var ep = { source: 'locality', ref: loc.siruta, label: label, lat: lat, lng: lng, approx: approx, refining: approx };
      setEndpoint(which, ep);
      if (approx) refineLocality(which, ep, loc);
    } else if (entry.kind === 'zone') {
      var z = g.zoneByCode[entry.ref];
      var cen = z.centroid || GeoCore.IASI_CENTER;
      setEndpoint(which, { source: 'zone', ref: z.code, label: z.name + ' (Iași)', lat: cen[0], lng: cen[1], approx: false });
    } else if (entry.kind === 'geocoder') {
      setEndpoint(which, { source: 'geocoder', ref: null, label: entry.label, lat: entry.lat, lng: entry.lng, approx: false });
    }
  }

  // ---------------------------------------------------------------------------
  // Căutare
  // ---------------------------------------------------------------------------
  var KIND_ICON = { poi: '★', locality: '⌂', zone: '◩', geocoder: '⌖' };
  var resultsState = { origin: { items: [], sel: -1, seq: 0 }, destination: { items: [], sel: -1, seq: 0 } };

  function geocode(q, limit) {
    var url = state.cfg.geocoder_url;
    if (!url) return Promise.resolve([]);
    var b = zmiBounds();
    var params = new URLSearchParams({
      q: q, format: 'jsonv2', limit: String(limit || 5), countrycodes: 'ro', 'accept-language': 'ro',
      viewbox: [b[0][1] - 0.1, b[1][0] + 0.1, b[1][1] + 0.1, b[0][0] - 0.1].join(','), bounded: '0'
    });
    return fetch(url + '?' + params.toString(), { headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('geocoder'); return r.json(); })
      .then(function (list) {
        return (list || []).map(function (r) {
          var parts = String(r.display_name || '').split(',').map(function (s) { return s.trim(); });
          return { kind: 'geocoder', label: parts.slice(0, 2).join(', '), sub: parts.slice(2, 5).join(', '), lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
        });
      });
  }

  function renderResults(which, items, loadingExternal) {
    var ul = $('r-' + which);
    var input = $('q-' + which);
    var rs = resultsState[which];
    rs.items = items;
    rs.sel = items.length ? 0 : -1;
    ul.innerHTML = '';
    var lastGroup = null;
    var labels = { poi: 'Repere', locality: 'Localități (SIRUTA)', zone: 'Zone de analiză Iași', geocoder: 'OpenStreetMap' };
    var cats = Domain.byCode(Domain.POI_CATEGORIES);
    items.forEach(function (it, i) {
      var cat = it.kind === 'poi' ? cats[it.category] : null;
      var group = it.kind + (cat ? ':' + cat.code : '');
      if (group !== lastGroup) {
        ul.appendChild(el('li', { class: 'sep', role: 'presentation', text: cat ? cat.label : labels[it.kind] }));
        lastGroup = group;
      }
      var li = el('li', { role: 'option', id: 'opt-' + which + '-' + i, 'aria-selected': i === rs.sel ? 'true' : 'false' }, [
        el('span', { class: 'k', 'aria-hidden': 'true', text: cat ? cat.icon : (KIND_ICON[it.kind] || '•') }),
        el('span', null, [el('span', { class: 't', text: it.label }), el('span', { class: 's', text: it.sub || '' })])
      ]);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); selectEntry(which, it); });
      ul.appendChild(li);
    });
    if (loadingExternal) ul.appendChild(el('li', { class: 'empty', text: 'Se caută în OpenStreetMap…' }));
    else if (!items.length) ul.appendChild(el('li', { class: 'empty', text: 'Niciun rezultat. Încearcă altă formulare sau atinge harta.' }));
    ul.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function closeResults(which) {
    $('r-' + which).hidden = true;
    $('q-' + which).setAttribute('aria-expanded', 'false');
  }

  var externalSearch = debounce(function (which, q, local) {
    var rs = resultsState[which];
    var seq = rs.seq;
    geocode(q + ', Iași', 5).then(function (ext) {
      if (seq !== rs.seq) return;
      // eliminăm rezultatele externe aflate foarte aproape de cele locale
      ext = ext.filter(function (e) {
        return !local.some(function (l) { return l.lat !== null && GeoCore.haversineKm(l.lat, l.lng, e.lat, e.lng) < 0.15; });
      });
      renderResults(which, local.concat(ext), false);
    }, function () {
      if (seq === rs.seq) renderResults(which, local, false);
    });
  }, 650);

  function onSearchInput(which) {
    var q = $('q-' + which).value;
    var rs = resultsState[which];
    rs.seq++;
    if (GeoCore.normalize(q).length < 2) { closeResults(which); return; }
    var local = GeoCore.search(state.geo, q, 8); // pentru o categorie („spita”, „univ”) întoarce toate reperele ei
    var wantExternal = !!state.cfg.geocoder_url && GeoCore.normalize(q).length >= 3 && local.length < 4;
    renderResults(which, local, wantExternal);
    if (wantExternal) externalSearch(which, q, local);
  }

  function onSearchKey(which, e) {
    var rs = resultsState[which];
    var ul = $('r-' + which);
    if (ul.hidden || !rs.items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      rs.sel = (rs.sel + (e.key === 'ArrowDown' ? 1 : -1) + rs.items.length) % rs.items.length;
      ul.querySelectorAll('[role=option]').forEach(function (li, i) { li.setAttribute('aria-selected', i === rs.sel ? 'true' : 'false'); });
      var cur = $('opt-' + which + '-' + rs.sel);
      if (cur) cur.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (rs.sel >= 0) selectEntry(which, rs.items[rs.sel]);
    } else if (e.key === 'Escape') closeResults(which);
  }

  function bindSearch(which) {
    var input = $('q-' + which);
    input.addEventListener('input', function () { onSearchInput(which); });
    input.addEventListener('keydown', function (e) { onSearchKey(which, e); });
    input.addEventListener('focus', function () { setActive(which); });
    input.addEventListener('blur', function () { setTimeout(function () { closeResults(which); }, 150); });
  }

  // ---------------------------------------------------------------------------
  // Relații salvate
  // ---------------------------------------------------------------------------
  function slimEp(ep) {
    return { source: ep.source, ref: ep.ref, label: ep.label, lat: ep.lat, lng: ep.lng, approx: !!ep.approx };
  }

  function renderSaved() {
    var saved = store.get(LS.saved, []);
    var wrap = $('savedWrap'), list = $('savedList');
    list.innerHTML = '';
    wrap.hidden = !saved.length;
    saved.forEach(function (s, i) {
      var b = el('button', { type: 'button', title: 'Completează O/D' }, [
        s.origin.label.split(',')[0] + ' → ' + s.destination.label.split(',')[0]
      ]);
      b.addEventListener('click', function () {
        setEndpoint('origin', Object.assign({}, s.origin));
        setEndpoint('destination', Object.assign({}, s.destination));
      });
      var del = el('button', { type: 'button', class: 'del', 'aria-label': 'Șterge relația salvată', text: '×' });
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        var cur = store.get(LS.saved, []);
        cur.splice(i, 1);
        store.set(LS.saved, cur);
        renderSaved();
      });
      b.appendChild(del);
      list.appendChild(b);
    });
  }

  function saveRelation(o, d) {
    var saved = store.get(LS.saved, []);
    var key = function (x) { return (x.ref || '') + '|' + round(x.lat, 3) + ',' + round(x.lng, 3); };
    if (saved.some(function (s) { return key(s.origin) === key(o) && key(s.destination) === key(d); })) return false;
    saved.unshift({ origin: slimEp(o), destination: slimEp(d) });
    store.set(LS.saved, saved.slice(0, 8));
    renderSaved();
    return true;
  }

  // ---------------------------------------------------------------------------
  // Pași
  // ---------------------------------------------------------------------------
  function goStep(n) {
    state.step = n;
    ['step1', 'step2', 'step3', 'stepDone'].forEach(function (id) { $(id).hidden = true; });
    $(n === 'done' ? 'stepDone' : 'step' + n).hidden = false;
    var num = n === 'done' ? 3 : n;
    document.querySelectorAll('.progress li').forEach(function (li) {
      var s = parseInt(li.getAttribute('data-step'), 10);
      li.classList.toggle('active', s === num && n !== 'done');
      li.classList.toggle('done', s < num || n === 'done');
    });
    $('progressFill').style.width = (n === 'done' ? 100 : (num / 3) * 100) + '%';
    $('progressLabel').textContent = n === 'done' ? 'Gata!' : 'Pasul ' + num + '/3';
    if (n === 2 || n === 3) {
      var recap = '<strong>O:</strong> ' + esc(state.ep.origin.label) + ' &nbsp;→&nbsp; <strong>D:</strong> ' + esc(state.ep.destination.label);
      if (n === 3) recap += '<br>' + fmtDate($('tripDate').value) + ', ' + $('depTime').value + '–' + $('arrTime').value + ' · ' + Domain.formatDuration(currentDuration().minutes);
      $('recap' + n).innerHTML = recap;
    }
    updateHint();
    var panel = document.querySelector('.panel');
    if (window.innerWidth >= 900) panel.scrollTop = 0;
    else if (n === 1) window.scrollTo(0, 0);
    else $('step' + (n === 'done' ? 'Done' : n)).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // --- pasul 2 ----------------------------------------------------------------
  function currentDuration() {
    return Domain.durationMinutes($('depTime').value, $('arrTime').value) || { minutes: null, overnight: false };
  }

  function validateStep2() {
    var box = $('durationBox');
    var date = $('tripDate').value;
    var cfg = state.cfg;
    var err = '';
    if (!date) err = 'Alege data deplasării.';
    else if (date > cfg.max_date) err = 'Data nu poate fi în viitor.';
    else if (date < cfg.min_date) err = date < cfg.study_start ? 'Data este anterioară începerii studiului (' + fmtDate(cfg.study_start) + ').' : 'Se pot raporta deplasări din ultimele ' + cfg.max_days_back + ' zile.';
    var d = currentDuration();
    box.className = 'duration';
    if (d.minutes === null) {
      box.textContent = 'Completează ora plecării și ora sosirii; durata se calculează automat.';
    } else if (d.minutes < 1) {
      box.className = 'duration err';
      box.textContent = 'Ora sosirii trebuie să fie după ora plecării.';
      err = err || ' ';
    } else {
      box.innerHTML = 'Durata: <strong>' + Domain.formatDuration(d.minutes) + '</strong>' +
        (d.overnight ? '<br><small>Sosire după miezul nopții – verifică orele.</small>' : '') +
        (d.minutes > 180 ? '<br><small>Durată neobișnuit de mare – verifică orele (vom păstra valoarea dacă este corectă).</small>' : '');
      if (d.overnight || d.minutes > 180) box.className = 'duration warn';
      // sosirea nu poate fi în viitor
      if (date === cfg.today) {
        var now = new Date();
        var nowMin = now.getHours() * 60 + now.getMinutes();
        var dep = Domain.parseHHMM($('depTime').value);
        if (!d.overnight && dep + d.minutes > nowMin + 15) err = 'Ora sosirii este în viitor. Raportează deplasarea după ce ai ajuns.';
      }
    }
    var e2 = $('err2');
    e2.hidden = !err.trim();
    e2.textContent = err.trim();
    $('btnStep3').disabled = !!err || d.minutes === null;
  }

  // --- pasul 3 ----------------------------------------------------------------
  function radioChips(containerId, name, items, onChange) {
    var c = $(containerId);
    c.innerHTML = '';
    items.forEach(function (it) {
      var input = el('input', { type: 'radio', name: name, value: String(it.code) });
      input.addEventListener('change', onChange);
      c.appendChild(el('label', null, [input, (it.icon ? it.icon + ' ' : '') + it.label]));
    });
  }

  function checkboxChips(containerId, name, items, onChange) {
    var c = $(containerId);
    c.innerHTML = '';
    items.forEach(function (it) {
      var input = el('input', { type: 'checkbox', name: name, value: String(it.code) });
      input.addEventListener('change', function () {
        // „drum direct” exclude opririle și invers
        var boxes = document.querySelectorAll('input[name="' + name + '"]');
        if (input.checked) {
          boxes.forEach(function (b) {
            var other = Domain.STOP_TYPES.filter(function (x) { return x.code === b.value; })[0];
            if (b !== input && (it.exclusive || (other && other.exclusive))) b.checked = false;
          });
        }
        if (onChange) onChange();
      });
      c.appendChild(el('label', null, [input, it.label]));
    });
  }

  function checkedValues(name) {
    return Array.prototype.map.call(document.querySelectorAll('input[name="' + name + '"]:checked'), function (b) { return b.value; });
  }

  function radioValue(name) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : null;
  }

  function setRadio(name, value) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) { r.checked = r.value === String(value); });
  }

  function onStep3Change() {
    var mode = radioValue('mode');
    $('carFields').hidden = mode !== 'car';
    $('ptFields').hidden = !Domain.isPublicTransport(mode);
    var role = radioValue('car_role');
    var one = document.querySelector('input[name="occupancy"][value="1"]');
    if (one) {
      one.disabled = role === 'passenger';
      if (one.disabled && one.checked) one.checked = false;
    }
    var ok = mode && radioValue('purpose') && radioValue('repeat_type');
    if (mode === 'car') ok = ok && role && radioValue('occupancy');
    $('btnSubmit').disabled = !ok;
  }

  function resetStep3() {
    ['mode', 'car_role', 'occupancy', 'purpose', 'repeat_type'].forEach(function (n) { setRadio(n, null); });
    document.querySelectorAll('input[name="stops"]').forEach(function (b) { b.checked = false; });
    $('ptLine').value = '';
    onStep3Change();
  }

  // ---------------------------------------------------------------------------
  // Trimitere + coadă locală pentru lipsa conexiunii
  // ---------------------------------------------------------------------------
  function buildPayload() {
    var dec = 5;
    function ep(x) {
      return { source: x.source, ref: x.ref, label: x.label, lat: round(x.lat, dec), lng: round(x.lng, dec), approx: !!x.approx };
    }
    var mode = radioValue('mode');
    return {
      trip_id: uuid(),
      participant_id: getParticipantId(),
      app_version: APP_VERSION,
      campaign_source: campaignSource(),
      trip_date: $('tripDate').value,
      departure_time: $('depTime').value,
      arrival_time: $('arrTime').value,
      origin: ep(state.ep.origin),
      destination: ep(state.ep.destination),
      mode: mode,
      purpose: radioValue('purpose'),
      repeat_type: radioValue('repeat_type'),
      stops: checkedValues('stops').length ? checkedValues('stops') : null,
      car_role: mode === 'car' ? radioValue('car_role') : null,
      occupancy: mode === 'car' ? parseInt(radioValue('occupancy'), 10) : null,
      pt_line: Domain.isPublicTransport(mode) ? ($('ptLine').value.trim() || null) : null
    };
  }

  function postTrip(payload) {
    return fetch('api/trips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (r.ok) return body;
        var e = new Error(body.error || ('Eroare ' + r.status));
        e.status = r.status; e.field = body.field;
        throw e;
      });
    });
  }

  function addHistory(payload, status) {
    var h = store.get(LS.history, []);
    h = h.filter(function (x) { return x.trip_id !== payload.trip_id; });
    h.unshift({
      trip_id: payload.trip_id, status: status, date: payload.trip_date, dep: payload.departure_time, arr: payload.arrival_time,
      o: payload.origin.label, d: payload.destination.label, mode: payload.mode
    });
    store.set(LS.history, h.slice(0, 100));
    renderHistoryCount();
  }

  function enqueue(payload) {
    var q = store.get(LS.queue, []);
    q.push(payload);
    store.set(LS.queue, q);
  }

  var flushing = false;
  function flushQueue() {
    if (flushing || !state.backend) return;
    var q = store.get(LS.queue, []);
    if (!q.length) return;
    flushing = true;
    var next = q[0];
    postTrip(next).then(function () {
      store.set(LS.queue, store.get(LS.queue, []).filter(function (x) { return x.trip_id !== next.trip_id; }));
      addHistory(next, 'sent');
      flushing = false;
      flushQueue();
    }, function (e) {
      flushing = false;
      if (e.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
        // respinsă definitiv de server (ex. a depășit fereastra de 7 zile)
        store.set(LS.queue, store.get(LS.queue, []).filter(function (x) { return x.trip_id !== next.trip_id; }));
        addHistory(next, 'rejected');
        flushQueue();
      }
    });
  }

  function submit() {
    var payload = buildPayload();
    var btn = $('btnSubmit');
    btn.disabled = true;
    btn.textContent = 'SE TRIMITE…';
    $('err3').hidden = true;
    var done = function (pending, result) {
      btn.textContent = 'TRIMITE';
      state.lastTrip = { payload: payload, origin: state.ep.origin, destination: state.ep.destination };
      addHistory(payload, pending ? 'pending' : 'sent');
      showDone(payload, pending, result);
    };
    if (!state.backend) { enqueue(payload); return done(true); }
    postTrip(payload).then(function (res) { done(false, res); }, function (e) {
      if (!e.status || e.status >= 500 || e.status === 429) {
        enqueue(payload);
        return done(true);
      }
      btn.textContent = 'TRIMITE';
      btn.disabled = false;
      var step = { trip_date: 2, departure_time: 2, arrival_time: 2, origin: 1, destination: 1 }[e.field] || 3;
      if (step !== 3) goStep(step);
      var box = step === 2 ? $('err2') : $('err3');
      if (step === 1) toast(e.message, true);
      else { box.textContent = e.message; box.hidden = false; }
    });
  }

  function showDone(payload, pending, result) {
    $('doneTitle').textContent = pending
      ? 'Deplasarea a fost salvată pe dispozitiv'
      : 'Mulțumim! Deplasarea a fost înregistrată.';
    document.querySelector('.done-icon').classList.toggle('pending', pending);
    document.querySelector('.done-icon').textContent = pending ? '⏳' : '✓';
    var modes = Domain.byCode(Domain.MODES), purposes = Domain.byCode(Domain.PURPOSES);
    var rows = [
      ['Origine', payload.origin.label],
      ['Destinație', payload.destination.label],
      ['Data', fmtDate(payload.trip_date)],
      ['Interval', payload.departure_time + ' – ' + payload.arrival_time],
      ['Durată', Domain.formatDuration(Domain.durationMinutes(payload.departure_time, payload.arrival_time).minutes)],
      ['Mod', modes[payload.mode].label + (payload.pt_line ? ' · linia ' + payload.pt_line : '')],
      ['Scop', purposes[payload.purpose].label]
    ];
    if (payload.stops && payload.stops.length) {
      var stopTypes = Domain.byCode(Domain.STOP_TYPES);
      rows.push(['Opriri', payload.stops.map(function (c) { return stopTypes[c] ? stopTypes[c].label : c; }).join('; ')]);
    }
    if (result && result.distance_km) rows.push(['Distanță (linie dreaptă)', String(result.distance_km).replace('.', ',') + ' km']);
    var dl = $('doneSummary');
    dl.innerHTML = '';
    rows.forEach(function (r) { dl.appendChild(el('dt', { text: r[0] })); dl.appendChild(el('dd', { text: r[1] })); });
    $('doneNote').textContent = pending
      ? (state.backend ? 'Conexiunea la server nu a reușit. Deplasarea va fi trimisă automat la următoarea deschidere a aplicației, cu internet.' : 'Serverul de colectare nu este disponibil (mod demonstrativ): datele rămân doar pe acest dispozitiv.')
      : 'Poți raporta oricând și alte deplasări – inclusiv același drum în alte zile.';
    $('btnSave').disabled = false;
    $('btnSave').textContent = '☆ Salvează relația pentru data viitoare';
    goStep('done');
  }

  function newTrip(keepOD, swap) {
    var last = state.lastTrip;
    resetStep3();
    $('depTime').value = '';
    $('arrTime').value = '';
    $('tripDate').value = state.cfg.today;
    $('err2').hidden = true;
    if (keepOD && last) {
      setEndpoint('origin', Object.assign({}, swap ? last.destination : last.origin));
      setEndpoint('destination', Object.assign({}, swap ? last.origin : last.destination));
      $('tripDate').value = last.payload.trip_date;
      if (swap && last.payload.purpose !== 'home') setRadio('purpose', 'home');
      setRadio('repeat_type', last.payload.repeat_type);
      setRadio('mode', last.payload.mode);
      onStep3Change();
      validateStep2();
      goStep(2);
    } else {
      clearEndpoint('destination');
      clearEndpoint('origin');
      validateStep2();
      goStep(1);
      map.fitBounds(zmiBounds());
    }
  }

  // ---------------------------------------------------------------------------
  // Istoric local + ștergere
  // ---------------------------------------------------------------------------
  function renderHistoryCount() {
    var n = store.get(LS.history, []).length;
    var b = $('historyCount');
    b.hidden = !n;
    b.textContent = n;
  }

  function openHistory() {
    var list = $('historyList');
    list.innerHTML = '';
    var h = store.get(LS.history, []);
    var modes = Domain.byCode(Domain.MODES);
    var stLabel = { sent: 'trimisă', pending: 'în așteptare', rejected: 'respinsă de server' };
    if (!h.length) list.appendChild(el('li', { text: 'Nu ai raportat încă nicio deplasare de pe acest dispozitiv.' }));
    h.forEach(function (x) {
      var d = Domain.durationMinutes(x.dep, x.arr);
      list.appendChild(el('li', null, [
        el('strong', { text: x.o + ' → ' + x.d }),
        el('small', { text: fmtDate(x.date) + ', ' + x.dep + '–' + x.arr + ' · ' + Domain.formatDuration(d ? d.minutes : null) + ' · ' + (modes[x.mode] ? modes[x.mode].label : x.mode) }),
        el('span', { class: 'st ' + (x.status === 'sent' ? 'sent' : 'pending'), text: stLabel[x.status] || x.status })
      ]));
    });
    $('eraseMsg').textContent = '';
    var dlg = $('historyDialog');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function eraseMine() {
    if (!confirm('Sigur ștergi toate deplasările trimise de pe acest dispozitiv? Operațiunea este ireversibilă.')) return;
    var msg = $('eraseMsg');
    var finish = function (text) {
      store.set(LS.history, []);
      store.set(LS.queue, []);
      store.set(LS.saved, []);
      try { localStorage.removeItem(LS.pid); } catch (e) { /* ignorat */ }
      renderHistoryCount();
      renderSaved();
      $('historyList').innerHTML = '';
      msg.textContent = text;
    };
    if (!state.backend) return finish('Datele locale au fost șterse.');
    fetch('api/participant/erase', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participant_id: getParticipantId() })
    }).then(function (r) { return r.json(); }).then(function (b) {
      finish('Au fost șterse ' + (b.deleted || 0) + ' deplasări din studiu și datele locale.');
    }, function () {
      msg.textContent = 'Ștergerea nu a reușit (fără conexiune). Încearcă din nou.';
    });
  }

  // ---------------------------------------------------------------------------
  // Mesaje
  // ---------------------------------------------------------------------------
  var toastTimer;
  function toast(text, isError) {
    var n = $('notice');
    n.textContent = text;
    n.className = 'notice' + (isError ? ' error' : '');
    n.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { showPersistentNotice(); }, 6000);
  }

  function showPersistentNotice() {
    var n = $('notice');
    var msgs = [];
    if (!state.backend) msgs.push('Mod demonstrativ: serverul de colectare nu este disponibil, datele rămân doar pe acest dispozitiv.');
    else if (!state.cfg.collection_open) msgs.push('Colectarea oficială se desfășoară între ' + fmtDate(state.cfg.study_start) + ' și ' + fmtDate(state.cfg.study_end) + '.');
    if (!state.geo.hasUats || !state.geo.hasZones) msgs.push('Date geografice incomplete pe acest server – clasificarea finală se face la server.');
    n.className = 'notice';
    n.textContent = msgs.join(' ');
    n.hidden = !msgs.length;
  }

  // ---------------------------------------------------------------------------
  // Inițializare
  // ---------------------------------------------------------------------------
  function bindUi() {
    bindSearch('origin');
    bindSearch('destination');
    document.querySelectorAll('[data-action]').forEach(function (b) {
      b.addEventListener('click', function () {
        var which = b.getAttribute('data-which');
        if (b.getAttribute('data-action') === 'clear') clearEndpoint(which);
        else {
          setActive(which);
          state.pickMode = true;
          updateHint();
          if (state.panMode) { state.panMode = false; $('btnPan').setAttribute('aria-pressed', 'false'); updateHint(); }
          if (window.innerWidth < 900) $('mapWrap').scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
    $('btnSwap').addEventListener('click', function () {
      var o = state.ep.origin, d = state.ep.destination;
      state.ep.origin = null; state.ep.destination = null;
      if (d) setEndpoint('origin', d); else clearEndpoint('origin');
      if (o) setEndpoint('destination', o); else clearEndpoint('destination');
    });
    $('btnResetOD').addEventListener('click', function () {
      clearEndpoint('destination');
      clearEndpoint('origin');
      map.fitBounds(zmiBounds());
    });
    $('step1').addEventListener('submit', function (e) {
      e.preventDefault();
      if (state.ep.origin && state.ep.destination) { validateStep2(); goStep(2); }
    });

    // pasul 2
    var dateInput = $('tripDate');
    dateInput.min = state.cfg.min_date;
    dateInput.max = state.cfg.max_date;
    dateInput.value = state.cfg.today;
    $('dateHint').textContent = 'Poți raporta deplasări din ultimele ' + state.cfg.max_days_back + ' zile.';
    document.querySelectorAll('[data-date]').forEach(function (b) {
      b.addEventListener('click', function () {
        dateInput.value = addDays(state.cfg.today, parseInt(b.getAttribute('data-date'), 10));
        validateStep2();
      });
    });
    ['tripDate', 'depTime', 'arrTime'].forEach(function (id) {
      $(id).addEventListener('input', validateStep2);
      $(id).addEventListener('change', validateStep2);
    });
    $('btnNow').addEventListener('click', function () {
      var n = new Date();
      $('arrTime').value = pad(n.getHours()) + ':' + pad(n.getMinutes());
      validateStep2();
    });
    $('step2').addEventListener('submit', function (e) {
      e.preventDefault();
      validateStep2();
      if (!$('btnStep3').disabled) goStep(3);
    });
    document.querySelectorAll('[data-back]').forEach(function (b) {
      b.addEventListener('click', function () { goStep(parseInt(b.getAttribute('data-back'), 10)); });
    });

    // pasul 3
    radioChips('modeChips', 'mode', Domain.MODES, onStep3Change);
    radioChips('roleChips', 'car_role', Domain.CAR_ROLES, onStep3Change);
    radioChips('occChips', 'occupancy', Domain.OCCUPANCY.map(function (n) { return { code: n, label: n === 5 ? '5+' : String(n) }; }), onStep3Change);
    radioChips('purposeChips', 'purpose', Domain.PURPOSES, onStep3Change);
    radioChips('repeatChips', 'repeat_type', Domain.REPEAT_TYPES, onStep3Change);
    checkboxChips('stopChips', 'stops', Domain.STOP_TYPES, null);
    $('step3').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!$('btnSubmit').disabled) submit();
    });

    // confirmare
    $('btnAnother').addEventListener('click', function () { newTrip(false); });
    $('btnReturn').addEventListener('click', function () { newTrip(true, true); });
    $('btnSave').addEventListener('click', function () {
      var l = state.lastTrip;
      if (!l) return;
      var added = saveRelation(l.origin, l.destination);
      this.textContent = added ? '★ Relație salvată' : '★ Relația era deja salvată';
      this.disabled = true;
    });

    $('btnHistory').addEventListener('click', openHistory);
    $('btnErase').addEventListener('click', eraseMine);
    window.addEventListener('online', flushQueue);
  }

  function start() {
    load().then(function () {
      bindUi();
      initMap();
      setActive('origin');
      renderSaved();
      renderHistoryCount();
      showPersistentNotice();
      $('versionInfo').textContent = 'v' + APP_VERSION + ' · zonare ' + state.cfg.geometry_version;
      flushQueue();
      setInterval(flushQueue, 60000);
    }).catch(function (e) {
      console.error(e);
      toast('Aplicația nu a putut fi încărcată. Reîncarcă pagina.', true);
    });
  }

  start();
})();
