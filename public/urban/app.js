/* Rețeaua urbană a României prin filtrul Legii 351/2001 (anexa II, modificată prin Legea 100/2007).
 * Datele: ../data/urban/uat.geojson (limitele UAT, GISCO LAU 2024) și ../data/urban/urban_351.json (indicatorii pe UAT),
 * generate de scripts/urban_351.py. Evaluarea (pragurile pentru oraș și municipiu) se face aici, ca regula de calificare
 * să poată fi schimbată din pagină. */
(function () {
  'use strict';
  var GEO_URL = '../data/urban/uat.geojson';
  var DATA_URL = '../data/urban/urban_351.json';

  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (v, d) {
    return v === null || v === undefined || !isFinite(v) ? '–' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  };
  var esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fold = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  var TIP = { M: 'municipiu', O: 'oraș', C: 'comună' };
  var RANG = ['0 – capitala', 'I – municipiu de importanță națională', 'II – municipiu de importanță interjudețeană / județeană', 'III – oraș', 'IV – reședință de comună'];

  // ---------------------------------------------------------------- categoriile evaluării
  var STATUS = [
    ['M_ok', 'Municipiu – îndeplinește criteriile de municipiu', '#1d6b3a'],
    ['M_oras', 'Municipiu – doar criteriile de oraș', '#e8a13a'],
    ['M_no', 'Municipiu – sub criteriile de oraș', '#9e1b1b'],
    ['O_mun', 'Oraș – ar îndeplini și criteriile de municipiu', '#1f7a99'],
    ['O_ok', 'Oraș – îndeplinește criteriile de oraș', '#63b06e'],
    ['O_no', 'Oraș – nu îndeplinește criteriile de oraș', '#e3625b'],
    ['C_oras', 'Comună – ar îndeplini criteriile de oraș', '#2b4fc3'],
    ['C_aproape', 'Comună – aproape de criteriile de oraș', '#93aee6'],
    ['C', 'Comună', '#f1eee6']
  ];
  var ST = {}; STATUS.forEach(function (s) { ST[s[0]] = { label: s[1], color: s[2] }; });
  var hidden = {};   // categorii ascunse din legendă

  var RETEA = [
    ['M', 'Municipiu', '#7a3b8f'],
    ['O', 'Oraș', '#d98a2b'],
    ['C', 'Comună', '#f1eee6']
  ];
  var IND_CLASSES = [
    ['na', 'fără date', '#d9d6cf'],
    ['c0', 'sub 50% din prag', '#b3261e'],
    ['c1', '50–75% din prag', '#e8743b'],
    ['c2', '75–100% din prag', '#f2c14e'],
    ['c3', 'atinge pragul', '#2e8b57']
  ];

  var PUG = [
    ['vg', 'În vigoare, cu date spațiale (Ordinul 904/2023)', '#1d6b3a'],
    ['v', 'În vigoare', '#63b06e'],
    ['a', 'Necesită actualizare', '#e8a13a'],
    ['x', 'Anulat în instanță', '#9e1b1b'],
    ['n', 'Stadiu necunoscut', '#cfcabe']
  ];
  var PUG_ST = { v: 'în vigoare', a: 'necesită actualizare', x: 'anulat în instanță', n: 'stadiu necunoscut' };
  function pugKey(u) { var p = u.pug; if (!p) return 'n'; return p.st === 'v' && p.g ? 'vg' : p.st; }
  var D = null, IND = [], INDX = {}, UAT = {}, LIST = [], view = 'eval';

  // ---------------------------------------------------------------- harta
  var RO = [[43.6, 20.2], [48.3, 29.75]];
  var map = L.map('map', { maxZoom: 14, minZoom: 5.5, zoomSnap: 0.25 }).fitBounds(RO);
  var base = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 14, className: 'basemap',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">contribuitorii OpenStreetMap</a> · limite UAT © EuroGeographics'
  }).addTo(map);
  var tileErrors = 0;
  base.on('tileerror', function () { if (++tileErrors === 8) $('baseNote').textContent = 'Harta de fundal nu se încarcă; UAT-urile sunt afișate fără fundal.'; });
  var renderer = L.canvas({ padding: 0.3 });
  map.createPane('pts').style.zIndex = 450;
  var polyLayer = null, ptsLayer = L.layerGroup().addTo(map), labelLayer = L.layerGroup().addTo(map), hiLayer = L.layerGroup().addTo(map);

  // ---------------------------------------------------------------- evaluare
  function rule() {
    return { tol: +$('tol').value, baseReq: $('baseReq').checked, est: $('useEst').checked, pop: $('popSrc').value };
  }
  function value(u, id, r) {
    if (id === 'i1') return r.pop === 'popDom' && u.pd ? u.pd : u.p21;
    if (!r.est && u.x && u.x[id]) return null;
    var v = u.v[id];
    return v === undefined ? null : v;
  }
  // un indicator față de pragul categoriei: { v, met, ratio } sau null (fără date)
  function check(u, ind, cat, r) {
    var v = value(u, ind.id, r);
    if (v === null) return null;
    var th = ind[cat];
    if (typeof th === 'number') return { v: v, met: v >= th, ratio: Math.min(v / th, 1) };
    // indicatorii da/nu sunt codificați pe niveluri: 2 = nivelul de municipiu, 1 = nivelul de oraș, 0 = lipsă
    var need = ind.niveluri ? (cat === 'municipiu' ? 2 : 1) : 1;
    return { v: v, met: v >= need, ratio: Math.min(v / need, 1) };
  }
  // evaluarea unui UAT pentru o categorie (oras / municipiu)
  function evaluate(u, cat, r) {
    var res = { cat: cat, n: 0, met: 0, fails: [], baseFails: [], score: 0, popOk: false, rows: {} };
    IND.forEach(function (ind) {
      var c = check(u, ind, cat, r);
      res.rows[ind.id] = c;
      if (!c) return;
      res.n++; res.score += c.ratio;
      if (c.met) res.met++; else { res.fails.push(ind.nr); if (ind.baza) res.baseFails.push(ind.nr); }
      if (ind.id === 'i1') res.popOk = c.met;
    });
    res.score = res.n ? res.score / res.n * 100 : 0;
    res.ok = res.popOk && res.fails.length <= r.tol && (!r.baseReq || !res.baseFails.length);
    return res;
  }
  function classify(u, r) {
    var eo = evaluate(u, 'oras', r), em = evaluate(u, 'municipiu', r), st;
    if (u.t === 'M') st = em.ok ? 'M_ok' : eo.ok ? 'M_oras' : 'M_no';
    else if (u.t === 'O') st = em.ok ? 'O_mun' : eo.ok ? 'O_ok' : 'O_no';
    else {
      // „aproape”: cel puțin 80% din pragul de populație și cel mult două neîndepliniri peste toleranță
      var p = value(u, 'i1', r);
      st = eo.ok ? 'C_oras' : (p >= 0.8 * INDX.i1.oras && eo.fails.length <= r.tol + 2) ? 'C_aproape' : 'C';
    }
    u.ev = { oras: eo, municipiu: em, st: st };
  }

  // ---------------------------------------------------------------- stil
  function indClass(u) {
    var ind = INDX[$('indSel').value], c = check(u, ind, $('indPrag').value, rule());
    if (!c) return 'na';
    return c.met ? 'c3' : c.ratio >= 0.75 ? 'c2' : c.ratio >= 0.5 ? 'c1' : 'c0';
  }
  function colorOf(u) {
    if (view === 'eval') return ST[u.ev.st].color;
    if (view === 'retea') return u.t === 'M' ? '#d9c3e3' : u.t === 'O' ? '#f5d8b0' : '#f6f3ec';
    if (view === 'pug') { var pk = pugKey(u); for (var q = 0; q < PUG.length; q++) if (PUG[q][0] === pk) return PUG[q][2]; }
    var k = indClass(u);
    for (var i = 0; i < IND_CLASSES.length; i++) if (IND_CLASSES[i][0] === k) return IND_CLASSES[i][2];
    return '#ccc';
  }
  function keyOf(u) { return view === 'eval' ? u.ev.st : view === 'retea' ? u.t : view === 'pug' ? pugKey(u) : indClass(u); }
  function isGap(u) { return $('gapShow').checked && u.t === 'C' && u.du >= +$('gapKm').value; }
  function inSel(u) {
    var j = $('judSel').value, t = $('tipSel').value;
    return (!j || u.j === j) && (!t || u.t === t);
  }
  function style(f) {
    var u = UAT[f.properties.s];
    if (!u) return { stroke: false, fillOpacity: 0 };
    var vis = inSel(u) && !hidden[view + ':' + keyOf(u)];
    var urban = u.t !== 'C';
    if (isGap(u) && vis) return { renderer: renderer, color: '#15171a', weight: 1.6, opacity: 0.9, dashArray: '3,2', fillColor: colorOf(u), fillOpacity: view === 'retea' ? 0.7 : 0.85 };
    return {
      renderer: renderer, color: urban ? '#444' : '#9a968c', weight: urban ? 0.8 : 0.25, opacity: vis ? 0.9 : 0.15,
      fillColor: colorOf(u), fillOpacity: vis ? (view === 'retea' ? 0.7 : 0.85) : 0.08
    };
  }
  function restyle() {
    if (polyLayer) polyLayer.setStyle(style);
    drawPoints();
    legend(); summary(); table();
  }

  // ---------------------------------------------------------------- simbolurile localităților (rețeaua)
  function rankStyle(u) {
    if (u.r === 0) return { radius: 9, fillColor: '#15171a', color: '#fff', weight: 2 };
    if (u.r === 1) return { radius: 7, fillColor: '#5a1f73', color: '#fff', weight: 1.5 };
    if (u.r === 2) return { radius: u.rj ? 6 : 4.5, fillColor: '#8e44ad', color: '#fff', weight: 1.2 };
    if (u.r === 3) return { radius: 3.5, fillColor: '#d98a2b', color: '#fff', weight: 1 };
    return { radius: 1.6, fillColor: '#6b6b6b', color: '#6b6b6b', weight: 0 };
  }
  function drawPoints() {
    ptsLayer.clearLayers(); labelLayer.clearLayers();
    var z = map.getZoom();
    LIST.forEach(function (u) {
      if (!u.xy || !inSel(u)) return;
      var showPt = view === 'retea' ? (u.t !== 'C' || z >= 7.5) : u.t !== 'C';
      if (view !== 'retea' && hidden[view + ':' + keyOf(u)]) return;
      if (showPt) {
        var s = rankStyle(u);
        if (view !== 'retea' && u.t !== 'C') s = { radius: u.r <= 1 ? 5 : u.t === 'M' ? 3.5 : 2.5, fillColor: '#fff', color: '#15171a', weight: 1 };
        var m = L.circleMarker([u.xy[1], u.xy[0]], Object.assign({ pane: 'pts', renderer: renderer, fillOpacity: 1, interactive: false }, s));
        ptsLayer.addLayer(m);
      }
      var lab = u.r <= 1 ? 6.5 : u.rj ? 7.5 : u.t === 'M' ? 8.5 : u.t === 'O' ? 9 : 10.5;
      if (z >= lab) {
        labelLayer.addLayer(L.tooltip({ permanent: true, direction: 'right', offset: [4, 0], className: 'loc-label', interactive: false })
          .setLatLng([u.xy[1], u.xy[0]]).setContent(esc(u.t === 'C' ? u.loc || u.n : u.n)));
      }
    });
  }
  map.on('zoomend', drawPoints);

  // ---------------------------------------------------------------- legenda și sumarul
  function counts() {
    var c = {};
    LIST.forEach(function (u) { if (inSel(u)) { var k = keyOf(u); c[k] = (c[k] || 0) + 1; } });
    return c;
  }
  function legend() {
    var items = view === 'eval' ? STATUS : view === 'retea' ? RETEA : view === 'pug' ? PUG : IND_CLASSES, c = counts(), h = '';
    if (view === 'ind') {
      var ind = INDX[$('indSel').value], cat = $('indPrag').value;
      h += '<div class="note">Pragul pentru ' + (cat === 'oras' ? 'oraș' : 'municipiu') + ': <b>' + esc(prag(ind, cat)) + '</b>' + (ind.sursa ? ' · ' + esc(ind.sursa) : '') + '</div>';
    }
    items.forEach(function (it) {
      h += '<div class="it' + (hidden[view + ':' + it[0]] ? ' off' : '') + '" data-k="' + it[0] + '"><span class="sw" style="background:' + it[2] + '"></span>' + esc(it[1]) + '<span class="n">' + fmt(c[it[0]] || 0) + '</span></div>';
    });
    if (view === 'pug') {
      h += '<div class="note" style="margin-top:6px">Planurile urbanistice generale din registrul MDLPA „Date Locale” (stadiul legal declarat în registru). Datele spațiale conforme cu Ordinul MDLPA nr. 904/2023 (zonificarea funcțională, intravilanul, reglementările) permit, în timp, calculul direct al unor indicatori ai Legii 351/2001 (spații verzi, străzi, echipare edilitară).</div>';
    }
    if (view === 'retea') {
      h += '<div class="note" style="margin-top:6px">Puncte (rangul din Legea 351/2001): ● negru – capitala (rang 0), ● violet închis – municipii de rang I, ● violet – municipii de rang II (mai mari: reședințele de județ), ● portocaliu – orașe (rang III), · gri – reședințe de comună (rang IV, de la zoom 7,5). Satele componente (rang V) apar în fișa fiecărui UAT.</div>';
    }
    $('legend').innerHTML = h;
  }
  $('legend').addEventListener('click', function (e) {
    var it = e.target.closest('.it'); if (!it) return;
    var k = view + ':' + it.getAttribute('data-k');
    hidden[k] = !hidden[k];
    restyle();
  });
  function summary() {
    var c = {}, sel = LIST.filter(inSel);
    sel.forEach(function (u) { c[u.ev.st] = (c[u.ev.st] || 0) + 1; });
    var nM = sel.filter(function (u) { return u.t === 'M'; }).length, nO = sel.filter(function (u) { return u.t === 'O'; }).length;
    var cards = [
      [fmt((c.M_ok || 0)) + ' / ' + fmt(nM), 'municipii care îndeplinesc criteriile de municipiu'],
      [fmt((c.O_ok || 0) + (c.O_mun || 0)) + ' / ' + fmt(nO), 'orașe care îndeplinesc criteriile de oraș'],
      [fmt(c.O_mun || 0), 'orașe care ar putea deveni municipii'],
      [fmt(c.C_oras || 0), 'comune care ar putea deveni orașe (' + fmt(c.C_aproape || 0) + ' aproape)']
    ];
    $('summary').innerHTML = cards.map(function (k) { return '<div><b>' + k[0] + '</b><small>' + esc(k[1]) + '</small></div>'; }).join('');
    var r = rule();
    var km = +$('gapKm').value, gaps = sel.filter(function (u) { return u.t === 'C' && u.du >= km; });
    var gc = gaps.filter(function (u) { return u.ev.st === 'C_oras' || u.ev.st === 'C_aproape'; });
    $('gapNote').innerHTML = '<b>' + fmt(gaps.length) + '</b> comune (' + fmt(gaps.reduce(function (a, u) { return a + u.p21; }, 0)) + ' locuitori) sunt la cel puțin ' + km + ' km de un municipiu sau oraș; dintre ele, ' + fmt(gc.length) + ' ar îndeplini sau se apropie de criteriile de oraș' +
      (gc.length ? ': ' + gc.sort(function (a, b) { return b.p21 - a.p21; }).slice(0, 12).map(function (u) { return esc(u.n) + ' (' + esc(u.j) + ')'; }).join(', ') + (gc.length > 12 ? '…' : '') : '') + '.';
    $('ruleNote').textContent = 'Un UAT „îndeplinește” criteriile unei categorii dacă atinge pragul de populație' +
      (r.baseReq ? ', toți indicatorii de bază evaluabili (1–5)' : '') +
      (r.tol ? ' și are cel mult ' + r.tol + ' indicator' + (r.tol > 1 ? 'i' : '') + ' neîndeplinit' + (r.tol > 1 ? 'i' : '') : ' și toți ceilalți indicatori evaluabili') +
      '. Indicatorii fără date nu se iau în calcul (scorul = media gradului de atingere a pragurilor, plafonat la 100%, ca în Covăsnianu & Covăsnianu 2014).';
  }

  var PRAG_SCURT = {
    i8: { oras: 'liceu', municipiu: 'postliceal' },
    i9: { oras: 'bibl. + sport', municipiu: '+ spectacole' },
    i14: { oras: 'mecano-chimică', municipiu: 'biologică' },
    i17: { oras: 'da', municipiu: 'da' }
  };
  function prag(ind, cat, scurt) {
    var t = ind[cat];
    if (scurt && PRAG_SCURT[ind.id]) return PRAG_SCURT[ind.id][cat];
    return typeof t === 'number' ? fmt(t, t % 1 ? 1 : 0) + (ind.um && ind.um !== 'locuitori' && ind.um !== 'locuri' ? ' ' + ind.um : ind.um ? ' ' + ind.um : '') : t;
  }
  function showVal(ind, v) {
    if (v === null || v === undefined) return '<span class="na">fără date</span>';
    if (typeof ind.municipiu !== 'number') {
      if (ind.coduri) return esc(ind.coduri[v] || v);
      return v ? 'da' : 'nu';
    }
    var d = ind.um === '%' || ind.um === '‰' || ind.um === 'm²/locuitor' ? 1 : 0;
    return fmt(v, d) + (ind.um === '%' ? '%' : '');
  }

  // ---------------------------------------------------------------- fișa UAT
  function verdict(u) {
    var r = rule(), e = u.ev, lines = [];
    function line(cat, ev) {
      var name = cat === 'oras' ? 'oraș' : 'municipiu';
      return '<b>' + (ev.ok ? '✓' : '✗') + ' criteriile de ' + name + '</b>: ' + ev.met + ' din ' + ev.n + ' indicatori evaluabili îndepliniți, scor ' + fmt(ev.score, 0) + '%' +
        (ev.fails.length ? ' · neîndepliniți: ' + ev.fails.join(', ') : '');
    }
    lines.push(line('oras', e.oras));
    lines.push(line('municipiu', e.municipiu));
    return '<div class="verdict" style="border-color:' + ST[e.st].color + '"><b>' + esc(ST[e.st].label) + '</b><br>' + lines.join('<br>') + '</div>';
  }
  function popup(u) {
    var r = rule(), h = '<div class="pop"><h3>' + esc(u.n) + '</h3>';
    h += '<div class="meta">' + esc(TIP[u.t]) + ', județul ' + esc(u.j) + (u.rj ? ' · reședință de județ' : '') + ' · rang ' + esc(RANG[u.r]) +
      '<br>SIRUTA ' + u.s + (u.km2 ? ' · ' + fmt(u.km2, 1) + ' km²' : '') +
      (u.loc ? ' · ' + (u.t === 'C' ? 'reședința: ' : 'localitatea de reședință: ') + esc(u.loc) + ' (' + fmt(u.lp) + ' loc.)' : '') +
      (u.ns ? ' · ' + u.ns + ' localități componente' : '') +
      (u.nu ? '<br>Cel mai apropiat municipiu / oraș: ' + esc(u.nu) + ', ' + fmt(u.du, 0) + ' km în linie dreaptă' + (u.t === 'C' && u.du >= 25 ? ' – <b>zonă fără oraș pe 25 km</b>' : '') : '') + '</div>';
    h += verdict(u);
    if (u.pug) {
      var p = u.pug, yr = function (d) { return d ? d.slice(0, 4) : ''; };
      h += '<div class="meta">PUG: ' + esc(PUG_ST[p.st] || '') + (p.a ? ', aprobat ' + yr(p.a) : '') + (p.p ? ', prelungit ' + yr(p.p) : '') +
        (p.v ? ', valabil până în ' + yr(p.v) : '') + (p.g ? ', cu date spațiale' : '') +
        (p.u ? ' · <a href="https://datelocale.mdlpa.ro' + esc(p.u) + '" target="_blank" rel="noopener">fișa din registrul MDLPA</a>' : '') + '</div>';
    }
    h += '<table><thead><tr><th>Indicator (* = de bază)</th><th>valoare</th><th>prag oraș</th><th>prag mun.</th></tr></thead><tbody>';
    IND.forEach(function (ind) {
      var v = value(u, ind.id, r), co = u.ev.oras.rows[ind.id], cm = u.ev.municipiu.rows[ind.id];
      var est = u.x && u.x[ind.id];
      var mark = function (c) { return !c ? '<span class="na">–</span>' : c.met ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'; };
      h += '<tr title="' + esc((ind.sursa || '') + (u.an && u.an[ind.id] ? ' (' + u.an[ind.id] + ')' : '') + (est ? ' – estimare: ' + (ind.estimare || '') : '')) + '"><td>' + ind.nr + (ind.baza ? '*' : '') + '. ' + esc(ind.scurt || ind.nume) + '</td>' +
        '<td' + (est ? ' class="est"' : '') + '>' + showVal(ind, v) + (est && v !== null ? ' (est.)' : '') + '</td>' +
        '<td title="' + esc(prag(ind, 'oras')) + '">' + mark(co) + ' <span class="src">' + esc(prag(ind, 'oras', true)) + '</span></td><td title="' + esc(prag(ind, 'municipiu')) + '">' + mark(cm) + ' <span class="src">' + esc(prag(ind, 'municipiu', true)) + '</span></td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="src">Populația: ' + fmt(u.p21) + ' locuitori rezidenți (RPL 2021)' + (u.pd ? ', ' + fmt(u.pd) + ' după domiciliu (1 ian. ' + D.an_domiciliu + ')' : '') +
      '. Indicatorii marcați „est.” sunt estimați (vezi metodologia); treceți cu mouse-ul peste un rând pentru sursă și an.</div>';
    if (u.sate && u.sate.length) {
      h += '<details><summary class="src">Localitățile componente</summary><div class="src">' + u.sate.map(function (s) { return esc(s[0]) + ' ' + fmt(s[1]); }).join(' · ') + '</div></details>';
    }
    return h + '</div>';
  }

  // ---------------------------------------------------------------- tabelul
  var sortKey = 'score', sortDir = -1;
  function catFor(u) { return u.t === 'C' ? 'oras' : u.t === 'O' && u.ev.st === 'O_mun' ? 'municipiu' : u.t === 'M' ? 'municipiu' : 'oras'; }
  function tableRows() {
    var mode = $('tableMode').value;
    return LIST.filter(function (u) {
      if (!inSel(u) || hidden[view + ':' + keyOf(u)]) return false;
      if (mode === 'urban') return u.t !== 'C';
      if (mode === 'gap') return u.t === 'C' && u.du >= +$('gapKm').value;
      if (mode === 'cand') return u.ev.st === 'C_oras' || u.ev.st === 'C_aproape' || u.ev.st === 'O_mun';
      return true;
    });
  }
  function table() {
    var rows = tableRows();
    var get = {
      n: function (u) { return fold(u.n); }, j: function (u) { return fold(u.j); }, t: function (u) { return u.t; },
      p: function (u) { return value(u, 'i1', rule()); },
      ok: function (u) { var e = u.ev[catFor(u)]; return e.met - e.n / 100; },
      score: function (u) { return u.ev[catFor(u)].score; },
      d: function (u) { return u.du || 0; },
      st: function (u) { return STATUS.findIndex(function (s) { return s[0] === u.ev.st; }); }
    };
    rows.sort(function (a, b) { var x = get[sortKey](a), y = get[sortKey](b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    var head = [['n', 'UAT'], ['j', 'Județ'], ['p', 'Populație'], ['ok', 'Îndepl.'], ['score', 'Scor'], ['d', 'Oraș la']];
    var h = '<thead><tr>' + head.map(function (c) { return '<th data-k="' + c[0] + '">' + c[1] + (sortKey === c[0] ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.slice(0, 600).forEach(function (u) {
      var e = u.ev[catFor(u)];
      h += '<tr data-s="' + u.s + '" title="' + esc(ST[u.ev.st].label + ' · evaluat față de pragurile de ' + (catFor(u) === 'oras' ? 'oraș' : 'municipiu')) + '"><td><span class="sw" style="background:' + ST[u.ev.st].color + '"></span>' + esc(u.n) + '</td><td>' + esc(u.j) + '</td><td>' + fmt(value(u, 'i1', rule())) + '</td><td>' + e.met + '/' + e.n + '</td><td>' + fmt(e.score, 0) + '%</td></tr>';
    });
    h += '</tbody>';
    if (rows.length > 600) h += '<caption class="note">primele 600 din ' + fmt(rows.length) + '</caption>';
    $('tbl').innerHTML = h;
  }
  $('tbl').addEventListener('click', function (e) {
    var th = e.target.closest('th');
    if (th) { var k = th.getAttribute('data-k'); if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'n' || k === 'j' ? 1 : -1; } table(); return; }
    var tr = e.target.closest('tr[data-s]');
    if (tr) focusUat(UAT[tr.getAttribute('data-s')]);
  });

  var featIndex = {};
  function focusUat(u) {
    if (!u) return;
    var lyr = featIndex[u.s];
    hiLayer.clearLayers();
    if (lyr) {
      map.fitBounds(lyr.getBounds(), { maxZoom: u.t === 'C' ? 11 : 10, padding: [30, 30] });
      hiLayer.addLayer(L.geoJSON(lyr.feature, { style: { color: '#15171a', weight: 3, fill: false }, interactive: false }));
      L.popup({ maxWidth: 420 }).setLatLng(lyr.getBounds().getCenter()).setContent(popup(u)).openOn(map);
    }
  }

  // ---------------------------------------------------------------- CSV
  $('csv').addEventListener('click', function () {
    var r = rule();
    var cols = ['siruta', 'uat', 'judet', 'tip', 'rang', 'statut_evaluare'].concat(IND.map(function (i) { return 'ind' + i.nr; }))
      .concat(['oras_indeplinite', 'oras_evaluabili', 'oras_scor', 'municipiu_indeplinite', 'municipiu_evaluabili', 'municipiu_scor', 'cel_mai_apropiat_oras', 'distanta_km']);
    var lines = [cols.join(';')];
    LIST.filter(function (u) { return inSel(u) && !hidden[view + ':' + keyOf(u)]; }).forEach(function (u) {
      var row = [u.s, u.n, u.j, TIP[u.t], u.r, ST[u.ev.st].label].concat(IND.map(function (i) { var v = value(u, i.id, r); return v === null ? '' : String(v).replace('.', ','); }))
        .concat([u.ev.oras.met, u.ev.oras.n, u.ev.oras.score.toFixed(1).replace('.', ','), u.ev.municipiu.met, u.ev.municipiu.n, u.ev.municipiu.score.toFixed(1).replace('.', ','), u.nu || '', u.du === undefined ? '' : String(u.du).replace('.', ',')]);
      lines.push(row.map(function (c) { c = String(c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';'));
    });
    var blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'retea_urbana_legea_351.csv'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // ---------------------------------------------------------------- controale
  function reclassify() { var r = rule(); LIST.forEach(function (u) { classify(u, r); }); restyle(); }
  ['tol', 'baseReq', 'useEst', 'popSrc'].forEach(function (id) { $(id).addEventListener('change', reclassify); });
  ['judSel', 'tipSel', 'tableMode', 'indSel', 'indPrag', 'gapShow', 'gapKm'].forEach(function (id) { $(id).addEventListener('change', function () {
    if (id === 'judSel') zoomJud();
    restyle();
  }); });
  $('viewSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    view = b.getAttribute('data-v');
    [].forEach.call($('viewSeg').children, function (x) { x.classList.toggle('on', x === b); });
    $('indCtl').hidden = view !== 'ind';
    restyle();
  });
  function zoomJud() {
    var j = $('judSel').value, b = null;
    LIST.forEach(function (u) { if ((!j || u.j === j) && featIndex[u.s]) { var bb = featIndex[u.s].getBounds(); b = b ? b.extend(bb) : L.latLngBounds(bb.getSouthWest(), bb.getNorthEast()); } });
    if (b) map.fitBounds(b, { padding: [20, 20] });
  }
  $('q').addEventListener('change', function () {
    var q = fold($('q').value).trim(); if (!q) return;
    var hit = LIST.find(function (u) { return fold(u.n + ' (' + u.j + ')') === q; }) || LIST.find(function (u) { return fold(u.n) === q; }) ||
      LIST.find(function (u) { return fold(u.n).indexOf(q) === 0; }) || LIST.find(function (u) { return u.sate && u.sate.some(function (s) { return fold(s[0]) === q; }); });
    focusUat(hit);
  });

  // ---------------------------------------------------------------- încărcare
  Promise.all([fetch(GEO_URL).then(function (r) { return r.json(); }), fetch(DATA_URL).then(function (r) { return r.json(); })]).then(function (res) {
    var geo = res[0]; D = res[1];
    IND = D.indicatori; IND.forEach(function (i) { INDX[i.id] = i; });
    D.uat.forEach(function (u) { UAT[u.s] = u; });
    LIST = D.uat;
    var r = rule();
    LIST.forEach(function (u) { classify(u, r); });
    // selectoare
    var juds = Array.from(new Set(LIST.map(function (u) { return u.j; }))).sort(function (a, b) { return a.localeCompare(b, 'ro'); });
    $('judSel').innerHTML += juds.map(function (j) { return '<option>' + esc(j) + '</option>'; }).join('');
    $('indSel').innerHTML = IND.map(function (i) { return '<option value="' + i.id + '">' + i.nr + '. ' + esc(i.scurt || i.nume) + '</option>'; }).join('');
    $('qList').innerHTML = LIST.map(function (u) { return '<option value="' + esc(u.n + ' (' + u.j + ')') + '">'; }).join('');
    polyLayer = L.geoJSON(geo, {
      style: style,
      onEachFeature: function (f, l) {
        featIndex[f.properties.s] = l;
        l.on('click', function (e) { var u = UAT[f.properties.s]; if (u) L.popup({ maxWidth: 420 }).setLatLng(e.latlng).setContent(popup(u)).openOn(map); });
        l.on('mouseover', function () { var u = UAT[f.properties.s]; if (u) l.bindTooltip(esc(u.n) + ' · ' + esc(ST[u.ev.st].label), { sticky: true }).openTooltip(); });
      }
    }).addTo(map);
    $('dataInfo').innerHTML = esc(D.info || '');
    restyle();
  }).catch(function (e) {
    $('summary').innerHTML = '<p class="note">Datele nu s-au putut încărca (' + esc(e.message) + ').</p>';
  });
})();
