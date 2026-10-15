/* Harta „Sănătatea transportului public” (Iași): pozițiile GPS ale vehiculelor CTP (/live/vehicule, la 30 s; ultima
 * jumătate de oră din /live/istoric) comparate cu orarul GTFS (../../data/transport/sanatate_plan.json).
 * Calculele: core.js (SanatateCore). */
(function () {
  'use strict';
  var C = window.SanatateCore, LIVE_MS = 30000, LABEL_ZOOM = 13;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  // ora Iașiului, oricare ar fi fusul orar al calculatorului
  var clock = function (unix) { return new Date(unix * 1000).toLocaleTimeString('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  var fmt = function (x, d) { return x == null || !isFinite(x) ? '–' : x.toFixed(d || 0).replace('.', ','); };

  var plan = null, tr = null, A = null, mode = 'scor', net = '', sel = null;

  var map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([47.1585, 27.5925], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'basemap',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  var renderer = L.canvas({ padding: 0.3 });
  var lineLayer = L.layerGroup().addTo(map), vehLayer = L.layerGroup().addTo(map), alertLayer = L.layerGroup().addTo(map);

  // ---------- culori ----------
  var VEH = {
    pluton: ['#b07cf0', 'în pluton (prea aproape de vehiculul vecin)'],
    oprit: ['#d8433b', 'stă de peste 3 minute'],
    lent: ['#e58a2e', 'sub 8 km/h în ultimele minute'],
    normal: ['#f0efec', 'circulă normal'],
    cap: ['#8f8e86', 'la capăt de linie'],
    fara: ['#55554f', 'fără linie atribuită / în afara traseului']
  };
  function vehState(s) {
    if (!s.key) return 'fara';
    if (s.cap) return 'cap';
    if (s.pluton) return 'pluton';
    if (s.oprit >= C.CFG.stopMin) return 'oprit';
    if (s.viteza != null && s.viteza < 8) return 'lent';
    return 'normal';
  }

  function legend() {
    var h = '';
    if (mode === 'scor') {
      h += C.LEVELS.map(function (l) { return '<span><i class="ln" style="background:' + l[2] + '"></i>' + l[1] + '</span>'; }).join('') +
        '<span><i class="ln" style="background:#8f8e86"></i>fără date / de verificat</span>';
    } else {
      h += C.SPEED_CLASSES.map(function (c) { return '<span><i class="ln" style="background:' + c[1] + '"></i>' + c[2] + '</span>'; }).join('');
    }
    if ($('showVeh').checked) {
      h += '<span class="grp">Vehicule</span>' + Object.keys(VEH).map(function (k) {
        return '<span><i class="dt" style="background:' + VEH[k][0] + '"></i>' + VEH[k][1] + '</span>';
      }).join('');
    }
    $('legend').innerHTML = h;
  }

  // ---------- desenare ----------
  function lineName(l) { return (l.tip === 'tramvai' ? 'Tramvaiul ' : 'Autobuzul ') + l.linie + ' → ' + l.spre; }
  function visible(l) {
    if (net === 'tramvai' && l.tip !== 'tramvai') return false;
    if ((net === 'local' || net === 'metropolitan') && (l.tip === 'tramvai' || l.retea !== net)) return false;
    if ($('onlyBad').checked && !(l.scor != null && l.scor < 60)) return false;
    return true;
  }

  function drawLines() {
    lineLayer.clearLayers();
    if (!A) return;
    if (mode === 'scor') {
      // întâi liniile bune, deasupra cele cu probleme
      Object.keys(A.linii).map(function (k) { return A.linii[k]; }).filter(visible)
        .sort(function (a, b) { return (b.scor == null ? 101 : b.scor) - (a.scor == null ? 101 : a.scor); })
        .forEach(function (l) {
          var sh = tr.shapes[l.key];
          if (!sh) return;
          var isSel = sel === l.key, dim = sel && !isSel;
          L.polyline(sh.coords.map(function (c) { return [c[1], c[0]]; }), {
            renderer: renderer, color: l.nivel.culoare, weight: isSel ? 7 : l.scor != null && l.scor < 60 ? 4.5 : 3,
            opacity: dim ? 0.15 : 0.85, dashArray: l.suspect ? '4 6' : null
          }).on('click', function () { select(l.key, false); })
            .bindTooltip(esc(lineName(l)) + (l.scor != null ? ' · scor ' + l.scor : ''), { sticky: true })
            .addTo(lineLayer);
        });
    } else {
      C.speedBins(tr).filter(function (b) { return !sel || b.key === sel; })
        .sort(function (a, b) { return b.viteza - a.viteza; })
        .forEach(function (b) {
          var l = plan.rute[b.key];
          L.polyline(b.coords.map(function (c) { return [c[1], c[0]]; }), {
            renderer: renderer, color: C.speedColor(b.viteza), weight: b.viteza < 10 ? 5 : 3.5, opacity: 0.9
          }).bindTooltip(esc(l.linie + ' → ' + l.spre) + ': ' + fmt(b.viteza) + ' km/h (' + b.n + (b.n === 1 ? ' trecere' : ' treceri') + ')', { sticky: true })
            .on('click', function () { select(b.key, false); })
            .addTo(lineLayer);
        });
    }
  }

  function drawVehicles() {
    vehLayer.clearLayers();
    if (!A || !$('showVeh').checked) return;
    var labels = map.getZoom() >= LABEL_ZOOM;
    A.vehicule.forEach(function (s) {
      var st = vehState(s), l = s.key ? A.linii[s.key] : null;
      if (sel && s.key !== sel) return;
      if (l && !visible(l)) return;
      var c = s.cur, r = plan.rute[s.key];
      // de la zoom 13: eticheta cu numărul liniei, în culoarea stării; mai departe, doar cercuri (orașul întreg)
      var mk = labels && r ? L.marker([c.lat, c.lng], {
        icon: L.divIcon({ className: '', iconSize: null, html: '<span class="vlab ' + st + '" style="background:' + VEH[st][0] + '">' + esc(r.linie) + '</span>' }),
        riseOnHover: true, zIndexOffset: st === 'cap' ? -100 : st === 'normal' ? 0 : 100
      }) : L.circleMarker([c.lat, c.lng], {
        renderer: renderer, radius: st === 'fara' ? 3.5 : st === 'cap' ? 4 : 5.5, color: '#111', weight: 1,
        fillColor: VEH[st][0], fillOpacity: st === 'fara' ? 0.6 : 0.95
      });
      mk.bindPopup(function () {
        return '<b>' + esc(r ? (r.tip === 'tramvai' ? 'Tramvaiul ' : 'Autobuzul ') + r.linie + ' → ' + r.spre : 'Vehicul fără linie atribuită' + (c.ruta ? ' (ruta ' + c.ruta + ' din sursă)' : '')) + '</b>' +
          '<br>Vehiculul ' + esc(c.nr || s.id) + ' · ' + VEH[st][1] +
          (s.viteza != null ? '<br>Avans pe traseu: ' + fmt(s.viteza) + ' km/h (ultimele minute)' : '') +
          (c.v != null ? '<br>Viteza instantanee (GPS): ' + fmt(c.v) + ' km/h' : '') +
          (s.oprit >= 60 ? '<br>Nu s-a deplasat de ' + C.fmtMin(s.oprit / 60) : '') +
          '<br><span class="note">semnal acum ' + C.fmtMin(s.vechime / 60) + '</span>';
      }).addTo(vehLayer);
    });
  }

  function drawAlerts() {
    alertLayer.clearLayers();
    if (!A) return;
    A.alerte.filter(function (a) { return a.grav >= 3 && a.lat; }).forEach(function (a) {
      L.marker([a.lat, a.lng], { icon: L.divIcon({ className: '', html: '<div class="blip"></div>', iconSize: [26, 26] }), interactive: false }).addTo(alertLayer);
    });
  }

  // ---------- panoul ----------
  function hero() {
    var R = A.retea, lv = C.level(R.scor), el = $('score');
    el.style.borderColor = lv.culoare;
    el.querySelector('b').textContent = R.scor == null ? '–' : R.scor;
    var t = clock(A.t);
    var running = Object.keys(A.linii).length;
    $('heroText').innerHTML = 'Rețeaua e <b>' + lv.nume + '</b> acum (' + t + '): ' + running + ' linii-sens în circulație, ' +
      '<b>' + R.cuGps + '</b> vehicule cu GPS pe traseu față de <b>' + R.planificate + '</b> cerute de orar.';
    var lipsa = A.alerte.filter(function (a) { return a.tip === 'lipsa'; }).length;
    $('kpis').innerHTML = [
      [R.serviciu == null ? '–' : Math.round(R.serviciu * 100) + '%', 'din serviciul din orar e pe stradă, cu GPS'],
      [fmt(R.viteza) + ' km/h', 'viteza mediană de avans pe traseu (fără capete)'],
      [R.pluton, R.pluton === 1 ? 'pluton (vehicule lipite pe aceeași linie)' : 'plutoane (vehicule lipite pe aceeași linie)'],
      [R.opriti, 'vehicule oprite de peste 3 minute pe traseu'],
      [lipsa, lipsa === 1 ? 'linie fără niciun vehicul cu GPS (orarul cere ≥ 2)' : 'linii fără niciun vehicul cu GPS (orarul cere ≥ 2)'],
      [R.faraLinie, 'vehicule cu GPS fără linie / în afara traseului']
    ].map(function (k) { return '<div><b>' + k[0] + '</b><small>' + k[1] + '</small></div>'; }).join('');
  }

  var ALERT_LBL = { blocaj: 'blocaj', pluton: 'pluton', gol: 'gol', oprit: 'oprit', lipsa: 'lipsă' };
  function alerts() {
    var list = A.alerte.filter(function (a) { return !a.key || visible(A.linii[a.key]); });
    $('alertCount').textContent = list.length ? '(' + list.length + ')' : '';
    $('alerts').innerHTML = list.length ? list.slice(0, 60).map(function (a, i) {
      return '<div class="alert ' + a.tip + ' g' + a.grav + '" data-i="' + i + '"><i>' + ALERT_LBL[a.tip] + '</i><span>' + esc(a.text) + '</span></div>';
    }).join('') : '<p class="empty">Niciun semnal deosebit în acest moment.</p>';
    Array.prototype.forEach.call($('alerts').children, function (el) {
      el.addEventListener('click', function () {
        var a = list[+el.dataset.i];
        if (!a) return;
        if (a.key) select(a.key, !a.lat);
        if (a.lat) map.setView([a.lat, a.lng], Math.max(map.getZoom(), 15));
      });
    });
  }

  function rank() {
    var L_ = Object.keys(A.linii).map(function (k) { return A.linii[k]; }).filter(visible);
    L_.sort(function (a, b) {
      var sa = a.scor == null ? 1000 : a.scor, sb = b.scor == null ? 1000 : b.scor;
      return sa - sb || b.planificat.vehicule - a.planificat.vehicule;
    });
    $('rank').innerHTML = L_.map(function (l) {
      var na = l.scor == null;
      return '<div class="r' + (na ? ' na' : '') + (sel === l.key ? ' sel' : '') + '" data-k="' + l.key + '">' +
        '<span class="badge" style="background:' + l.culoare + '">' + esc(l.linie) + '</span>' +
        '<span class="nm" title="' + esc(l.spre) + '">→ ' + esc(l.spre) + '</span>' +
        '<span class="track"><span class="fill" style="width:' + (na ? 0 : l.scor) + '%;background:' + l.nivel.culoare + '"></span></span>' +
        '<span class="v">' + (na ? (l.suspect ? 'verif.' : '–') : l.scor) + '</span></div>';
    }).join('') || '<p class="empty">Nicio linie în această categorie.</p>';
    Array.prototype.forEach.call($('rank').children, function (el) {
      if (el.dataset.k) el.addEventListener('click', function () { select(el.dataset.k, true); });
    });
  }

  function info() {
    var box = $('lineInfo'), l = sel && A.linii[sel];
    if (!l) { box.hidden = true; return; }
    var pl = l.planificat, P = l.parti, pct = function (x) { return x == null ? '–' : Math.round(x * 100) + '%'; };
    var strip = '';
    if (l.intervale.length) {
      var tot = l.intervale.reduce(function (a, b) { return a + b; }, 0);
      strip = '<div class="strip" title="Distanțele dintre vehiculele de pe traseu, în minute">' + l.intervale.map(function (g) {
        var c = g < Math.max(C.CFG.bunchMin, pl.interval * C.CFG.bunchFrac) ? '#b07cf0' : g > pl.interval * C.CFG.gapFrac ? '#d8433b' : '#2fa66a';
        return '<span style="width:' + (g / tot * 100) + '%;background:' + c + '"></span>';
      }).join('') + '</div><p class="note">Intervalele dintre vehiculele de pe traseu: ' + l.intervale.map(function (g) { return C.fmtMin(g); }).join(' · ') + ' (violet = pluton, roșu = gol).</p>';
    }
    box.innerHTML = '<h3><span class="badge" style="background:' + l.culoare + ';padding:1px 6px;border-radius:4px;color:#fff">' + esc(l.linie) + '</span>' +
      esc('→ ' + l.spre) + '<button type="button" class="close" aria-label="Închide">×</button></h3>' +
      (l.suspect ? '<p class="note">De verificat: sursa GPS atribuie liniei ' + l.linieVehicule + ' vehicule, iar orarul cere ' + l.liniePlanificat + '. Probabil vehicule ale altor linii raportate pe aceasta.</p>' : '') +
      '<table>' +
      '<tr><td>Scor</td><td><b style="color:' + l.nivel.culoare + '">' + (l.scor == null ? '–' : l.scor + ' · ' + l.nivel.nume) + '</b></td></tr>' +
      '<tr><td>Vehicule cu GPS / cerute: acest sens</td><td>' + l.vehicule + ' / ' + pl.vehicule + '</td></tr>' +
      '<tr><td>Vehicule cu GPS / cerute: toată linia</td><td>' + l.linieVehicule + ' / ' + l.liniePlanificat + ' (' + pct(P.serviciu) + ')</td></tr>' +
      '<tr><td>Viteza reală / din orar</td><td>' + fmt(l.viteza) + ' / ' + fmt(pl.viteza) + ' km/h (' + pct(P.viteza) + ')</td></tr>' +
      '<tr><td>Intervalul din orar</td><td>' + C.fmtMin(pl.interval) + '</td></tr>' +
      '<tr><td>Regularitate</td><td>' + pct(P.regularitate) + (l.cv != null ? ' (variație ' + fmt(l.cv * 100) + '%)' : '') + '</td></tr>' +
      '<tr><td>Plutoane · goluri · opriri</td><td>' + l.pluton + ' · ' + l.goluri + ' · ' + l.opriti + '</td></tr>' +
      '</table>' + strip;
    box.hidden = false;
    box.querySelector('.close').addEventListener('click', function () { select(null); });
  }

  function select(key, zoom) {
    sel = key && sel === key && !zoom ? null : key;
    if (sel && zoom && tr.shapes[sel]) map.fitBounds(L.latLngBounds(tr.shapes[sel].coords.map(function (c) { return [c[1], c[0]]; })), { padding: [30, 30] });
    redraw();
  }

  function redraw() {
    if (!A) return;
    legend(); hero(); alerts(); rank(); info(); drawLines(); drawVehicles(); drawAlerts();
  }

  // ---------- date ----------
  function getJSON(u) {
    return fetch(u, { cache: 'no-store' }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.eroare || u + ': ' + r.status); return d; });
    });
  }
  function update(d) {
    tr.add(d);
    A = C.analyze(tr);
    $('srcNote').innerHTML = 'Pozițiile: GPS CTP Iași prin Tranzy, actualizate la 30 de secunde (ultima: ' +
      clock(d.actualizat) + '). Orarul GTFS valabil ' + plan.valabil.de_la.replace(/(\d{4})(\d\d)(\d\d)/, '$3.$2.$1') +
      ' – ' + plan.valabil.pana_la.replace(/(\d{4})(\d\d)(\d\d)/, '$3.$2.$1') + '.';
    redraw();
  }
  function tick() {
    if (document.hidden) return;
    getJSON('/live/vehicule').then(update).catch(function (e) {
      if (!A) $('heroText').textContent = 'Pozițiile în timp real nu sunt disponibile acum: ' + e.message;
      else $('srcNote').textContent = 'Ultima actualizare a eșuat (' + e.message + '); se reîncearcă.';
    });
  }

  document.querySelectorAll('#modeSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      mode = b.dataset.v;
      document.querySelectorAll('#modeSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      redraw();
    });
  });
  document.querySelectorAll('#netSeg button').forEach(function (b) {
    b.addEventListener('click', function () {
      net = b.dataset.v;
      document.querySelectorAll('#netSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
      redraw();
    });
  });
  $('showVeh').addEventListener('change', redraw);
  var labelsOn = map.getZoom() >= LABEL_ZOOM;
  map.on('zoomend', function () {                       // etichete ↔ cercuri doar la trecerea pragului
    var on = map.getZoom() >= LABEL_ZOOM;
    if (on !== labelsOn) { labelsOn = on; drawVehicles(); }
  });
  $('onlyBad').addEventListener('change', redraw);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  getJSON('../../data/transport/sanatate_plan.json').then(function (p) {
    plan = p; tr = new C.Tracker(plan);
    // ultima jumătate de oră din arhivă (dacă există), ca vitezele și opririle să se vadă imediat
    return getJSON('/live/istoric?min=30').then(function (h) {
      (h.citiri || []).forEach(function (rec) { tr.add(C.unpack(rec)); });
    }).catch(function () { /* fără istoric: se adună din momentul deschiderii paginii */ });
  }).then(function () {
    tick();
    setInterval(tick, LIVE_MS);
  }).catch(function (e) {
    $('heroText').textContent = 'Nu am putut încărca orarul: ' + e.message;
  });
})();
