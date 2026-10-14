/* Panou: import de deplasări din alte surse (Excel / CSV / tabel lipit din Excel) */
(function () {
  'use strict';

  var A = window.MobAdmin;
  if (!A) return;
  var esc = A.esc;
  function $(id) { return document.getElementById(id); }
  var st = { rows: null, cols: null, places: [], coords: {}, payload: null, checked: false };

  // ---------------------------------------------------------------------------
  // Citirea fișierelor: .xlsx (arhivă zip, despachetată cu DecompressionStream) și CSV / text
  // ---------------------------------------------------------------------------
  function unzip(buf) {
    var dv = new DataView(buf), eocd = -1;
    for (var i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Fișierul nu pare a fi un Excel (.xlsx).');
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true), files = {};
    for (var k = 0; k < n; k++) {
      var nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      var name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
      files[name] = { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
      p += 46 + nlen + elen + clen;
    }
    return function read(name) {
      var f = files[name];
      if (!f) return Promise.resolve(null);
      var start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true);
      var data = new Uint8Array(buf, start, f.size);
      if (f.method === 0) return Promise.resolve(new TextDecoder().decode(data));
      if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Browserul nu poate citi .xlsx; salvați fișierul ca CSV sau lipiți tabelul.'));
      return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    };
  }

  function xml(text) { return new DOMParser().parseFromString(text, 'application/xml'); }
  function tags(node, name) { return Array.prototype.slice.call(node.getElementsByTagNameNS('*', name)); }
  function colIndex(ref) { var m = /^([A-Z]+)/.exec(ref), n = 0; for (var i = 0; i < m[1].length; i++) n = n * 26 + m[1].charCodeAt(i) - 64; return n - 1; }

  function readXlsx(buf) {
    var read = unzip(buf);
    return Promise.all([read('xl/workbook.xml'), read('xl/_rels/workbook.xml.rels'), read('xl/sharedStrings.xml')]).then(function (r) {
      if (!r[0]) throw new Error('Fișierul nu pare a fi un Excel (.xlsx).');
      var rels = {};
      tags(xml(r[1] || '<x/>'), 'Relationship').forEach(function (x) { rels[x.getAttribute('Id')] = x.getAttribute('Target'); });
      var shared = r[2] ? tags(xml(r[2]), 'si').map(function (si) { return tags(si, 't').map(function (t) { return t.textContent; }).join(''); }) : [];
      var sheets = tags(xml(r[0]), 'sheet').map(function (s) {
        var rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        var target = (rels[rid] || '').replace(/^\/?xl\//, '').replace(/^\//, '');
        return { name: s.getAttribute('name'), path: 'xl/' + target };
      });
      return Promise.all(sheets.map(function (s) { return read(s.path); })).then(function (texts) {
        return sheets.map(function (s, i) {
          var grid = [];
          if (texts[i]) tags(xml(texts[i]), 'c').forEach(function (c) {
            var ref = c.getAttribute('r'); if (!ref) return;
            var row = parseInt(ref.replace(/^[A-Z]+/, ''), 10) - 1, col = colIndex(ref), t = c.getAttribute('t');
            var v = tags(c, 'v')[0], val = null;
            if (t === 's') val = v ? shared[parseInt(v.textContent, 10)] : null;
            else if (t === 'inlineStr') val = tags(c, 't').map(function (x) { return x.textContent; }).join('');
            else if (v) val = t === 'str' || t === 'b' ? v.textContent : (isNaN(+v.textContent) ? v.textContent : +v.textContent);
            (grid[row] = grid[row] || [])[col] = val;
          });
          return { name: s.name, rows: grid.filter(Boolean).map(function (r) { return Array.from(r, function (x) { return x === undefined ? null : x; }); }) };
        });
      });
    });
  }

  function readDelimited(text) {
    var lines = text.replace(/\r/g, '').split('\n').filter(function (l) { return l.trim(); });
    if (!lines.length) return [];
    var d = lines[0].indexOf('\t') >= 0 ? '\t' : (lines[0].split(';').length >= lines[0].split(',').length ? ';' : ',');
    return lines.map(function (line) {
      var out = [], cur = '', q = false;
      for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true;
        else if (ch === d) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map(function (x) { return x.trim(); });
    });
  }

  // ---------------------------------------------------------------------------
  // Recunoașterea coloanelor și a valorilor
  // ---------------------------------------------------------------------------
  function norm(s) { return String(s === null || s === undefined ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  var COLS = {
    date: /^data( deplasarii)?$/, dep: /ora plec|^plecare/, arr: /ora sos|^sosire/, origin: /^origine/, dest: /^destinat/,
    mode: /^mod( de transport)?$/, purpose: /^scop/, stops: /^opriri/, stopDetail: /detalii opriri/, status: /^status/,
    occ: /persoane|ocupare/, role: /^rol/
  };
  function findTable(rows) {
    for (var r = 0; r < Math.min(rows.length, 15); r++) {
      var cols = {};
      (rows[r] || []).forEach(function (h, i) {
        var n = norm(h);
        Object.keys(COLS).forEach(function (k) { if (cols[k] === undefined && COLS[k].test(n)) cols[k] = i; });
      });
      if (cols.date !== undefined && cols.dep !== undefined && cols.arr !== undefined && cols.origin !== undefined && cols.dest !== undefined) {
        return { header: r, cols: cols };
      }
    }
    return null;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDate(v) {
    if (typeof v === 'number' && v > 20000) { var d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000); return d.toISOString().slice(0, 10); }
    var s = String(v || '').trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return m[1] + '-' + m[2] + '-' + m[3];
    if ((m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(s))) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    return s;
  }
  function toTime(v) {
    if (typeof v === 'number' && v >= 0 && v < 1) { var t = Math.round(v * 1440); return pad(Math.floor(t / 60)) + ':' + pad(t % 60); }
    var m = /^(\d{1,2})[:.](\d{2})/.exec(String(v || '').trim());
    return m ? pad(+m[1]) + ':' + m[2] : String(v || '');
  }
  function guessMode(v) {
    var n = norm(v);
    var hit = Domain.MODES.filter(function (m) { return n === m.code || n === norm(m.label) || norm(m.label).indexOf(n) === 0; })[0];
    if (hit) return hit.code;
    if (/auto|masin/.test(n)) return 'car';
    if (/autobuz|bus/.test(n)) return 'bus';
    if (/tramv/.test(n)) return 'tram';
    if (/jos/.test(n)) return 'walk';
    if (/bic|velo/.test(n)) return 'bike';
    return '';
  }
  function guessPurpose(v) {
    var n = norm(v);
    var hit = Domain.PURPOSES.filter(function (p) { return n === p.code || n === norm(p.label); })[0];
    if (hit) return hit.code;
    if (/insot|copii|duc/.test(n)) return 'escort';
    if (/acasa|intoarcere/.test(n)) return 'home';
    if (/serviciu|munca|job/.test(n)) return 'work';
    if (/scoala|facult|curs|educat/.test(n)) return 'education';
    if (/cumpar|magazin/.test(n)) return 'shopping';
    if (/medic|spital/.test(n)) return 'medical';
    if (/liber|vizit/.test(n)) return 'leisure';
    return n ? 'other' : '';
  }
  function maxStop(detail) {
    var m, re = /\((\d+) ?min\)/g, max = 0;
    while ((m = re.exec(String(detail || '')))) max = Math.max(max, +m[1]);
    return max;
  }
  var yes = function (v) { return /^(da|yes|y|1|true)$/.test(norm(v)); };
  var no = function (v) { return /^(nu|no|n|0|false)$/.test(norm(v)); };
  function de(n) { return n + (n && (n % 100 === 0 || n % 100 >= 20) ? ' de' : ''); } // „20 de deplasări”, dar „19 deplasări”
  function shift(t) { return parseInt(t, 10) < 12 ? 'dimineața' : 'după-amiaza'; }

  // ---------------------------------------------------------------------------
  // Pașii din interfață
  // ---------------------------------------------------------------------------
  function unitOptions(selected) {
    var units = (A.state.meta && A.state.meta.units) || [];
    var zones = units.filter(function (u) { return u.unit_type === 'IAS_ZONE'; });
    var byUat = {};
    units.forEach(function (u) {
      if (u.unit_type !== 'LOCALITY' && u.unit_type !== 'UAT_REST') return;
      if (u.uat_name === 'Iași') return;
      (byUat[u.uat_name] = byUat[u.uat_name] || []).push(u);
    });
    var o = '<option value="">– alegeți –</option><optgroup label="Municipiul Iași – zone">' +
      zones.map(function (u) { return '<option value="' + esc(u.unit_id) + '"' + (u.unit_id === selected ? ' selected' : '') + '>' + esc(u.unit_name) + '</option>'; }).join('') + '</optgroup>';
    Object.keys(byUat).sort(function (a, b) { return a.localeCompare(b, 'ro'); }).forEach(function (uat) {
      var list = byUat[uat].sort(function (a, b) { return a.unit_type === b.unit_type ? a.unit_name.localeCompare(b.unit_name, 'ro') : a.unit_type === 'UAT_REST' ? -1 : 1; });
      o += '<optgroup label="' + esc(uat) + '">' + list.map(function (u) {
        var label = u.unit_type === 'UAT_REST' ? 'comuna ' + uat + ' (fără sat precizat)' : u.unit_name;
        return '<option value="' + esc(u.unit_id) + '"' + (u.unit_id === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('') + '</optgroup>';
    });
    return o;
  }
  function select(id, options, selected) {
    return '<select data-k="' + esc(id) + '">' + options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === selected ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
  }
  function invalidate() { st.checked = false; $('impSave').disabled = true; $('impStatus').textContent = ''; }

  function loadTable(sheets) {
    var table = null, coords = {};
    sheets.forEach(function (s) {
      if (!table) { var t = findTable(s.rows); if (t) table = { sheet: s.name, rows: s.rows, header: t.header, cols: t.cols }; }
      // foaie cu coordonate (ex. „Locuri”): Loc | Latitudine | Longitudine
      var h = (s.rows[0] || []).map(norm), la = h.indexOf('latitudine'), lo = h.indexOf('longitudine');
      if (la > 0 && lo > 0) s.rows.slice(1).forEach(function (r) { if (r && r[0] && isFinite(+r[la]) && isFinite(+r[lo]) && r[la] !== null) coords[norm(r[0])] = [+r[la], +r[lo]]; });
    });
    if (!table) throw new Error('Nu am găsit tabelul: trebuie să existe un rând de antet cu Data, Origine, Destinație, Ora plecării și Ora sosirii.');
    var c = table.cols;
    st.cols = c;
    st.rows = table.rows.slice(table.header + 1).filter(function (r) { return r && r[c.date] !== null && r[c.date] !== '' && r[c.dep]; }).map(function (r, i) {
      return {
        n: i + 1, date: toDate(r[c.date]), dep: toTime(r[c.dep]), arr: toTime(r[c.arr]),
        origin: String(r[c.origin] || '').trim(), dest: String(r[c.dest] || '').trim(),
        mode: c.mode !== undefined ? String(r[c.mode] || '').trim() : '', purpose: c.purpose !== undefined ? String(r[c.purpose] || '').trim() : '',
        stops: c.stops !== undefined ? r[c.stops] : null, stopMax: c.stopDetail !== undefined ? maxStop(r[c.stopDetail]) : 0,
        status: c.status !== undefined ? String(r[c.status] || '').trim() : '', occ: c.occ !== undefined ? parseInt(r[c.occ], 10) : null,
        role: c.role !== undefined ? norm(r[c.role]) : ''
      };
    });
    if (!st.rows.length) throw new Error('Tabelul nu are rânduri cu date.');
    st.coords = coords;
    $('impInfo').textContent = de(st.rows.length) + ' rânduri citite' + (table.sheet ? ' din foaia „' + table.sheet + '”' : '') +
      (Object.keys(coords).length ? '; am găsit și coordonatele locurilor, folosite doar ca să precompletez zona sau localitatea.' : '.');
    if (!$('impLabel').value) $('impLabel').focus();
    renderSetup();
  }

  function renderSetup() {
    var rows = st.rows, c = st.cols;
    // 1. filtre
    var f = '<p class="small">Perioada din fișier: ' + esc(A.fmtDate(rows.map(function (r) { return r.date; }).sort()[0])) + ' – ' +
      esc(A.fmtDate(rows.map(function (r) { return r.date; }).sort().pop())) + '. Studiul începe la ' + esc(A.fmtDate(A.state.meta.config.study_start)) + '.</p>';
    f += '<label><input type="checkbox" id="impOnlyStudy" checked> Doar deplasările din perioada studiului</label>';
    if (c.status !== undefined) {
      var sts = {};
      rows.forEach(function (r) { sts[r.status || '(gol)'] = (sts[r.status || '(gol)'] || 0) + 1; });
      f += '<div>Coloana „Status”: ' + Object.keys(sts).map(function (s) {
        var on = /^(ok|valid)/i.test(norm(s)) || Object.keys(sts).length === 1;
        return '<label style="margin-right:12px"><input type="checkbox" class="impSt" value="' + esc(s) + '"' + (on ? ' checked' : '') + '> ' + esc(s) + ' (' + sts[s] + ')</label>';
      }).join('') + '</div>';
    }
    if (c.stopDetail !== undefined) f += '<label><input type="checkbox" id="impNoLong" checked> Fără drumurile cu o oprire mai lungă de <input type="number" id="impLongMin" value="15" min="1" style="width:4em"> minute (o oprire pentru o activitate încheie deplasarea)</label>';
    $('impFilters').innerHTML = f;

    // 2. locuri
    var names = {};
    rows.forEach(function (r) { names[r.origin] = 1; names[r.dest] = 1; });
    st.places = Object.keys(names).filter(Boolean);
    $('impPlaces').innerHTML = st.places.map(function (p, i) {
      return '<label>' + esc(p) + ' <select class="impPlace" data-i="' + i + '">' + unitOptions('') + '</select></label>';
    }).join('');
    suggestPlaces();

    // 3. valori
    var vals = '';
    var modes = {}, purposes = {};
    rows.forEach(function (r) { modes[r.mode] = 1; purposes[r.purpose] = 1; });
    var modeOpts = [['', '– alegeți –']].concat(Domain.MODES.map(function (m) { return [m.code, m.label]; }));
    var purpOpts = [['', '– alegeți –']].concat(Domain.PURPOSES.map(function (p) { return [p.code, p.label]; }));
    Object.keys(modes).forEach(function (m) { vals += '<label>Mod „' + esc(m || '(gol)') + '” ' + select('mode|' + m, modeOpts, guessMode(m)) + '</label>'; });
    Object.keys(purposes).forEach(function (p) { vals += '<label>Scop „' + esc(p || '(gol)') + '” ' + select('purpose|' + p, purpOpts, guessPurpose(p)) + '</label>'; });
    vals += '<label>Recurent? ' + select('repeat', Domain.REPEAT_TYPES.map(function (x) { return [x.code, x.label]; }), 'recurrent') + '</label>';
    if (c.role === undefined) vals += '<label>Rol în mașină ' + select('role', Domain.CAR_ROLES.map(function (x) { return [x.code, x.label]; }), 'driver') + '</label>';
    $('impValues').innerHTML = vals;
    renderOcc();
    $('impSetup').hidden = false;
    $('impResult').innerHTML = '';
    invalidate();
  }

  function renderOcc() {
    if (st.cols.occ !== undefined) { $('impOcc').innerHTML = '<p class="small">Se folosește coloana din fișier.</p>'; return; }
    var groups = {};
    st.rows.forEach(function (r) { var k = r.origin + ' → ' + r.dest + ' · ' + shift(r.dep); groups[k] = (groups[k] || 0) + 1; });
    var occOpts = Domain.OCCUPANCY.map(function (n) { return [String(n), n === 1 ? '1 (șofer singur)' : n === 5 ? '5 sau mai multe' : String(n)]; });
    $('impOcc').innerHTML = Object.keys(groups).sort().map(function (k) { return '<label>' + esc(k) + ' (' + groups[k] + ') ' + select('occ|' + k, occOpts, '1') + '</label>'; }).join('') +
      '<p class="muted small">Se aplică doar drumurilor cu autoturismul.</p>';
  }

  function suggestPlaces() {
    var pts = [], idx = [];
    st.places.forEach(function (p, i) {
      var n = norm(p), key = Object.keys(st.coords).filter(function (k) { return k === n || k.split(/[ (–-]/)[0] === n.split(/[ (–-]/)[0]; })[0];
      if (key) { pts.push(st.coords[key]); idx.push(i); }
    });
    if (!pts.length) return;
    A.api('classify', { method: 'POST', body: { points: pts } }).then(function (r) {
      r.units.forEach(function (u, k) {
        var sel = document.querySelector('.impPlace[data-i="' + idx[k] + '"]');
        if (u && sel && !sel.value) { sel.value = u; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      });
    }).catch(function () { /* sugestia e opțională */ });
  }

  function val(key) { var el = document.querySelector('[data-k="' + key.replace(/"/g, '\\"') + '"]'); return el ? el.value : ''; }

  function buildPayload() {
    var place = {};
    document.querySelectorAll('.impPlace').forEach(function (s) { place[st.places[+s.getAttribute('data-i')]] = s.value; });
    var missing = st.places.filter(function (p) { return !place[p]; });
    if (missing.length) throw new Error('Alegeți zona sau localitatea pentru: ' + missing.join(', ') + '.');
    var studyStart = A.state.meta.config.study_start, onlyStudy = $('impOnlyStudy').checked;
    var okSt = Array.prototype.map.call(document.querySelectorAll('.impSt:checked'), function (x) { return x.value; });
    var noLong = $('impNoLong') && $('impNoLong').checked, longMin = $('impLongMin') ? +$('impLongMin').value : 15;
    var kept = st.rows.filter(function (r) {
      if (onlyStudy && r.date < studyStart) return false;
      if (st.cols.status !== undefined && okSt.indexOf(r.status || '(gol)') < 0) return false;
      if (noLong && r.stopMax >= longMin) return false;
      return true;
    });
    var trips = kept.map(function (r) {
      var mode = val('mode|' + r.mode), purpose = val('purpose|' + r.purpose);
      if (!mode) throw new Error('Alegeți modul de transport pentru „' + (r.mode || '(gol)') + '”.');
      if (!purpose) throw new Error('Alegeți scopul pentru „' + (r.purpose || '(gol)') + '”.');
      var t = {
        trip_date: r.date, departure_time: r.dep, arrival_time: r.arr, origin_unit: place[r.origin], destination_unit: place[r.dest],
        mode: mode, purpose: purpose, repeat_type: val('repeat') || 'recurrent',
        stops: r.stops === null || r.stops === undefined || r.stops === '' ? null : yes(r.stops) ? ['other'] : no(r.stops) ? ['direct'] : null
      };
      if (mode === 'car') {
        t.car_role = st.cols.role !== undefined ? (/pasag/.test(r.role) ? 'passenger' : 'driver') : val('role') || 'driver';
        t.occupancy = st.cols.occ !== undefined ? r.occ : parseInt(val('occ|' + r.origin + ' → ' + r.dest + ' · ' + shift(r.dep)), 10);
      }
      return t;
    });
    return { kept: kept, body: { label: $('impLabel').value.trim(), source: $('impSource').value.trim() || 'import', trips: trips } };
  }

  function showResult(res, saved) {
    var rows = res.results.map(function (r) {
      var t = st.payload.kept[r.index];
      return '<tr><td>' + t.n + '</td><td>' + esc(A.fmtDate(t.date)) + '</td><td>' + esc(t.dep + '–' + t.arr) + '</td><td>' + esc(r.duration_min || '') + '</td>' +
        '<td>' + esc(r.origin ? r.origin + ' → ' + r.destination : t.origin + ' → ' + t.dest) + '</td>' +
        '<td>' + (r.error ? '<span class="st-exclude">respinsă</span> ' + esc(r.error) : '<span class="st-' + r.status.toLowerCase() + '">' + r.status + '</span> ' + esc((r.flags || []).join(', '))) + '</td></tr>';
    }).join('');
    var head = saved
      ? '<p><strong>Import făcut:</strong> ' + (res.created ? de(res.created) + ' deplasări noi' : 'nicio deplasare nouă') + (res.already ? ', ' + res.already + ' existau deja' : '') + (res.n_errors ? ', ' + res.n_errors + ' respinse' : '') + '.</p>'
      : '<p>' + res.n_ok + ' din ' + de(res.n) + ' deplasări pot fi importate' + (res.n_errors ? '; ' + res.n_errors + ' sunt respinse (vezi motivul)' : '') + '. Rândurile filtrate la pasul 1 nu apar.</p>';
    $('impResult').innerHTML = head + '<div class="table-wrap"><table class="data compact"><thead><tr><th>Rând</th><th>Data</th><th>Ore</th><th>Min</th><th>Relație</th><th>Rezultat</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function check() {
    try { st.payload = buildPayload(); } catch (e) { $('impStatus').textContent = e.message; return; }
    if (!st.payload.body.trips.length) { $('impStatus').textContent = 'Niciun rând nu trece de filtrele de la pasul 1.'; return; }
    $('impStatus').textContent = 'Se verifică…';
    A.api('trips/import', { method: 'POST', body: Object.assign({ dry_run: true }, st.payload.body) }).then(function (res) {
      showResult(res, false);
      st.checked = res.n_ok > 0;
      $('impSave').disabled = !st.checked;
      $('impStatus').textContent = st.checked ? 'Verificat. Apăsați „Importă” pentru a salva ' + de(res.n_ok) + ' deplasări.' : '';
    }).catch(function (e) { $('impStatus').textContent = e.message; });
  }

  function save() {
    if (!st.checked) return;
    $('impSave').disabled = true;
    $('impStatus').textContent = 'Se importă…';
    A.api('trips/import', { method: 'POST', body: st.payload.body }).then(function (res) {
      showResult(res, true);
      $('impStatus').textContent = '';
      st.checked = false;
      loadList();
    }).catch(function (e) { $('impStatus').textContent = e.message; $('impSave').disabled = false; });
  }

  function loadList() {
    return A.api('imports').then(function (r) {
      var tb = $('impList').querySelector('tbody');
      tb.innerHTML = r.imports.length ? r.imports.map(function (x) {
        return '<tr><td>' + esc(x.label || x.participant_id) + '</td><td>' + esc(x.source || '') + '</td><td>' + x.n_trips + '</td><td>' + esc(A.fmtDate(x.first_date)) + ' – ' + esc(A.fmtDate(x.last_date)) + '</td><td>' + esc(A.fmtTs(x.imported_at)) +
          '</td><td><button type="button" class="ghost small" data-del="' + esc(x.participant_id) + '" data-n="' + x.n_trips + '">Șterge</button></td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">Niciun import încă.</td></tr>';
    }).catch(function (e) { $('impInfo').textContent = e.message; });
  }

  // ---------------------------------------------------------------------------
  $('impFile').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    $('impInfo').textContent = 'Se citește ' + f.name + '…';
    var isXlsx = /\.xlsx$/i.test(f.name);
    (isXlsx ? f.arrayBuffer().then(readXlsx) : f.text().then(function (t) { return [{ name: '', rows: readDelimited(t) }]; }))
      .then(loadTable).catch(function (e) { $('impInfo').textContent = e.message; $('impSetup').hidden = true; });
    if (!$('impLabel').value) $('impLabel').value = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80);
  });
  $('impPasteBtn').addEventListener('click', function () {
    try { loadTable([{ name: '', rows: readDelimited($('impPaste').value) }]); } catch (e) { $('impInfo').textContent = e.message; $('impSetup').hidden = true; }
  });
  $('impSetup').addEventListener('change', invalidate);
  $('impSetup').addEventListener('input', invalidate);
  $('impLabel').addEventListener('input', invalidate);
  $('impSource').addEventListener('input', invalidate);
  $('impCheck').addEventListener('click', check);
  $('impSave').addEventListener('click', save);
  $('impList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    if (!window.confirm('Ștergeți definitiv cele ' + de(+b.getAttribute('data-n')) + ' deplasări ale acestui import?')) return;
    A.api('imports/delete', { method: 'POST', body: { participant_id: b.getAttribute('data-del') } }).then(loadList).catch(function (err) { window.alert(err.message); });
  });

  window.AdminImport = { load: loadList };
})();
