/* Metodologie PUZ: afișează parametrii și totalurile modelului de mobilitate din ../data/puz_mobilitate.json */
(function () {
  'use strict';
  var esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (v) { return typeof v === 'number' ? v.toLocaleString('ro-RO', { maximumFractionDigits: 3 }) : esc(Array.isArray(v) ? v.join(', ') : v); };
  var TITLES = { constructie: 'Construire', locuire: 'Locuire (RPL 2021)', mobilitate: 'Mobilitate', modal: 'Distribuție modală și autoturisme',
    varf_dimineata: 'Ora de vârf a dimineții', nerezidential: 'Activități nerezidențiale' };

  function rows(obj, prefix) {
    var out = [];
    Object.keys(obj).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      var v = obj[k], name = prefix ? prefix + ' · ' + k.replace(/_/g, ' ') : k.replace(/_/g, ' ');
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out = out.concat(rows(v, name));
        if (v._sursa) out.push('<tr><td colspan="2" class="note">' + esc(v._sursa) + '</td></tr>');
      } else out.push('<tr><td>' + esc(name) + '</td><td class="n">' + fmt(v) + '</td></tr>');
    });
    return out;
  }

  fetch('../data/puz_mobilitate.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (d) {
    var p = d.metadata.parametri, html = '';
    Object.keys(p).forEach(function (k) {
      if (k.charAt(0) === '_') return;
      html += '<h3>' + esc(TITLES[k] || k) + '</h3><table>' + rows(p[k], '').join('') +
        (p[k]._sursa ? '<tr><td colspan="2" class="note">' + esc(p[k]._sursa) + '</td></tr>' : '') + '</table>';
    });
    document.getElementById('params').innerHTML = html;
    var t = d.metadata.totaluri, L = [
      ['Apartamente', 'realist_apartamente', 'maxim_apartamente'], ['Locuitori noi', 'realist_locuitori', 'maxim_locuitori'],
      ['Deplasări produse/zi – PMUD', 'realist_PMUD_deplasari_zi', 'maxim_PMUD_deplasari_zi'],
      ['Deplasări produse/zi – RPL', 'realist_RPL_deplasari_zi', 'maxim_RPL_deplasari_zi'],
      ['Autoturisme/zi – PMUD', 'realist_PMUD_auto_zi', 'maxim_PMUD_auto_zi'], ['Autoturisme/zi – RPL', 'realist_RPL_auto_zi', 'maxim_RPL_auto_zi'],
      ['Autoturisme în ora de vârf – PMUD', 'realist_PMUD_auto_varf', 'maxim_PMUD_auto_varf'],
      ['Autoturisme în ora de vârf – RPL', 'realist_RPL_auto_varf', 'maxim_RPL_auto_varf'],
      ['Deplasări atrase/zi (separat)', 'realist_atractie_deplasari_zi', 'maxim_atractie_deplasari_zi']];
    document.getElementById('totals').innerHTML = '<table><tr><th></th><th class="n">realist</th><th class="n">maxim</th></tr>' +
      L.map(function (r) { return '<tr><td>' + r[0] + '</td><td class="n">' + fmt(t[r[1]]) + '</td><td class="n">' + fmt(t[r[2]]) + '</td></tr>'; }).join('') +
      '</table><p class="note">' + fmt(d.metadata.puz_modelate) + ' PUZ-uri aprobate (inclusiv modificări) modelate.</p>';
  }).catch(function (e) {
    document.getElementById('params').textContent = 'Parametrii nu s-au putut încărca (' + e.message + ').';
    document.getElementById('totals').textContent = '';
  });
})();
