/* Metodologia rețelei urbane: tabelul indicatorilor (praguri, surse, anii folosiți) din ../data/urban/urban_351.json. */
(function () {
  'use strict';
  var esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v) { return typeof v === 'number' ? v.toLocaleString('ro-RO') : v; };
  fetch('../data/urban/urban_351.json').then(function (r) { return r.json(); }).then(function (D) {
    var h = '<tr><th>Nr.</th><th>Indicator</th><th>Municipiu</th><th>Oraș</th><th>Sursa (an)</th><th>UAT cu date</th></tr>';
    D.indicatori.forEach(function (i) {
      var n = 0, est = 0, ani = {};
      D.uat.forEach(function (u) {
        var v = i.id === 'i1' ? u.p21 : u.v[i.id];
        if (v !== undefined && v !== null) { n++; if (u.x && u.x[i.id]) est++; }
        if (u.an && u.an[i.id]) ani[u.an[i.id]] = 1;
      });
      var an = Object.keys(ani).join(', ');
      h += '<tr><td>' + i.nr + (i.baza ? '*' : '') + '</td><td>' + esc(i.nume) + '</td><td>' + esc(fmt(i.municipiu)) + '</td><td>' + esc(fmt(i.oras)) + '</td><td>' +
        esc(i.sursa) + (an ? ' (' + esc(an) + ')' : '') + '</td><td class="n">' + (n ? n.toLocaleString('ro-RO') : '<span class="tag na">fără date</span>') +
        (est ? ' <span class="tag est">estimat</span>' : '') + '</td></tr>';
    });
    document.getElementById('indTable').innerHTML = h;
    document.getElementById('stats').textContent = D.info || '';
  }).catch(function () { document.getElementById('indTable').innerHTML = '<tr><td>Tabelul nu s-a putut încărca.</td></tr>'; });
})();
