/* Jocul „A8 până în 2030?” – interfața. Modelul e în core.js (A8Core). */
(function () {
  'use strict';
  var C = window.A8Core, $ = function (id) { return document.getElementById(id); };
  var CHEIE = 'a8-joc-v1', MAX_STAMPILE = 2, N_SIM = 400;
  var st = null, alese = [], estim = null, lotSel = null, refProgram = null;

  var RATING = ['BB+ · sub nivelul investițional', 'BBB− · perspectivă negativă', 'BBB− · perspectivă stabilă'];
  var STARE = { executie: 'în execuție', proiectare: 'în proiectare', neatribuit: 'neatribuit – contestații', suspendat: 'suspendat în instanță', neactivat: 'semnat, fără ordin de începere', deschis: 'deschis circulației', blocat: 'oprit – insolvență' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function f1(x) { return C.fmt(x); }
  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ','); }
  function pct(p) { if (p > 0 && p < 0.005) return '<1%'; if (p < 1 && p > 0.995) return '>99%'; return Math.round(p * 100) + '%'; }
  function salveaza() { try { localStorage.setItem(CHEIE, JSON.stringify(st)); } catch (e) { /* fără stocare */ } }
  function sterge() { try { localStorage.removeItem(CHEIE); } catch (e) { /* fără stocare */ } }
  function incarca() { try { var s = localStorage.getItem(CHEIE); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function stareLot(l) { return l.blocat > 0 ? 'blocat' : l.stare; }

  /* ---------- Ecranul de start: trei strategii ---------- */
  function strategii() {
    var html = '', chei = ['inertie', 'program', 'totul'];
    chei.forEach(function (k) {
      var s = C.STRATEGII[k], r = C.estimeaza(C.stareStrategie(k, 1), 1000, 2027);
      if (k === 'program') refProgram = r;
      html += '<div class="strat"><div class="strathead"><b>' + esc(s.nume) + '</b><span class="big">' + pct(r.complet) + '</span></div>' +
        '<p class="note">' + esc(s.descriere) + '</p>' +
        bara('A8 completă (302 km)', r.complet) + bara('Est: Târgu Neamț – Ungheni', r.est) + bara('Iași – Ungheni', r.iasiUngheni) +
        '<p class="small">În medie <b>' + Math.round(r.kmMediu) + ' km</b> deschiși (între ' + Math.round(r.kmP10) + ' și ' + Math.round(r.kmP90) + ' în 80% din cazuri) · deficit sub 3% în 2030: ' + pct(r.subTrei) + '</p></div>';
    });
    $('strategii').innerHTML = html;
  }

  function bara(eticheta, p) {
    return '<div class="bar"><span>' + esc(eticheta) + '</span><span class="track"><i style="width:' + Math.max(p * 100, p > 0 ? 1.5 : 0).toFixed(1) + '%"></i></span><b>' + pct(p) + '</b></div>';
  }

  /* ---------- Harta schematică ---------- */
  var W = 1000, H = 430;
  function proiect(lon, lat) { return [(lon - 24.45) * 0.683 * 418 + 20, (47.42 - lat) * 418 + 30]; }
  function harta() {
    var pts = C.NODURI.map(function (n) { return proiect(n[1], n[2]); }), s = '';
    s += '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Traseul A8, pe loturi">';
    // Carpații și Prutul, ca repere
    var m1 = proiect(25.35, 46.95), m2 = proiect(25.95, 47.35);
    s += '<path class="munte" d="M' + proiect(25.2, 46.6) + ' Q' + m1 + ' ' + proiect(25.75, 46.95) + ' T' + m2 + '" />';
    s += '<text class="reper" x="' + proiect(25.62, 46.9)[0] + '" y="' + proiect(25.62, 46.9)[1] + '">Carpații Orientali</text>';
    var p1 = proiect(27.75, 47.45), p2 = proiect(27.75, 46.95);
    s += '<line class="prut" x1="' + p1[0] + '" y1="' + p1[1] + '" x2="' + p2[0] + '" y2="' + p2[1] + '" />';
    s += '<text class="reper" x="' + (p2[0] + 6) + '" y="' + (p2[1] - 4) + '">Prut</text>';
    st.loturi.forEach(function (l, i) {
      var a = pts[i], b = pts[i + 1], inf = C.LOTURI[i], stare = stareLot(l);
      var gata = l.deschis != null ? 1 : Math.max(0, Math.min(1, 1 - l.left / inf.ramas));
      if (l.stare === 'neatribuit' || l.stare === 'suspendat' || l.stare === 'neactivat') gata = 0;
      var d = 'M' + a[0].toFixed(1) + ',' + a[1].toFixed(1) + 'L' + b[0].toFixed(1) + ',' + b[1].toFixed(1);
      s += '<g class="lot s-' + stare + (lotSel === l.id ? ' sel' : '') + '" data-id="' + l.id + '" tabindex="0" role="button" aria-label="' + esc(inf.nume + ': ' + STARE[stare]) + '">' +
        '<title>' + esc(inf.nume + ' · ' + f1(inf.km) + ' km · ' + STARE[stare]) + '</title>' +
        '<path class="hit" d="' + d + '"/><path class="fond" d="' + d + '"/>' +
        (gata > 0 ? '<path class="gata" pathLength="1" stroke-dasharray="' + gata.toFixed(3) + ' 1" d="' + d + '"/>' : '') + '</g>';
    });
    C.NODURI.forEach(function (n, i) {
      var p = pts[i], sus = i % 2 === 0, mare = /Târgu Mureș|Iași|Ungheni|Târgu Neamț/.test(n[0]);
      s += '<circle class="nod' + (mare ? ' mare' : '') + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (mare ? 7 : 4.5) + '"/>';
      // eticheta: deasupra / dedesubt, alternativ; capetele și Sărățeni au poziții proprii ca să nu se suprapună
      var dx = 0, dy = sus ? -14 : 26, anc = '';
      if (i === 0) { dx = -10; anc = ' style="text-anchor:start"'; }
      if (i === C.NODURI.length - 1) { dx = 10; anc = ' style="text-anchor:end"'; }
      if (n[0] === 'Sărățeni') { dx = 10; dy = 6; anc = ' style="text-anchor:start"'; }
      s += '<text class="et' + (mare ? ' mare' : ' minor') + '"' + anc + ' x="' + (p[0] + dx).toFixed(1) + '" y="' + (p[1] + dy).toFixed(1) + '">' + esc(n[0]) + '</text>';
    });
    s += '</svg>';
    $('harta').innerHTML = s;
    Array.prototype.forEach.call(document.querySelectorAll('#harta .lot'), function (g) {
      g.addEventListener('click', function () { alegeLot(g.getAttribute('data-id')); });
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alegeLot(g.getAttribute('data-id')); } });
    });
    $('legend').innerHTML = ['deschis', 'executie', 'proiectare', 'neatribuit'].map(function (k) {
      return '<span class="lg s-' + k + '"><i></i>' + { deschis: 'deschis', executie: 'execuție', proiectare: 'proiectare', neatribuit: 'blocat' }[k] + '</span>';
    }).join('');
  }

  function alegeLot(id) {
    lotSel = lotSel === id ? null : id;
    harta();
    var box = $('lotInfo');
    if (!lotSel) { box.hidden = true; return; }
    var l = C.lot(st, id), inf = C.info(id), stare = stareLot(l);
    var p = estim && estim.lot[id] != null ? estim.lot[id] : null;
    box.hidden = false;
    box.innerHTML = '<b>' + esc(inf.nume) + '</b> · ' + f1(inf.km) + ' km · <span class="pill s-' + stare + '">' + STARE[stare] + '</span>' +
      '<p>' + esc(inf.info) + '</p>' +
      (inf.etapa ? '<p class="small">Segment prioritar: ' + esc(f1(inf.etapa.km) + ' km, ' + inf.etapa.nume) + (l.etapa != null ? ' – deschis în ' + C.eticheta(l.etapa) : '') + '.</p>' : '') +
      (inf.mva ? '<p class="small"><b>Estimarea MVA</b> (bilanț aug. 2026): ' + esc(inf.mva) + '</p>' : '') +
      '<p class="small">Constructor: ' + esc(inf.constructor) + ' · Valoare: ' + f2(inf.cost) + ' mld. lei' + (inf.est ? ' (est.)' : '') + ' · Bani: ' + (inf.sursa === 'SAFE' ? 'SAFE' : 'Programul Transport / BEI') + ' + buget</p>' +
      '<p class="small">' + (l.deschis != null ? 'Deschis în ' + C.SEMESTRE[l.deschis] + '.' : 'Rămas: ≈' + f1(Math.max(0, l.left)) + ' semestre de lucru la ritm contractual, ' + f2(l.cost) + ' mld. lei de plătit' + (p != null ? ' · șanse să fie gata până la final: <b>' + pct(p) + '</b>' : '') + '.') + '</p>';
  }

  function tabel() {
    var h = '<thead><tr><th>Lot</th><th>km</th><th>Stare</th><th>Rămas</th><th>Șanse 2030</th><th>Estimarea MVA (aug. 2026)</th></tr></thead><tbody>';
    st.loturi.forEach(function (l, i) {
      var inf = C.LOTURI[i], stare = stareLot(l);
      h += '<tr><td>' + esc(inf.nume) + '<small>' + esc(inf.sectiune) + ' · ' + (inf.sursa === 'SAFE' ? 'SAFE' : 'PT/BEI') + '</small></td><td class="num">' + f1(inf.km) + '</td>' +
        '<td><span class="pill s-' + stare + '">' + STARE[stare] + '</span></td>' +
        '<td class="num">' + (l.deschis != null ? C.SEMESTRE[l.deschis] : f1(Math.max(0, l.left)) + ' sem. · ' + f1(l.cost) + ' mld.') + '</td>' +
        '<td class="num">' + (l.deschis != null ? '✓' : estim ? pct(estim.lot[l.id]) : '–') + '</td><td class="mvacol">' + esc(inf.mva || '') + '</td></tr>';
    });
    $('loturi').innerHTML = h + '</tbody>';
  }

  /* ---------- Indicatori ---------- */
  function kpis() {
    var y = C.an(Math.min(st.sem, 7)), est = C.deficitAn(st, y), tinta = C.TINTA[y], km = C.rezultat(st).km;
    var safeRamas = Math.max(0, C.SAFE_COR * st.safeA8 - st.safeFolosit);
    var html = '';
    html += kpi('Deficit ' + y + ' (estimat)', f1(est) + '%', 'ținta ' + f1(tinta) + '%', est > tinta + 0.3 ? 'rau' : est > tinta ? 'atent' : 'bun');
    html += kpi('Datorie publică', f1(st.datorie) + '%', 'din PIB', st.datorie > 64 ? 'rau' : 'neutru');
    html += kpi('Rating', RATING[st.rating].split(' · ')[0], RATING[st.rating].split(' · ')[1], st.rating === 0 ? 'rau' : st.rating === 2 ? 'bun' : 'atent');
    html += kpi('Capital politic', Math.round(st.capital), st.capital < 25 ? 'risc de moțiune' : st.sem < 4 ? 'alegeri în dec. 2028' : 'coaliția rezistă', st.capital < 25 ? 'rau' : st.capital < 40 ? 'atent' : 'bun', st.capital);
    html += kpi('Km deschiși', f1(km), 'din ' + Math.round(C.KM_TOTAL), km > 0 ? 'bun' : 'neutru');
    html += kpi('Bani pentru A8', f1(safeRamas) + ' · ' + f1(st.pt + st.bei), 'mld. lei SAFE · PT+BEI rămași', 'neutru');
    $('kpis').innerHTML = html;
  }
  function kpi(t, v, sub, ton, bar) {
    return '<div class="kpi t-' + ton + '"><span class="kt">' + esc(t) + '</span><span class="kv">' + esc(v) + '</span><span class="ks">' + esc(sub) + '</span>' +
      (bar != null ? '<span class="kb"><i style="width:' + Math.max(0, Math.min(100, bar)) + '%"></i></span>' : '') + '</div>';
  }

  function sanse() {
    if (!estim) { $('sanse').innerHTML = '<p class="note">Se calculează…</p>'; return; }
    var r = estim;
    $('sanseNota').textContent = N_SIM + ' simulări, fără decizii noi';
    $('sanse').innerHTML = '<div class="hero"><span class="big">' + pct(r.complet) + '</span><span>A8 completă, Târgu Mureș – Ungheni, la 31.12.2030</span></div>' +
      bara('Est: Târgu Neamț – Ungheni', r.est) + bara('Târgu Neamț – Iași', r.tgNeamtIasi) + bara('Iași – Ungheni (Prut)', r.iasiUngheni) + bara('Deficit sub 3% în 2030', r.subTrei) +
      '<p class="small">Kilometri deschiși până la final: în medie <b>' + Math.round(r.kmMediu) + '</b> din ' + Math.round(C.KM_TOTAL) + ' (între ' + Math.round(r.kmP10) + ' și ' + Math.round(r.kmP90) + ' în 80% din simulări).</p>';
  }

  /* ---------- Decizii ---------- */
  function decizii() {
    var interimat = st.interimat > 0, mana = interimat ? [] : C.mana(st);
    alese = alese.filter(function (id) { return mana.some(function (c) { return c.id === id; }); });
    $('stamps').innerHTML = interimat ? 'guvern interimar' : 'Ștampile: ' + Array.from({ length: MAX_STAMPILE }, function (_, i) { return '<i class="' + (i < MAX_STAMPILE - alese.length ? 'on' : '') + '"></i>'; }).join('');
    if (interimat) $('mana').innerHTML = '<p class="note">Guvern interimar după moțiune: semestrul acesta nu poți lua decizii noi.</p>';
    else $('mana').innerHTML = mana.map(function (c) {
      var sel = alese.indexOf(c.id) >= 0, plin = !sel && alese.length >= MAX_STAMPILE;
      return '<button type="button" class="carte t-' + c.tip + (sel ? ' sel' : '') + '" data-id="' + c.id + '"' + (plin ? ' disabled' : '') + ' aria-pressed="' + sel + '">' +
        '<span class="ref">' + esc(c.ref) + '</span><b>' + esc(c.titlu) + '</b><span class="ef">' + esc(c.efect) + '</span>' + (sel ? '<span class="stampila">APROBAT</span>' : '') + '</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#mana .carte'), function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-id'), k = alese.indexOf(id);
        if (k >= 0) alese.splice(k, 1); else if (alese.length < MAX_STAMPILE) alese.push(id);
        decizii();
      });
    });
    var nat = $('national');
    nat.value = st.national; nat.disabled = interimat;
    $('prioritate').innerHTML = Object.keys(C.PRIORITATI).map(function (k) {
      var on = (st.prioritate || 'prorata') === k;
      return '<button type="button" data-k="' + k + '" class="' + (on ? 'on' : '') + '" aria-pressed="' + on + '"' + (interimat ? ' disabled' : '') + ' title="' + esc(C.PRIORITATI[k].descriere) + '">' + esc(C.PRIORITATI[k].nume) + '</button>';
    }).join('');
    $('prioritateNota').textContent = C.PRIORITATI[st.prioritate || 'prorata'].descriere;
    Array.prototype.forEach.call(document.querySelectorAll('#prioritate button'), function (b) {
      b.addEventListener('click', function () { st.prioritate = b.getAttribute('data-k'); salveaza(); decizii(); recalculeaza(); });
    });
    natText();
    var act = Object.keys(st.carti).map(function (id) { return C.CARTE[id] ? '<span class="chip">' + esc(C.CARTE[id].titlu) + '</span>' : ''; }).join('');
    var safe = '<span class="chip safe">SAFE pentru A8: ' + Math.round(st.safeA8 * 100) + '%</span>';
    $('active').innerHTML = '<span class="note">Active:</span> ' + safe + act;
    $('next').textContent = st.sem === C.SEMESTRE.length - 1 ? 'Încheie mandatul →' : 'Semestrul următor →';
  }

  function natText() {
    var v = +$('national').value, y = C.an(st.sem), tmp = C.clona(st);
    tmp.national = v;
    if (alese.indexOf('taieinvest') >= 0) tmp.carti.taieinvest = 1;
    var ef = C.nationalEfectiv(tmp), pp = (ef - C.BAZA_NATIONAL) * 2 / C.PIB[y] * 100;
    $('nationalVal').textContent = f2(v) + ' mld. lei / semestru';
    var t = 'Efect pe deficit, la nivel de an: ' + (pp >= 0 ? '+' : '−') + f2(Math.abs(pp)) + ' pp (doar banii cheltuiți efectiv).';
    if (ef < v) t += ' Efectiv: ' + f2(ef) + ' mld. lei' + (st.ajustare > 0 ? ' – investițiile sunt plafonate după avertismentul Comisiei.' : ' – după tăierea investițiilor.');
    if (st.carti.plata30 != null) t += ' Plata în 30 de zile poate adăuga încă până la 1,5 mld. lei.';
    $('nationalNota').textContent = t;
  }

  function stiri() {
    var lista = st.stiri.slice().reverse(), h = '', ultim = null;
    if (!lista.length) h = '<li class="note">Nicio știre încă. Ia primele decizii și treci la semestrul următor.</li>';
    lista.slice(0, 40).forEach(function (s) {
      if (s.sem !== ultim) { h += '<li class="semhead">' + C.SEMESTRE[s.sem] + '</li>'; ultim = s.sem; }
      h += '<li class="t-' + s.tip + '">' + esc(s.text) + '</li>';
    });
    $('stiri').innerHTML = h;
  }

  function randeaza() {
    $('semLabel').textContent = C.SEMESTRE[Math.min(st.sem, 7)];
    $('semNr').textContent = 'semestrul ' + (Math.min(st.sem, 7) + 1) + ' din 8';
    kpis(); harta(); tabel(); sanse(); decizii(); stiri();
    if (lotSel) { var s = lotSel; lotSel = null; alegeLot(s); }
  }

  function recalculeaza() {
    estim = null; sanse();
    setTimeout(function () { estim = C.estimeaza(st, N_SIM, st.seed); sanse(); tabel(); if (lotSel) { var s = lotSel; lotSel = null; alegeLot(s); } }, 30);
  }

  function urmatorul() {
    var rng = C.rngStare(st);
    st.national = +$('national').value;
    alese.forEach(function (id) { C.aplicaCarte(st, id, rng); });
    alese = [];
    C.pas(st, rng);
    salveaza();
    if (st.terminat) { final(); return; }
    randeaza(); recalculeaza();
    $('joc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Finalul ---------- */
  function final() {
    sterge();
    var r = C.rezultat(st), pr = C.profil(st);
    $('joc').hidden = true;
    var el = $('final');
    el.hidden = false;
    var verdict = r.complet ? 'A8 e gata. Pe hârtie era aproape imposibil.' :
      r.est ? 'Iașiul e legat de Prut și de Târgu Neamț. Munții mai așteaptă.' :
      r.km > 0 ? 'La 31 decembrie 2030, A8 nu e gata.' : 'La 31 decembrie 2030, A8 are tot 0 km.';
    var randuri = st.loturi.map(function (l, i) {
      var inf = C.LOTURI[i];
      return '<li class="' + (l.deschis != null ? 'ok' : 'nu') + '"><span>' + esc(inf.nume) + '</span><b>' + (l.deschis != null ? C.SEMESTRE[l.deschis] : 'neterminat') + '</b></li>';
    }).join('');
    var x = 60 + pr.x * 50, y = 60 - pr.y * 50;
    el.innerHTML = '<div class="card finalcard">' +
      '<p class="kicker">31 decembrie 2030 · bilanțul mandatului</p><h2 class="verdict">' + esc(verdict) + '</h2>' +
      '<div class="finalgrid"><div>' +
      '<div class="kpis">' + kpi('Km deschiși', f1(r.km), 'din ' + Math.round(C.KM_TOTAL) + ' km', r.complet ? 'bun' : 'atent') +
      kpi('Deficit 2030', r.deficit2030 != null ? f1(r.deficit2030) + '%' : '–', r.subTrei ? 'sub 3%: ieșim din procedură' : 'peste 3%: procedura continuă', r.subTrei ? 'bun' : 'rau') +
      kpi('Datorie', f1(r.datorie) + '%', 'din PIB', r.datorie > 64 ? 'rau' : 'neutru') +
      kpi('Rating', RATING[r.rating].split(' · ')[0], RATING[r.rating].split(' · ')[1], r.rating === 0 ? 'rau' : 'neutru') +
      kpi('Cheltuit pe A8', f1(st.cheltuitA8), 'mld. lei, 2027–2030', 'neutru') + '</div>' +
      '<ul class="bilant">' + randuri + '</ul></div>' +
      '<div class="profil"><h3>Profilul tău: ' + esc(pr.titlu) + '</h3>' +
      '<svg viewBox="0 0 120 120" class="busola" role="img" aria-label="Busola deciziilor"><rect x="10" y="10" width="100" height="100" rx="6"/><line x1="60" y1="10" x2="60" y2="110"/><line x1="10" y1="60" x2="110" y2="60"/>' +
      '<text x="12" y="57">investiții</text><text x="108" y="57" text-anchor="end">disciplină</text><text x="60" y="20" text-anchor="middle">reformă</text><text x="60" y="106" text-anchor="middle">continuitate</text>' +
      '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="6"/></svg>' +
      '<p class="small">Orizontal: cât ai strâns sau ai lărgit bugetul. Vertical: câte reforme administrative din program ai aplicat.</p>' +
      '<p>' + comparatie(r) + '</p>' +
      '<div class="btns"><button type="button" class="btn primary" id="iarasi">Joacă din nou</button> <button type="button" class="btn" id="copiaza">Copiază rezultatul</button> <a class="btn" href="#scenarii">Când ar fi gata, de fapt? →</a></div></div></div></div>';
    $('iarasi').addEventListener('click', function () { location.reload(); });
    $('copiaza').addEventListener('click', function () {
      var t = 'A8 până în 2030? Am deschis ' + f1(r.km) + ' din ' + Math.round(C.KM_TOTAL) + ' km, deficit 2030: ' + (r.deficit2030 != null ? f1(r.deficit2030) : '–') + '%. Profil: ' + pr.titlu + '. ' + location.href;
      try { navigator.clipboard.writeText(t).then(function () { $('copiaza').textContent = 'Copiat ✓'; }); } catch (e) { $('copiaza').textContent = 'Nu s-a putut copia'; }
    });
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function comparatie(r) {
    var km = refProgram ? Math.round(refProgram.kmMediu) : 170;
    var t = 'Cu programul aplicat integral din prima zi, simulările dau în medie circa ' + km + ' de km până la finalul lui 2030 și practic nicio șansă pentru autostrada completă. ';
    if (r.km >= 200) t += 'Ai făcut mai mult decât programul – rămâne de văzut cine plătește nota.';
    else if (r.km >= 140) t += 'Ai jucat cam cât programul.';
    else t += 'Ai rămas sub ce ar fi dat programul aplicat ca atare.';
    return esc(t) + ' Blocajul nu e doar banul: secțiunea montană a pornit proiectarea în 2025–2026, iar Târgu Frumos – Lețcani nu avea contract în octombrie 2026.';
  }

  /* ---------- Pornire ---------- */
  function porneste(stare) {
    st = stare || C.stareInitiala((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    alese = []; lotSel = null;
    $('intro').hidden = true; $('final').hidden = true; $('joc').hidden = false;
    $('national').oninput = natText;
    randeaza(); recalculeaza();
    $('joc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('start').addEventListener('click', function () { sterge(); porneste(); });
  $('next').addEventListener('click', urmatorul);
  var salvat = incarca();
  if (salvat && !salvat.terminat && salvat.sem > 0 && salvat.sem < C.SEMESTRE.length) {
    $('continua').hidden = false;
    $('continua').textContent = 'Continuă jocul salvat (' + C.SEMESTRE[salvat.sem] + ')';
    $('continua').addEventListener('click', function () { porneste(salvat); });
  }
  setTimeout(strategii, 20);
})();
