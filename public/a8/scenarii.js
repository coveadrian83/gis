/* „Când ar fi gata A8?” – scenariile până în 2040 (modelul din core.js). */
(function () {
  'use strict';
  var C = window.A8Core, $ = function (id) { return document.getElementById(id); };
  var N = 500, X0 = 2027, X1 = 2041.6, tinta = 'complet', rezultate = {}, tau = null;
  var alegere = { politic: 'alternanta', buget: 'program', procedural: 'actual', prioritate: 'prorata' };
  var DIM_NUME = { politic: 'Politica', buget: 'Bugetul', procedural: 'Procedurile', prioritate: 'Prioritizarea' };

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pct(p) { if (p === 0) return '≈0%'; if (p > 0 && p < 0.005) return '<1%'; if (p < 1 && p > 0.995) return '>99%'; return Math.round(p * 100) + '%'; }
  function poz(x) { return ((Math.min(isFinite(x) ? x : X1, X1 - 0.15) - X0) / (X1 - X0) * 100).toFixed(2) + '%'; }
  function cheie(p, b, r, o) { return p + '|' + b + '|' + r + '|' + (o || 'prorata'); }

  function calc(p, b, r, o) {
    var k = cheie(p, b, r, o);
    if (!rezultate[k]) rezultate[k] = C.calendar(p, b, r, N, 2027, o || 'prorata');
    return rezultate[k];
  }
  function subtitlu(s) {
    return C.DIMENSIUNI.politic[s.politic].nume + ' · ' + C.DIMENSIUNI.buget[s.buget].nume + ' · ' + C.DIMENSIUNI.procedural[s.procedural].nume +
      (s.prioritate && s.prioritate !== 'prorata' ? ' · ' + C.PRIORITATI[s.prioritate].nume : '');
  }

  function rand(nume, sub, st, clasa) {
    var t = (sub ? sub + ' · ' : '') + 'mediana ' + C.dataGata(st.p50) + ' · 10–90%: ' + C.dataGata(st.p10) + ' – ' + C.dataGata(st.p90);
    return '<div class="calrow ' + (clasa || '') + '" title="' + esc(nume + ': ' + t) + '">' +
      '<div class="callab"><b>' + esc(nume) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>' +
      '<div class="caltrack"><span class="calbar" style="left:' + poz(st.p10) + ';width:calc(' + poz(st.p90) + ' - ' + poz(st.p10) + ')"></span>' +
      '<span class="caldot" style="left:' + poz(st.p50) + '"></span>' +
      (st.p90 > 2038.5 ? '<span class="calval st" style="left:' + poz(st.p10) + '">' : '<span class="calval" style="left:' + poz(st.p90) + '">') + esc(C.dataGata(st.p50)) + '</span></div></div>';
  }

  function grafic() {
    var html = '<div class="calplot">';
    // axa anilor
    html += '<div class="calrow axa"><div class="callab"></div><div class="caltrack">';
    for (var y = 2027; y <= 2041; y++) {
      html += '<span class="grid" style="left:' + poz(y) + '"></span>';
      if (y % 2 === 1) html += '<span class="tick' + (y === 2041 ? ' ultim' : ((y - 2027) % 4 !== 0 || y === 2039) ? ' rar' : '') + '" style="left:' + poz(y === 2041 ? 2041.6 : y + 0.5) + '">' + (y === 2041 ? '>2040' : y) + '</span>';
    }
    html += '</div></div>';
    // reperele declarate
    html += '<div class="calrow repererow"><div class="callab"><small>Termene și estimări</small></div><div class="caltrack">';
    C.REPERE.forEach(function (r, i) {
      html += '<span class="replab r' + (i % 2) + '" style="left:' + poz((r.de + r.la) / 2) + '" title="' + esc(r.cine + ': ' + r.text) + '">' + esc(r.scurt) + '</span>';
    });
    html += '</div></div>';
    C.SCENARII.forEach(function (s) {
      var r = rezultate[cheie(s.politic, s.buget, s.procedural, s.prioritate)];
      if (!r) return;
      html += rand(s.nume, subtitlu(s), r[tinta], s.id === 'mva' ? 'mva' : '');
    });
    if (tau) html += rand('Scenariul tău', descriereTa(), tau[tinta], 'tau');
    // benzile/liniile reperelor peste toate rândurile
    html += '<div class="calmarks">';
    C.REPERE.forEach(function (r) {
      if (r.la > r.de) html += '<span class="band" style="left:' + poz(r.de) + ';width:calc(' + poz(r.la) + ' - ' + poz(r.de) + ')"></span>';
      else html += '<span class="mline" style="left:' + poz(r.de) + '"></span>';
    });
    html += '</div></div>';
    $('calChart').innerHTML = html;
  }

  function tabel() {
    var h = '<thead><tr><th>Scenariu</th><th>Mai devreme (10%)</th><th>Mediana</th><th>Mai târziu (90%)</th><th>Gata până în 2030</th><th>… 2032</th><th>… 2035</th></tr></thead><tbody>';
    var randuri = C.SCENARII.map(function (s) { return { nume: s.nume, r: rezultate[cheie(s.politic, s.buget, s.procedural, s.prioritate)] }; });
    if (tau) randuri.push({ nume: 'Scenariul tău', r: tau });
    randuri.forEach(function (o) {
      if (!o.r) return;
      var st = o.r[tinta];
      h += '<tr><td>' + esc(o.nume) + '</td><td>' + C.dataGata(st.p10) + '</td><td><b>' + C.dataGata(st.p50) + '</b></td><td>' + C.dataGata(st.p90) + '</td>' +
        '<td class="num">' + pct(st.pana2030) + '</td><td class="num">' + pct(st.pana2032) + '</td><td class="num">' + pct(st.pana2035) + '</td></tr>';
    });
    $('calTabel').innerHTML = h + '</tbody>';
  }

  function descriereTa() { return subtitlu(alegere); }

  function builder() {
    var h = '';
    Object.keys(DIM_NUME).forEach(function (d) {
      h += '<div class="dim"><div class="lbl">' + DIM_NUME[d] + '</div><div class="seg" role="group" aria-label="' + DIM_NUME[d] + '">';
      Object.keys(C.DIMENSIUNI[d]).forEach(function (k) {
        var o = C.DIMENSIUNI[d][k];
        h += '<button type="button" data-d="' + d + '" data-k="' + k + '" aria-pressed="' + (alegere[d] === k) + '" class="' + (alegere[d] === k ? 'on' : '') + '" title="' + esc(o.descriere) + '">' + esc(o.nume) + '</button>';
      });
      h += '</div><p class="note">' + esc(C.DIMENSIUNI[d][alegere[d]].descriere) + '</p></div>';
    });
    $('builder').innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll('#builder button'), function (b) {
      b.addEventListener('click', function () { alegere[b.getAttribute('data-d')] = b.getAttribute('data-k'); builder(); calculeazaTau(); });
    });
  }

  function calculeazaTau() {
    $('calTau').innerHTML = '<p class="note">Se calculează…</p>';
    setTimeout(function () {
      tau = calc(alegere.politic, alegere.buget, alegere.procedural, alegere.prioritate);
      var c = tau.complet, e = tau.est, iu = tau.iasiUngheni;
      $('calTau').innerHTML = '<div class="tauhero"><span class="big">' + esc(C.dataGata(c.p50)) + '</span><span>A8 completă, în mediana scenariului tău<br><small>10–90%: ' + esc(C.dataGata(c.p10)) + ' – ' + esc(C.dataGata(c.p90)) + ' · gata până în 2030: ' + pct(c.pana2030) + ' · până în 2032: ' + pct(c.pana2032) + '</small></span></div>' +
        '<p class="small">Târgu Neamț – Iași – Ungheni: <b>' + esc(C.dataGata(e.p50)) + '</b> (10–90%: ' + esc(C.dataGata(e.p10)) + ' – ' + esc(C.dataGata(e.p90)) + ') · Iași – Ungheni: <b>' + esc(C.dataGata(iu.p50)) + '</b> · Târgu Neamț – Târgu Mureș: <b>' + esc(C.dataGata(tau.vest.p50)) + '</b></p>';
      grafic(); tabel();
    }, 20);
  }

  function seg() {
    $('tintaSeg').innerHTML = Object.keys(C.TINTE_CAL).filter(function (k) { return !C.TINTE_CAL[k].ascuns; }).map(function (k) {
      return '<button type="button" data-k="' + k + '" class="' + (k === tinta ? 'on' : '') + '" aria-pressed="' + (k === tinta) + '">' + esc(C.TINTE_CAL[k].nume) + '</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#tintaSeg button'), function (b) {
      b.addEventListener('click', function () { tinta = b.getAttribute('data-k'); seg(); grafic(); tabel(); });
    });
  }

  function repere() {
    $('repere').innerHTML = C.REPERE.map(function (r) {
      return '<li><b>' + esc(r.cine) + '</b>: ' + esc(r.text) + (r.url ? ' (<a href="' + esc(r.url) + '" rel="noopener">sursa</a>)' : '') + '</li>';
    }).join('');
  }

  /* MVAmarket: contracte în stilul piețelor de predicții; prețul DA = probabilitatea din model. */
  var PIETE = [
    ['A8 completă până la 31.12.2030?', 'complet', 'pana2030'],
    ['Târgu Neamț – Iași – Ungheni gata până la 31.12.2030?', 'est', 'pana2030'],
    ['Iași – Ungheni (Prut) gata până la 31.12.2030?', 'iasiUngheni', 'pana2030'],
    ['A8 completă până la 31.12.2032?', 'complet', 'pana2032'],
    ['Târgu Neamț – Târgu Mureș gata până la 31.12.2032?', 'vest', 'pana2032'],
    ['A8 completă până la 31.12.2035?', 'complet', 'pana2035']
  ];
  function cent(p) { var c = Math.round(p * 100); if (p === 0) return '≈0¢'; return p > 0 && c < 1 ? '<1¢' : c > 99 && p < 1 ? '>99¢' : c + '¢'; }
  function piete() {
    var el = $('piete'); if (!el) return;
    var real = C.SCENARII.filter(function (x) { return x.id === 'realist'; })[0], mva = C.SCENARII.filter(function (x) { return x.id === 'mva'; })[0];
    var rr = rezultate[cheie(real.politic, real.buget, real.procedural, real.prioritate)], rm = rezultate[cheie(mva.politic, mva.buget, mva.procedural, mva.prioritate)];
    if (!rr || !rm) return;
    el.innerHTML = PIETE.map(function (q) {
      var p = rr[q[1]][q[2]], pm = rm[q[1]][q[2]];
      return '<div class="piata"><span class="intr">' + esc(q[0]) + '</span>' +
        '<div class="pret"><span class="da">DA <b>' + cent(p) + '</b></span><span class="nu">NU <b>' + cent(1 - p) + '</b></span></div>' +
        '<span class="bara"><i style="width:' + Math.max(p * 100, p > 0 ? 1.5 : 0).toFixed(1) + '%"></i></span>' +
        '<span class="cumva">Cu agenda MVA: DA <b>' + cent(pm) + '</b></span></div>';
    }).join('');
  }

  /* Contribuția fiecărei pârghii: de la „Realist” schimbăm câte una; de la agenda MVA scoatem câte una. */
  var NUME_PARGHIE = { politic: 'politica', buget: 'bugetul', procedural: 'procedurile', prioritate: 'prioritizarea' };
  function descompunere() {
    var el = $('descompunere'); if (!el) return;
    var real = C.SCENARII.filter(function (x) { return x.id === 'realist'; })[0], mva = C.SCENARII.filter(function (x) { return x.id === 'mva'; })[0];
    var baza = { politic: real.politic, buget: real.buget, procedural: real.procedural, prioritate: real.prioritate || 'prorata' };
    var tinta = { politic: mva.politic, buget: mva.buget, procedural: mva.procedural, prioritate: mva.prioritate || 'prorata' };
    var randuri = [['Realist', baza, 'baza']];
    Object.keys(NUME_PARGHIE).forEach(function (k) { var o = Object.assign({}, baza); o[k] = tinta[k]; randuri.push(['Realist + ' + NUME_PARGHIE[k] + ' MVA', o, '']); });
    Object.keys(NUME_PARGHIE).forEach(function (k) { var o = Object.assign({}, tinta); o[k] = baza[k]; randuri.push(['Agenda MVA fără ' + NUME_PARGHIE[k], o, '']); });
    randuri.push(['Agenda MVA', tinta, 'mva']);
    var strict = Object.assign({}, tinta, { buget: 'mva850' });
    randuri.push(['Agenda MVA cu plafon de 850 mil. €/an', strict, '']);
    var i = 0, h = '<thead><tr><th>Varianta</th><th>A8 completă (mediana)</th><th>Gata până în 2032</th><th>… 2035</th></tr></thead><tbody>';
    (function urm() {
      if (i < randuri.length) {
        var r = randuri[i++], o = r[1], c = calc(o.politic, o.buget, o.procedural, o.prioritate).complet;
        h += '<tr class="' + r[2] + '"><td>' + esc(r[0]) + '</td><td><b>' + esc(C.dataGata(c.p50)) + '</b></td><td class="num">' + pct(c.pana2032) + '</td><td class="num">' + pct(c.pana2035) + '</td></tr>';
        el.innerHTML = h + '</tbody>';
        setTimeout(urm, 10);
      } else cheltuieli(tinta);
    })();
  }
  // Cât cheltuie, în medie, agenda MVA pe an (toate sursele)
  function cheltuieli(o) {
    var n = 120, tot = {};
    for (var i = 0; i < n; i++) {
      var s = C.stareCalendar(o.politic, o.buget, o.procedural, (2027 + i * 104729) >>> 0, o.prioritate), r = C.rngStare(s);
      while (s.sem < s.orizont) { C.pas(s, r); s.stiri.length = 0; }
      Object.keys(s.registru).forEach(function (y) { var g = s.registru[y]; tot[y] = (tot[y] || 0) + (g.safe + g.cef + g.pt + g.bei + g.mff + g.nat) / n; });
    }
    var ani = ['2028', '2029', '2030'].map(function (y) { return (tot[y] || 0) / C.EUR_LEI; });
    var max = Math.max.apply(null, ani), min = Math.min.apply(null, ani);
    $('cheltuieliMva').textContent = 'Agenda MVA cheltuie în medie între ' + min.toFixed(1).replace('.', ',') + ' și ' + max.toFixed(1).replace('.', ',') + ' mld. euro pe an în 2028–2030, din toate sursele (' + n + ' simulări). Cu plafonul de ≈850 mil. euro pe an, aceleași măsuri împing finalizarea cu câțiva ani.';
  }

  // Scenariile se calculează pe rând, ca pagina să rămână fluidă
  function porneste() {
    seg(); repere(); builder();
    var i = 0;
    (function urm() {
      if (i < C.SCENARII.length) { var s = C.SCENARII[i++]; calc(s.politic, s.buget, s.procedural, s.prioritate); grafic(); setTimeout(urm, 10); }
      else { tabel(); calculeazaTau(); piete(); setTimeout(descompunere, 30); }
    })();
  }
  setTimeout(porneste, 200);
})();
