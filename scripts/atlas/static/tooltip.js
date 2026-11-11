(function () {
  var tip = document.getElementById('tip');
  var fmt = function (v) { return String(v).replace('.', ','); };
  function unitHtml(u) {
    var h = '<b>' + u.n + '</b>' + u.o + ' plecări · ' + u.d + ' sosiri';
    if (u.o >= 10) h += '<br>durată mediană la plecare: ' + fmt(u.med) + ' min';
    if (u.o > 0) h += '<br>cu mașina: ' + u.c + (u.c >= 10 ? ' drumuri · ' + fmt(u.occ) + ' persoane' : ' drumuri (sub 10)') + ' · cu transportul public: ' + u.tp;
    if (u.t === 0) h = '<b>' + u.n + '</b>nicio deplasare încă';
    else if (u.t < 10) h += '<br><i>sub 10 observații: doar semnalare</i>';
    return h;
  }
  function flowHtml(f) { return '<b>' + f.a + ' → ' + f.b + '</b>' + f.n + ' deplasări · ' + f.p + ' participanți<br>durată mediană ' + fmt(f.med) + ' min'; }
  function show(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    var x = e.clientX, y = e.clientY, w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x + 14)) + 'px';
    tip.style.top = Math.max(8, (y + h + 24 > window.innerHeight ? y - h - 14 : y + 16)) + 'px';
  }
  var current = null;
  function clear() { if (current) current.forEach(function (n) { n.classList.remove('hl'); }); current = null; tip.hidden = true; }
  function handle(e) {
    var t = e.target.closest('[data-u],[data-f],[data-t],[data-a],[data-r],[data-s]');
    if (!t) { clear(); return; }
    var html = null, sel = null;
    if (t.dataset.u && UNITS[t.dataset.u]) { html = unitHtml(UNITS[t.dataset.u]); sel = '[data-u="' + t.dataset.u + '"]'; }
    else if (t.dataset.s && SCN[t.dataset.s]) { var z = SCN[t.dataset.s]; html = '<b>' + z.n + '</b>până la SRU, la 07:30<br>azi: ' + fmt(z.t) + ' min (TomTom), ' + fmt(z.a) + ' (model)<br>ocolire Est + A8–SRU: ' + fmt(z.s1) + ' min<br>inele + radiale: ' + fmt(z.s2o) + '–' + fmt(z.s2) + ' min' + (z.s4 != null ? '<br>+ traseul de probă sud: ' + fmt(z.s4o) + '–' + fmt(z.s4) + ' min' : ''); sel = '[data-s="' + t.dataset.s + '"]'; }
    else if (t.dataset.r && REG[t.dataset.r]) { var g = REG[t.dataset.r]; html = '<b>' + g.n + '</b>Spitalul Regional: ' + fmt(g.r) + ' min la 07:30, ' + fmt(g.rn) + ' noaptea<br>Sf. Spiridon: ' + fmt(g.s) + ' min la 07:30' + (g.k != null ? '<br>' + fmt(g.k) + ' km prin oraș' : ''); sel = '[data-r="' + t.dataset.r + '"]'; }
    else if (t.dataset.a && ACC[t.dataset.a]) { var a = ACC[t.dataset.a]; html = '<b>' + a.n + '</b>Sf. Spiridon: ' + fmt(a.s) + ' min la 07:30, ' + fmt(a.sn) + ' noaptea<br>Sf. Maria (copii): ' + fmt(a.c) + ' min la 07:30, ' + fmt(a.cn) + ' noaptea'; sel = '[data-a="' + t.dataset.a + '"]'; }
    else if (t.dataset.t && TT[t.dataset.t]) { var q = TT[t.dataset.t]; html = q.a ? '<b>' + q.n + '</b>spre Centru, ' + fmt(q.km) + ' km<br>la 07:30: ' + fmt(q.a) + ' min<br>la 10:30: ' + fmt(q.b) + ' min<br>drum liber: ' + fmt(q.f) + ' min' : '<b>' + q.n + '</b>destinația hărții'; sel = '[data-t="' + t.dataset.t + '"]'; }
    else if (t.dataset.f && FLOWS[t.dataset.f]) { html = flowHtml(FLOWS[t.dataset.f]); sel = '[data-f="' + t.dataset.f + '"]'; }
    if (!html) { clear(); return; }
    var svg = t.closest('svg');
    if (current) current.forEach(function (n) { n.classList.remove('hl'); });
    current = Array.prototype.slice.call(svg.querySelectorAll('path' + sel));
    current.forEach(function (n) { n.classList.add('hl'); });
    show(e, html);
  }
  document.querySelectorAll('.map').forEach(function (m) {
    m.addEventListener('pointermove', handle);
    m.addEventListener('pointerdown', handle);
    m.addEventListener('pointerleave', clear);
  });
  window.addEventListener('scroll', function () { tip.hidden = true; }, { passive: true });
})();