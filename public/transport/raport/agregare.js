/*
 * GpsAgregare – rezumatul unei zile de poziții GPS ale vehiculelor CTP Iași (arhiva /live/istoric), pentru raportul
 * „Transportul public, zi de zi” (/transport/raport/) și pentru analizele de mobilitate urbană.
 *
 * Citirile (o dată pe minut) trec prin aceleași calcule ca harta „Sănătatea transportului public” (SanatateCore):
 * vehiculele se potrivesc pe traseele din orar, iar la fiecare citire se calculează scorul liniilor și al rețelei.
 * Din ele, ziua se rezumă în:
 *   - cronologia rețelei (la 5 minute): scor, serviciu, viteză, plutoane, opriri;
 *   - liniile pe ore: scor, serviciu, viteză, plutoane, opriri, vehicule față de orar;
 *   - cartierele (zonele MVA–MVI) pe ore: vehicule-minut, viteză, timp oprit, timp în pluton, scorul liniilor care trec;
 *   - cursele reconstituite (capăt → capăt): ora plecării, durata reală, durata din orar;
 *   - tronsoanele de 250 m pe intervale orare: viteza medie de spațiu (distanță / timp) și minutele-vehicul pierdute
 *     față de viteza de referință a tronsonului (percentila 85 a vitezelor din zi, ca „drum liber”);
 *   - punctele negre: celulele de ~150 m unde vehiculele stau pe loc pe traseu (minute-vehicul).
 *
 * Încărcat în browser (window.GpsAgregare, după core.js) și în Node (require) – scripts/gps_raport.mjs folosește
 * același cod pentru fișierele zilnice din public/data/transport/gps/.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../sanatate/core.js'));
  else root.GpsAgregare = factory(root.SanatateCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  var VERSION = 1;
  // intervalele orare ale zilei (ora Iașiului)
  var BANDS = [
    { id: 0, de: 0, la: 5, nume: '00–05' }, { id: 1, de: 5, la: 7, nume: '05–07' },
    { id: 2, de: 7, la: 9, nume: '07–09 (vârf dimineața)' }, { id: 3, de: 9, la: 14, nume: '09–14' },
    { id: 4, de: 14, la: 16, nume: '14–16' }, { id: 5, de: 16, la: 19, nume: '16–19 (vârf seara)' },
    { id: 6, de: 19, la: 24, nume: '19–24' }
  ];
  var CELL_LAT = 0.00135, CELL_LNG = 0.002;      // ~150 × 150 m la Iași
  var MAX_GAP = 150;                              // s: între citiri mai rare nu acumulăm timp (lipsă de date)
  var MIN_OBS = 3;                                // observații în mișcare necesare pentru viteza de referință a unui tronson

  function bandOf(hour) { for (var i = 0; i < BANDS.length; i++) if (hour >= BANDS[i].de && hour < BANDS[i].la) return i; return 0; }
  function r1(x) { return x == null || !isFinite(x) ? null : Math.round(x * 10) / 10; }
  function r3(x) { return x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000; }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function quantile(a, q) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), p = (s.length - 1) * q, i = Math.floor(p);
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * (p - i) : s[i];
  }

  // ---------- zone (cartiere) ----------
  function prepareZones(geo) {
    return ((geo && geo.features) || []).map(function (f) {
      var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      polys.forEach(function (p) { p[0].forEach(function (c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }); });
      var p = f.properties || {};
      return { id: p.zone_id || p.id || p.denumire, nume: p.zone_name || p.denumire || p.zone_id, polys: polys, b: b };
    });
  }
  function inRing(ring, x, y) {
    var ins = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
    }
    return ins;
  }
  function zoneOf(zones, lng, lat) {
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      if (lng < z.b[0] || lng > z.b[2] || lat < z.b[1] || lat > z.b[3]) continue;
      for (var k = 0; k < z.polys.length; k++) {
        var p = z.polys[k];
        if (inRing(p[0], lng, lat) && !p.slice(1).some(function (h) { return inRing(h, lng, lat); })) return z.id;
      }
    }
    return null;
  }

  /* Rezumatul zilei. records = citirile din /live/istoric ({ t, v: [...] }, oricare ordine); plan = sanatate_plan.json;
   * zonesGeo = iasi_17_zone_mva_mvi.geojson; opts.zi = 'AAAA-LL-ZZ' (ziua locală; citirile din alte zile se ignoră). */
  function aggregateDay(plan, zonesGeo, records, opts) {
    opts = opts || {};
    var CFG = Core.CFG, tr = new Core.Tracker(plan), zones = prepareZones(zonesGeo);
    records = records.slice().sort(function (a, b) { return a.t - b.t; });
    if (opts.zi) records = records.filter(function (r) { return localDate(r.t) === opts.zi; });

    var timeline = [], lines = {}, zoneAcc = {}, trips = [], cells = {}, seg = {}, segObs = [];
    var seenTs = {}, tripSt = {}, prevT = null, lastSample = -Infinity, minutes = 0;

    function lineAcc(k) {
      var r = plan.rute[k], id = r.tip + '|' + r.linie;
      return lines[id] || (lines[id] = { linie: r.linie, tip: r.tip, retea: r.retea, culoare: r.culoare, ore: {} });
    }
    function hourAcc(obj, h) {
      return obj[h] || (obj[h] = { n: 0, scor: [], serv: [], vit: [], pluton: 0, opriti: 0, veh: 0, plan: 0 });
    }

    records.forEach(function (rec) {
      var snap = Core.unpack(rec);
      tr.add(snap);
      var lt = Core.localTime(rec.t), hour = Math.floor(lt.min / 60), band = bandOf(hour);
      var dt = prevT == null ? 60 : Math.min(rec.t - prevT, MAX_GAP);
      if (prevT != null && rec.t - prevT > MAX_GAP) dt = 60;              // după o pauză, citirea contează un minut
      prevT = rec.t; minutes += dt / 60;

      // pozițiile noi ale fiecărui vehicul: viteza pe tronsoane și cursele
      snap.vehicule.forEach(function (v) {
        var h = tr.hist[v.id];
        if (!h || !h.length) return;
        var cur = h[h.length - 1];
        if (seenTs[v.id] === cur.ts) return;
        seenTs[v.id] = cur.ts;
        var prev = h.length > 1 ? h[h.length - 2] : null;
        if (cur.key && prev && prev.key === cur.key) segment(cur, prev, band);
        trip(v.id, cur);
      });

      var A = Core.analyze(tr);
      // liniile, pe ore (ambele sensuri împreună)
      var perLine = {};
      Object.keys(A.linii).forEach(function (k) {
        var l = A.linii[k], acc = lineAcc(k), id = l.tip + '|' + l.linie;
        var o = perLine[id] || (perLine[id] = { acc: acc, scor: [], serv: null, vit: [], pluton: 0, opriti: 0, veh: 0, plan: 0 });
        if (l.scor != null) o.scor.push(l.scor);
        if (l.parti.serviciu != null) o.serv = l.parti.serviciu;
        if (l.viteza != null) o.vit.push(l.viteza);
        o.pluton += l.pluton; o.opriti += l.opriti; o.veh += l.vehicule; o.plan += l.planificat.vehicule;
      });
      Object.keys(perLine).forEach(function (id) {
        var o = perLine[id], ha = hourAcc(o.acc.ore, hour);
        ha.n++;
        if (o.scor.length) ha.scor.push(mean(o.scor));
        if (o.serv != null) ha.serv.push(o.serv);
        if (o.vit.length) ha.vit.push(mean(o.vit));
        ha.pluton += o.pluton; ha.opriti += o.opriti; ha.veh += o.veh; ha.plan += o.plan;
      });

      // cartierele și punctele negre: fiecare vehicul pe traseu (fără capete) contează dt
      A.vehicule.forEach(function (s) {
        if (!s.key || s.cap || s.depou) return;
        var c = s.cur, z = zoneOf(zones, c.lng, c.lat), w = dt / 60, l = A.linii[s.key];
        if (z) {
          var za = zoneAcc[z] || (zoneAcc[z] = {}), ha = za[hour] || (za[hour] = { veh: 0, oprit: 0, pluton: 0, vit: [], scor: [] });
          ha.veh += w;
          if (s.oprit >= CFG.stopMin) ha.oprit += w;
          if (s.pluton) ha.pluton += w;
          if (s.viteza != null) ha.vit.push(s.viteza);
          if (l && l.scor != null) ha.scor.push(l.scor);
        }
        if (s.oprit >= 120) {
          var ck = Math.round(c.lat / CELL_LAT) + ':' + Math.round(c.lng / CELL_LNG);
          var cell = cells[ck] || (cells[ck] = { lat: 0, lng: 0, n: 0, min: 0, linii: {} });
          cell.lat += c.lat; cell.lng += c.lng; cell.n++; cell.min += w;
          if (l) cell.linii[l.linie] = 1;
        }
      });

      // cronologia rețelei, la 5 minute
      var slot = Math.floor(lt.min / 5) * 5;
      if (slot !== lastSample) {
        lastSample = slot;
        var R = A.retea;
        var St = R.strada;
        // [minut, scor, serviciu, viteză, plutoane, opriri, cu GPS, cerute, pe stradă / planificare, acoperirea datelor,
        //  autobuze pe stradă / planificare, tramvaie pe stradă / planificare]
        timeline.push([slot, R.scor, r3(R.serviciu), r1(R.viteza), R.pluton, R.opriti, R.cuGps, R.planificate,
          St ? r3(St.raport) : null, St ? r3(St.acoperire) : null,
          St && St.autobuz.pl ? r3(St.autobuz.total / St.autobuz.pl) : null, St && St.tramvai.pl ? r3(St.tramvai.total / St.tramvai.pl) : null]);
      }
    });

    // ---------- viteza pe tronsoane ----------
    function segment(cur, prev, band) {
      var dtp = cur.ts - prev.ts;
      if (dtp <= 0 || dtp > CFG.segMaxDt) return;
      var dd = cur.d - prev.d;
      if (dd < -20 || dd > dtp * 25) return;                                // înapoi sau > 90 km/h: altă potrivire
      var sh = tr.shapes[cur.key];
      if (!sh) return;
      var d0 = Math.min(prev.d, cur.d), d1 = Math.max(prev.d, cur.d), len = d1 - d0;
      // capetele de linie (regulare, așteptare) nu intră în viteza tronsoanelor
      if (d1 < CFG.terminal || d0 > sh.len - CFG.terminal) return;
      var v = Math.max(0, dd) / dtp * 3.6;
      for (var bi = Math.floor(d0 / CFG.bin); bi <= Math.floor(d1 / CFG.bin); bi++) {
        var b0 = bi * CFG.bin, b1 = b0 + CFG.bin, o = len > 1 ? Math.max(0, Math.min(d1, b1) - Math.max(d0, b0)) : (d0 >= b0 && d0 < b1 ? 0 : -1);
        if (o < 0 || (len > 1 && o === 0)) continue;
        var tIn = len > 1 ? dtp * o / len : dtp;                           // secunde petrecute în tronson
        segObs.push(cur.key, bi, band, v, tIn, o);
      }
    }

    // ---------- cursele: de la ultima poziție în zona de plecare până la prima în zona de sosire ----------
    function trip(id, cur) {
      if (!cur.key || !tr.shapes[cur.key]) { delete tripSt[id]; return; }
      var L = tr.shapes[cur.key].len, st = tripSt[id];
      if (!st || st.key !== cur.key || cur.d < st.lastD - 500) st = tripSt[id] = { key: cur.key, t0: null, lastD: cur.d };
      if (cur.d < CFG.terminal) st.t0 = cur.ts;
      else if (cur.d > L - CFG.terminal && st.t0 != null) {
        var lt0 = Core.localTime(st.t0), dur = (cur.ts - st.t0) / 60;
        var pl = Core.planned(plan.rute[cur.key], plan.servicii, lt0.dow, lt0.min).durata;
        // fără curse cu goluri de semnal sau ocoluri: între 40% și 300% din durata din orar
        if (pl && dur >= 0.4 * pl && dur <= 3 * pl) trips.push([cur.key, Math.round(lt0.min), r1(dur), r1(pl)]);
        st.t0 = null;
      }
      st.lastD = cur.d;
    }

    // tronsoane: viteza de referință (p85 din zi), viteza medie de spațiu și minutele pierdute pe intervale
    var byBin = {};
    for (var i = 0; i < segObs.length; i += 6) {
      var k = segObs[i] + '|' + segObs[i + 1];
      (byBin[k] = byBin[k] || []).push(i);
    }
    Object.keys(byBin).forEach(function (k) {
      var idx = byBin[k], vs = idx.map(function (i) { return segObs[i + 3]; }).filter(function (v) { return v > 3; });
      if (vs.length < MIN_OBS) return;
      var vref = Math.max(12, Math.min(50, quantile(vs, 0.85)));
      var p = k.split('|'), key = p[0], bi = +p[1], s = seg[key] || (seg[key] = {});
      idx.forEach(function (i) {
        var band = segObs[i + 2], v = segObs[i + 3], tIn = segObs[i + 4], o = segObs[i + 5];
        var a = s[band] || (s[band] = {}), c = a[bi] || (a[bi] = { dist: 0, time: 0, lost: 0, n: 0 });
        c.dist += o; c.time += tIn; c.n++;
        if (v < vref) c.lost += tIn * (1 - v / vref);
      });
      s.ref = s.ref || {};
      s.ref[bi] = r1(vref);
    });
    var segments = {};
    Object.keys(seg).forEach(function (key) {
      var s = seg[key], out = { ref: s.ref, benzi: {} };
      BANDS.forEach(function (b) {
        if (!s[b.id]) return;
        out.benzi[b.id] = Object.keys(s[b.id]).map(Number).sort(function (a, c) { return a - c; }).map(function (bi) {
          var c = s[b.id][bi];
          // [tronson, viteza km/h, minute-vehicul pierdute, minute-vehicul în tronson]
          return [bi, c.time > 0 ? r1(c.dist / c.time * 3.6) : null, r1(c.lost / 60), r1(c.time / 60)];
        });
      });
      segments[key] = out;
    });

    // liniile
    var linii = {};
    Object.keys(lines).forEach(function (id) {
      var l = lines[id], ore = {};
      Object.keys(l.ore).forEach(function (h) {
        var a = l.ore[h];
        // [scor mediu, serviciu mediu, viteză medie, plutoane / citire, opriri / citire, vehicule / citire, cerute / citire]
        ore[h] = [r1(mean(a.scor)), r3(mean(a.serv)), r1(mean(a.vit)), r3(a.pluton / a.n), r3(a.opriti / a.n), r1(a.veh / a.n), r1(a.plan / a.n)];
      });
      linii[id] = { linie: l.linie, tip: l.tip, retea: l.retea, culoare: l.culoare, ore: ore };
    });

    // cartierele
    var cartiere = {};
    zones.forEach(function (z) {
      var za = zoneAcc[z.id] || {}, ore = {};
      Object.keys(za).forEach(function (h) {
        var a = za[h];
        // [vehicule-minut, viteză mediană, minute oprit, minute în pluton, scorul mediu al liniilor care trec]
        ore[h] = [r1(a.veh), r1(quantile(a.vit, 0.5)), r1(a.oprit), r1(a.pluton), r1(mean(a.scor))];
      });
      cartiere[z.id] = { nume: z.nume, ore: ore };
    });

    // punctele negre (cele mai multe minute de staționare pe traseu)
    var puncte = Object.keys(cells).map(function (k) {
      var c = cells[k];
      return [Math.round(c.lat / c.n * 1e5) / 1e5, Math.round(c.lng / c.n * 1e5) / 1e5, r1(c.min), Object.keys(c.linii).sort().join(' ')];
    }).filter(function (p) { return p[2] >= 2; }).sort(function (a, b) { return b[2] - a[2]; }).slice(0, 300);

    return { versiune: VERSION, zi: opts.zi || (records.length ? localDate(records[0].t) : null), minute: Math.round(minutes),
      citiri: records.length, prima: records.length ? records[0].t : null, ultima: records.length ? records[records.length - 1].t : null,
      benzi: BANDS, rezumat: summary(timeline, trips, puncte, cartiere), cronologie: timeline, linii: linii,
      cartiere: cartiere, curse: trips, tronsoane: segments, puncte: puncte };
  }

  /* Cifrele zilei (pentru index și comparații). Scorul și serviciul: media citirilor dintre 06 și 22. */
  function summary(timeline, trips, puncte, cartiere) {
    var day = timeline.filter(function (r) { return r[0] >= 360 && r[0] < 1320; });
    var pick = function (i) { return day.map(function (r) { return r[i]; }).filter(function (x) { return x != null; }); };
    var ratios = trips.map(function (t) { return t[2] / t[3]; });
    var peak = timeline.filter(function (r) { return r[0] >= 420 && r[0] < 540; }).map(function (r) { return r[1]; }).filter(function (x) { return x != null; });
    var stop = 0;
    Object.keys(cartiere).forEach(function (z) { Object.keys(cartiere[z].ore).forEach(function (h) { stop += cartiere[z].ore[h][2] || 0; }); });
    return {
      scor: r1(mean(pick(1))), scorVarf: r1(mean(peak)), serviciu: r3(mean(pick(2))), viteza: r1(mean(pick(3))),
      strada: r3(mean(pick(8))), acoperire: r3(mean(pick(9))), stradaAutobuz: r3(mean(pick(10))), stradaTramvai: r3(mean(pick(11))),
      plutoane: r1(mean(pick(4))), opriri: r1(mean(pick(5))), curse: trips.length,
      durataRaport: r3(quantile(ratios, 0.5)), minuteOprit: Math.round(stop), puncteNegre: puncte.length
    };
  }

  function localDate(unix) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(unix * 1000));
  }
  /* Orele UTC (AAAA-LL-ZZTHH) care acoperă ziua locală `zi` la Iași. */
  function hoursOfDay(zi) {
    var out = [], t0 = Date.parse(zi + 'T00:00:00Z') / 1000 - 4 * 3600;
    for (var t = t0; t < t0 + 30 * 3600; t += 3600) {
      if (localDate(t) === zi || localDate(t + 3599) === zi) out.push(new Date(t * 1000).toISOString().slice(0, 13));
    }
    return out;
  }

  // ---------- exporturi CSV (pentru analize) ----------
  function csv(rows) {
    return rows.map(function (r) {
      return r.map(function (x) { x = x == null ? '' : String(x); return /[",;\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',');
    }).join('\n') + '\n';
  }
  function hhmm(min) { var h = Math.floor(min / 60), m = Math.round(min % 60); return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m; }
  var EXPORTS = {
    cronologie: function (D) {
      return csv([['zi', 'ora', 'scor_retea', 'serviciu', 'viteza_kmh', 'plutoane', 'opriri', 'vehicule_gps', 'vehicule_cerute', 'pe_strada', 'acoperire_date', 'pe_strada_autobuze', 'pe_strada_tramvaie']]
        .concat(D.cronologie.map(function (r) { return [D.zi, hhmm(r[0])].concat(r.slice(1)); })));
    },
    linii: function (D) {
      var rows = [['zi', 'tip', 'linie', 'retea', 'ora', 'scor', 'serviciu', 'viteza_kmh', 'plutoane_medii', 'opriri_medii', 'vehicule_medii', 'vehicule_orar']];
      Object.keys(D.linii).forEach(function (id) {
        var l = D.linii[id];
        Object.keys(l.ore).forEach(function (h) { rows.push([D.zi, l.tip, l.linie, l.retea, h].concat(l.ore[h])); });
      });
      return csv(rows);
    },
    cartiere: function (D) {
      var rows = [['zi', 'zona', 'nume', 'ora', 'vehicule_minut', 'viteza_mediana_kmh', 'minute_oprit', 'minute_pluton', 'scor_linii']];
      Object.keys(D.cartiere).forEach(function (z) {
        var c = D.cartiere[z];
        Object.keys(c.ore).forEach(function (h) { rows.push([D.zi, z, c.nume, h].concat(c.ore[h])); });
      });
      return csv(rows);
    },
    curse: function (D, plan) {
      return csv([['zi', 'linie', 'sens_spre', 'route_sens', 'plecare', 'durata_min', 'durata_orar_min', 'raport']]
        .concat(D.curse.map(function (t) {
          var r = plan && plan.rute[t[0]] || {};
          return [D.zi, r.linie, r.spre, t[0], hhmm(t[1]), t[2], t[3], r3(t[2] / t[3])];
        })));
    },
    tronsoane: function (D, plan) {
      var rows = [['zi', 'linie', 'sens_spre', 'route_sens', 'tronson', 'de_la_m', 'pana_la_m', 'interval', 'viteza_kmh', 'viteza_referinta_kmh', 'minute_pierdute', 'minute_vehicul', 'lat', 'lng']];
      Object.keys(D.tronsoane).forEach(function (key) {
        var s = D.tronsoane[key], r = plan && plan.rute[key] || {}, sh = r.forma ? Core.prepareShape(r.forma) : null;
        Object.keys(s.benzi).forEach(function (b) {
          s.benzi[b].forEach(function (x) {
            var d0 = x[0] * Core.CFG.bin, d1 = d0 + Core.CFG.bin, mid = sh ? Core.slice(sh, Math.min(d0 + 125, sh.len), Math.min(d0 + 126, sh.len))[0] : [null, null];
            rows.push([D.zi, r.linie, r.spre, key, x[0], d0, d1, D.benzi[b].nume, x[1], s.ref[x[0]], x[2], x[3], mid[1] && r3(mid[1] * 100) / 100, mid[0] && r3(mid[0] * 100) / 100]);
          });
        });
      });
      return csv(rows);
    },
    puncte: function (D) {
      return csv([['zi', 'lat', 'lng', 'minute_vehicul_oprit', 'linii']].concat(D.puncte.map(function (p) { return [D.zi].concat(p); })));
    }
  };

  return { VERSION: VERSION, BANDS: BANDS, bandOf: bandOf, prepareZones: prepareZones, zoneOf: zoneOf, aggregateDay: aggregateDay,
    summary: summary, localDate: localDate, hoursOfDay: hoursOfDay, quantile: quantile, csv: csv, hhmm: hhmm, EXPORTS: EXPORTS };
});
