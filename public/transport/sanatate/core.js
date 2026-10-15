/*
 * SanatateCore – „sănătatea” transportului public din Iași, din pozițiile GPS ale vehiculelor (Tranzy) comparate cu
 * orarul GTFS CTP (public/data/transport/sanatate_plan.json, scripts/transport_sanatate.py). Fără dependențe de browser.
 *
 * Pe fiecare linie și sens (cheia „route_id_sens”, ex. „8_1” = linia 46 spre Păcurari):
 *   - serviciul: câte vehicule circulă acum cu GPS față de câte cere orarul (curse începute și neterminate), pe toată
 *     linia (ambele sensuri – sensul din sursă e des greșit);
 *   - viteza comercială: cât avansează vehiculele de-a lungul traseului (din pozițiile succesive), față de viteza
 *     planificată în orar la aceeași oră (lungimea traseului / durata cursei);
 *   - regularitatea: distanțele dintre vehiculele succesive de pe traseu, transformate în minute cu viteza planificată,
 *     față de intervalul din orar; „pluton” = două vehicule la mai puțin de un sfert din interval (sau < 2 min);
 *   - opririle: vehicule care nu au avansat de câteva minute, în afara capetelor de linie.
 * Din ele: un scor 0–100 pe linie și tronsoanele colorate după viteza reală din ultima jumătate de oră.
 *
 * Încărcat în browser (window.SanatateCore) și în Node (require) – testele folosesc același cod.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SanatateCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R_LAT = 110540, R_LON = 111320;
  var CFG = {
    maxOff: 120,          // m: mai departe de traseu → vehiculul nu e pe forma liniei (deviere, garaj)
    terminal: 300,        // m de la capete: zona de regulare / așteptare, exclusă din opriri și intervale
    history: 35 * 60,     // s păstrate în istoric
    stopMove: 30,         // m: sub această deplasare vehiculul „stă”
    stopMin: 180,         // s: oprit cel puțin atât → semnalat
    speedWin: 6 * 60,     // s: fereastra pentru viteza unui vehicul
    speedMin: 3 * 60,     // s: viteza se calculează doar din cel puțin atâtea secunde de mers (altfel e zgomot de stație)
    bin: 250,             // m: lungimea tronsoanelor hărții de viteză
    segMaxDt: 200,        // s: între două poziții mai depărtate de atât nu desenăm tronsonul
    bunchFrac: 0.25, bunchMin: 2, gapFrac: 2
  };

  // ---------- geometrie ----------
  function prepareShape(coords) {
    var lat0 = coords[0][1], kx = R_LON * Math.cos(lat0 * Math.PI / 180), x = [], y = [], cum = [0];
    for (var i = 0; i < coords.length; i++) {
      x.push(coords[i][0] * kx); y.push(coords[i][1] * R_LAT);
      if (i) cum.push(cum[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]));
    }
    return { coords: coords, x: x, y: y, cum: cum, kx: kx, len: cum[cum.length - 1] };
  }

  /* Poziția de-a lungul traseului: { d (m de la început), off (m față de traseu) }. `near` (m, opțional) caută întâi
   * lângă poziția anterioară – traseele în buclă sau dus-întors pe aceeași stradă au mai multe potriviri. */
  function project(sh, lat, lng, near) {
    var px = lng * sh.kx, py = lat * R_LAT;
    function scan(lo, hi) {
      var best = null;
      for (var i = 0; i < sh.x.length - 1; i++) {
        if (sh.cum[i + 1] < lo || sh.cum[i] > hi) continue;
        var ax = sh.x[i], ay = sh.y[i], dx = sh.x[i + 1] - ax, dy = sh.y[i + 1] - ay, l2 = dx * dx + dy * dy;
        var t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
        var off = Math.hypot(px - ax - t * dx, py - ay - t * dy);
        if (!best || off < best.off) best = { d: sh.cum[i] + t * Math.sqrt(l2), off: off };
      }
      return best;
    }
    if (near != null) {
      var b = scan(near - 600, near + 1500);
      if (b && b.off <= CFG.maxOff) return b;
    }
    return scan(-Infinity, Infinity);
  }

  // porțiunea de traseu între d0 și d1 (m), ca [[lng, lat], …]
  function slice(sh, d0, d1) {
    var out = [], c = sh.coords;
    function at(d) {
      var i = 0;
      while (i < sh.cum.length - 2 && sh.cum[i + 1] < d) i++;
      var seg = sh.cum[i + 1] - sh.cum[i], t = seg ? (d - sh.cum[i]) / seg : 0;
      return [c[i][0] + (c[i + 1][0] - c[i][0]) * t, c[i][1] + (c[i + 1][1] - c[i][1]) * t];
    }
    out.push(at(d0));
    for (var i = 1; i < sh.cum.length - 1; i++) if (sh.cum[i] > d0 && sh.cum[i] < d1) out.push(c[i]);
    out.push(at(d1));
    return out;
  }

  // ---------- orarul ----------
  /* Ora și ziua la Iași (Europe/Bucharest), indiferent de fusul calculatorului: { min (de la miezul nopții), dow (0 = luni) }. */
  function localTime(unix) {
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(unix * 1000)).forEach(function (x) { p[x.type] = x.value; });
    return { min: +p.hour * 60 + +p.minute + +p.second / 60, dow: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
  }

  /* Ce cere orarul la minutul `min` din ziua `dow`: vehicule pe traseu, intervalul (min) și viteza planificată (km/h).
   * Cursele de după miezul nopții ale zilei precedente (ore > 24:00 în GTFS) se iau în calcul. */
  function planned(route, servicii, dow, min) {
    var prev = (dow + 6) % 7, onRoad = 0, deps = [], runs = [];
    Object.keys(route.curse || {}).forEach(function (s) {
      var days = servicii[s] || [];
      [[dow, 0], [prev, 1440]].forEach(function (dd) {
        if (days.indexOf(dd[0]) < 0) return;
        var t = min + dd[1];
        route.curse[s].forEach(function (c) {
          if (c[0] <= t && c[1] >= t) onRoad++;
          if (c[0] >= t - 45 && c[0] <= t + 45) { deps.push(c[0] - dd[1]); runs.push(c[1] - c[0]); }
        });
      });
    });
    deps.sort(function (a, b) { return a - b; });
    var headway = deps.length > 1 ? (deps[deps.length - 1] - deps[0]) / (deps.length - 1) : null;
    var run = median(runs);
    return { vehicule: onRoad, interval: headway, viteza: run && route.lungime ? route.lungime / 1000 / (run / 60) : null, durata: run };
  }

  // ---------- istoricul pozițiilor ----------
  /* Tracker: păstrează pozițiile fiecărui vehicul (ultima jumătate de oră), proiectate pe traseul liniei. */
  function Tracker(plan) {
    this.plan = plan; this.shapes = {}; this.hist = {}; this.t = 0;
    var self = this;
    Object.keys(plan.rute).forEach(function (k) { if (plan.rute[k].forma) self.shapes[k] = prepareShape(plan.rute[k].forma); });
  }
  /* Linia-sens a vehiculului: din sensul raportat; fără sens, sensul al cărui traseu e mai aproape (la egalitate,
   * cel pe care vehiculul avansează). */
  Tracker.prototype.match = function (v, prev) {
    if (v.ruta == null) return null;
    var keys = v.sens != null ? [v.ruta + '_' + v.sens] : [v.ruta + '_0', v.ruta + '_1'], best = null, self = this;
    keys.forEach(function (k) {
      var sh = self.shapes[k];
      if (!sh) return;
      var near = prev && prev.key === k ? prev.d : null, p = project(sh, v.lat, v.lng, near);
      if (!p || p.off > CFG.maxOff) return;
      var score = p.off - (prev && prev.key === k && p.d >= prev.d - 20 ? 40 : 0);
      if (!best || score < best.score) best = { key: k, d: p.d, off: p.off, score: score };
    });
    return best;
  };
  /* Adaugă o citire (răspunsul /live/vehicule sau o înregistrare din istoric): { actualizat, vehicule: [...] }. */
  Tracker.prototype.add = function (snap) {
    var self = this, t = snap.actualizat || 0;
    (snap.vehicule || []).forEach(function (v) {
      var h = self.hist[v.id] || (self.hist[v.id] = []), last = h[h.length - 1];
      if (last && v.ts <= last.ts) return;                                  // aceeași poziție, deja văzută
      var m = self.match(v, last);
      h.push({ ts: v.ts, lat: v.lat, lng: v.lng, v: v.v, ruta: v.ruta, nr: v.nr, tip: v.tip,
        key: m ? m.key : null, d: m ? m.d : null, off: m ? m.off : null });
    });
    this.t = Math.max(this.t, t);
    Object.keys(this.hist).forEach(function (id) {
      var h = self.hist[id];
      while (h.length && h[0].ts < self.t - CFG.history) h.shift();
      if (!h.length) delete self.hist[id];
    });
  };

  // starea curentă a unui vehicul, din istoricul lui
  function vehicleState(h, now, shapes) {
    var cur = h[h.length - 1], st = { id: null, cur: cur, key: cur.key, viteza: null, oprit: 0, cap: false };
    if (cur.key && shapes[cur.key]) {
      var L = shapes[cur.key].len;
      st.cap = cur.d < CFG.terminal || cur.d > L - CFG.terminal;
      // viteza: avansul pe traseu în ultimele minute (fără salturile de la capăt la capăt)
      for (var i = h.length - 2; i >= 0; i--) {
        var p = h[i];
        if (p.key !== cur.key || p.d > cur.d + 50) break;
        if (cur.ts - p.ts >= CFG.speedWin || i === 0) {
          if (cur.ts - p.ts >= CFG.speedMin) st.viteza = Math.max(0, cur.d - p.d) / (cur.ts - p.ts) * 3.6;
          break;
        }
      }
      // de cât timp stă (deplasare < stopMove față de poziția curentă)
      var since = cur.ts;
      for (var j = h.length - 2; j >= 0; j--) {
        if (h[j].key !== cur.key || Math.abs(cur.d - h[j].d) > CFG.stopMove) break;
        since = h[j].ts;
      }
      st.oprit = cur.ts - since;
    }
    st.vechime = now - cur.ts;
    return st;
  }

  // ---------- indicatorii ----------
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  var LEVELS = [[80, 'bun', '#2fa66a'], [60, 'acceptabil', '#c9b52b'], [40, 'slab', '#e58a2e'], [0, 'critic', '#d8433b']];
  function level(score) {
    if (score == null) return { nume: 'fără date', culoare: '#8f8e86' };
    for (var i = 0; i < LEVELS.length; i++) if (score >= LEVELS[i][0]) return { nume: LEVELS[i][1], culoare: LEVELS[i][2] };
  }

  /* Scorul 0–100 al unei linii-sens: serviciu 35 + viteză 30 + regularitate 35; componentele fără date nu contează
   * (ponderea lor se împarte între celelalte). */
  function score(parts) {
    var W = { serviciu: 35, viteza: 30, regularitate: 35 }, sum = 0, w = 0;
    Object.keys(W).forEach(function (k) { if (parts[k] != null) { sum += W[k] * parts[k]; w += W[k]; } });
    return w ? Math.round(sum / w * 100) : null;
  }

  /* Analiza rețelei la momentul curent al tracker-ului. Întoarce { t, ora, linii: { key: {...} }, vehicule: [...],
   * alerte: [...], retea: {...} }. */
  function analyze(tr, opts) {
    opts = opts || {};
    var now = tr.t, lt = localTime(now), plan = tr.plan, shapes = tr.shapes, byKey = {}, vehs = [];
    Object.keys(tr.hist).forEach(function (id) {
      var st = vehicleState(tr.hist[id], now, shapes);
      if (st.vechime > 600) return;
      st.id = id; vehs.push(st);
      if (st.key) (byKey[st.key] = byKey[st.key] || []).push(st);
    });
    var linii = {}, alerte = [], PL = {}, line = {};
    // serviciul se judecă pe linie, cu ambele sensuri: sensul raportat de sursă e des greșit (ex. 4 vehicule „spre
    // C.U.G.” și 1 „spre Păcurari”, când orarul cere 2 + 3 – linia are tot serviciul)
    Object.keys(plan.rute).forEach(function (k) {
      var rid = k.slice(0, k.lastIndexOf('_')), t = line[rid] || (line[rid] = { pl: 0, v: 0 });
      PL[k] = planned(plan.rute[k], plan.servicii, lt.dow, lt.min);
      t.pl += PL[k].vehicule; t.v += (byKey[k] || []).length;
    });
    Object.keys(plan.rute).forEach(function (k) {
      var r = plan.rute[k], pl = PL[k], vs = byKey[k] || [], tot = line[k.slice(0, k.lastIndexOf('_'))];
      if (!pl.vehicule && !vs.length) return;                               // nu circulă acum
      var enRoute = vs.filter(function (s) { return !s.cap; }).sort(function (a, b) { return a.cur.d - b.cur.d; });
      var speeds = enRoute.map(function (s) { return s.viteza; }).filter(function (x) { return x != null; });
      // mult mai multe vehicule decât cere orarul: atribuirea liniei din sursă e îndoielnică (ex. tramvaie raportate
      // toate pe aceeași linie) – linia apare „de verificat”, fără scor și fără alerte de pluton
      var suspect = tot.v > Math.max(2 * tot.pl, tot.pl + 2);
      var vObs = median(speeds), mPerMin = pl.viteza ? pl.viteza * 1000 / 60 : null;
      var gaps = [], pluton = [], gol = [];
      if (mPerMin && pl.interval && !suspect) {
        for (var i = 1; i < enRoute.length; i++) {
          var g = (enRoute[i].cur.d - enRoute[i - 1].cur.d) / mPerMin;
          gaps.push(g);
          if (g < Math.max(CFG.bunchMin, pl.interval * CFG.bunchFrac)) {
            pluton.push([enRoute[i - 1], enRoute[i], g]);
            enRoute[i - 1].pluton = enRoute[i].pluton = true;
          }
          if (g > pl.interval * CFG.gapFrac) gol.push([enRoute[i - 1], enRoute[i], g]);
        }
      }
      var cv = null;
      if (gaps.length >= 2) {
        var mean = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
        cv = mean ? Math.sqrt(gaps.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / gaps.length) / mean : null;
      }
      var opriti = vs.filter(function (s) { return !s.cap && s.oprit >= CFG.stopMin; });
      // linia nu are curse în orar acum (vehicul care așteaptă / în afara programului): fără scor
      var parts = suspect || !tot.pl ? {} : {
        serviciu: tot.pl ? clamp01(tot.v / tot.pl) : null,
        viteza: vObs != null && pl.viteza ? clamp01(vObs / pl.viteza) : null,
        regularitate: gaps.length ? clamp01(1 - Math.min(1, cv != null ? cv : 0) - 0.15 * pluton.length) : null
      };
      var sc = score(parts);
      linii[k] = {
        key: k, linie: r.linie, tip: r.tip, retea: r.retea, spre: r.spre, culoare: r.culoare,
        planificat: pl, vehicule: vs.length, linieVehicule: tot.v, liniePlanificat: tot.pl, pePista: enRoute.length, viteza: vObs, intervale: gaps, cv: cv,
        pluton: pluton.length, goluri: gol.length, opriti: opriti.length, parti: parts, scor: sc, nivel: level(sc), suspect: suspect
      };
      var nume = (r.tip === 'tramvai' ? 'Tramvaiul ' : 'Autobuzul ') + r.linie + ' spre ' + r.spre;
      pluton.forEach(function (p) {
        alerte.push({ tip: 'pluton', key: k, grav: 2, lat: p[1].cur.lat, lng: p[1].cur.lng,
          text: nume + ': două vehicule la ' + fmtMin(p[2]) + ' unul de altul (intervalul din orar: ' + fmtMin(pl.interval) + ').' });
      });
      gol.forEach(function (p) {
        alerte.push({ tip: 'gol', key: k, grav: 1, lat: (p[0].cur.lat + p[1].cur.lat) / 2, lng: (p[0].cur.lng + p[1].cur.lng) / 2,
          text: nume + ': gol de ' + fmtMin(p[2]) + ' între două vehicule (în orar: ' + fmtMin(pl.interval) + ').' });
      });
      if (tot.pl >= 2 && !tot.v && !tot.semnalat) {                     // o singură alertă pe linie
        tot.semnalat = true;
        alerte.push({ tip: 'lipsa', key: k, grav: 1, text: (r.tip === 'tramvai' ? 'Tramvaiul ' : 'Autobuzul ') + r.linie +
          ': niciun vehicul cu GPS pe traseu, orarul cere ' + tot.pl + '.' });
      }
      opriti.forEach(function (s) {
        alerte.push({ tip: 'oprit', key: k, grav: s.oprit >= 300 ? 2 : 1, lat: s.cur.lat, lng: s.cur.lng, id: s.id,
          text: nume + ' (vehiculul ' + (s.cur.nr || s.id) + ') stă de ' + fmtMin(s.oprit / 60) + ' în afara capetelor de linie.' });
      });
    });
    // tramvaie oprite unul lângă altul → probabilă blocare a liniei
    var trams = vehs.filter(function (s) { return s.cur.tip === 'tramvai' && !s.cap && s.oprit >= CFG.stopMin; });
    var used = {};
    trams.forEach(function (a) {
      if (used[a.id]) return;
      var grp = trams.filter(function (b) { return !used[b.id] && dist(a.cur, b.cur) < 400; });
      if (grp.length >= 2) {
        grp.forEach(function (b) { used[b.id] = 1; });
        alerte.push({ tip: 'blocaj', grav: 3, lat: a.cur.lat, lng: a.cur.lng,
          text: grp.length + ' tramvaie stau de peste ' + fmtMin(Math.min.apply(null, grp.map(function (b) { return b.oprit; })) / 60) +
            ' pe aceeași porțiune (liniile ' + uniq(grp.map(function (b) { return lineOf(plan, b.key); })).join(', ') + ') – posibilă blocare.' });
      }
    });
    alerte.sort(function (a, b) { return b.grav - a.grav; });

    var L = Object.keys(linii).map(function (k) { return linii[k]; }), plTot = 0, vTot = 0;
    Object.keys(line).forEach(function (rid) { plTot += line[rid].pl; vTot += Math.min(line[rid].v, line[rid].pl); });
    var allSp = vehs.filter(function (s) { return s.key && !s.cap && s.viteza != null; }).map(function (s) { return s.viteza; });
    var scored = L.filter(function (l) { return l.scor != null; });
    return {
      t: now, ora: lt, linii: linii, vehicule: vehs, alerte: alerte,
      retea: {
        planificate: plTot, cuGps: vehs.filter(function (s) { return s.key; }).length, faraLinie: vehs.filter(function (s) { return !s.key; }).length,
        serviciu: plTot ? Math.min(1, vTot / plTot) : null, viteza: median(allSp),
        pluton: L.reduce(function (a, l) { return a + l.pluton; }, 0), opriti: L.reduce(function (a, l) { return a + l.opriti; }, 0),
        scor: scored.length ? Math.round(scored.reduce(function (a, l) { return a + l.scor * Math.max(1, l.planificat.vehicule); }, 0) /
          scored.reduce(function (a, l) { return a + Math.max(1, l.planificat.vehicule); }, 0)) : null
      }
    };
  }

  /* Harta vitezei: din pozițiile succesive ale vehiculelor (ultimele `win` secunde), viteza mediană pe tronsoane de
   * CFG.bin metri ale fiecărei linii-sens. Întoarce [{ key, d0, d1, viteza, n, coords }]. */
  function speedBins(tr, win) {
    var acc = {}, t0 = tr.t - (win || 30 * 60);
    Object.keys(tr.hist).forEach(function (id) {
      var h = tr.hist[id];
      for (var i = 1; i < h.length; i++) {
        var a = h[i - 1], b = h[i], dt = b.ts - a.ts;
        if (b.ts < t0 || !a.key || a.key !== b.key || dt <= 0 || dt > CFG.segMaxDt) continue;
        var dd = b.d - a.d;
        if (dd < -20 || dd > dt * 25) continue;                             // înapoi sau > 90 km/h: altă potrivire
        dd = Math.max(0, dd);
        var kmh = dd / dt * 3.6, d0 = Math.min(a.d, b.d), d1 = Math.max(a.d, b.d);
        for (var bi = Math.floor(d0 / CFG.bin); bi <= Math.floor(d1 / CFG.bin); bi++) {
          var k = a.key + '|' + bi;
          (acc[k] = acc[k] || []).push(kmh);
        }
      }
    });
    return Object.keys(acc).map(function (k) {
      var p = k.split('|'), sh = tr.shapes[p[0]], bi = +p[1], d0 = bi * CFG.bin, d1 = Math.min(sh.len, d0 + CFG.bin);
      return { key: p[0], d0: d0, d1: d1, viteza: median(acc[k]), n: acc[k].length, coords: slice(sh, d0, d1) };
    });
  }

  var SPEED_CLASSES = [[25, '#2fa66a', '> 25 km/h'], [15, '#9cc43b', '15–25'], [10, '#e5b22e', '10–15'], [5, '#e5732e', '5–10'], [0, '#d8433b', '< 5 km/h']];
  function speedColor(k) { for (var i = 0; i < SPEED_CLASSES.length; i++) if (k >= SPEED_CLASSES[i][0]) return SPEED_CLASSES[i][1]; return SPEED_CLASSES[4][1]; }

  function dist(a, b) {
    return Math.hypot((a.lng - b.lng) * R_LON * Math.cos(a.lat * Math.PI / 180), (a.lat - b.lat) * R_LAT);
  }
  function uniq(a) { return a.filter(function (x, i) { return x != null && a.indexOf(x) === i; }); }
  function lineOf(plan, key) { return key && plan.rute[key] ? plan.rute[key].linie : null; }
  function fmtMin(m) {
    if (m == null || !isFinite(m)) return '–';
    if (m < 1) return Math.round(m * 60) + ' s';
    return (m < 10 ? Math.round(m * 2) / 2 : Math.round(m)).toString().replace('.', ',') + ' min';
  }

  /* Înregistrările compacte din /live/istoric: [id, ruta, sens, lat×1e5, lng×1e5, ts, viteză, tip(0 = tramvai)]. */
  function unpack(rec) {
    return {
      actualizat: rec.t,
      vehicule: rec.v.map(function (a) {
        return { id: a[0], nr: a[8] || null, ruta: a[1], sens: a[2], lat: a[3] / 1e5, lng: a[4] / 1e5, ts: a[5], v: a[6], tip: a[7] === 0 ? 'tramvai' : 'autobuz' };
      })
    };
  }

  return {
    CFG: CFG, LEVELS: LEVELS, SPEED_CLASSES: SPEED_CLASSES, prepareShape: prepareShape, project: project, slice: slice,
    localTime: localTime, planned: planned, Tracker: Tracker, vehicleState: vehicleState, score: score, level: level,
    analyze: analyze, speedBins: speedBins, speedColor: speedColor, median: median, fmtMin: fmtMin, unpack: unpack
  };
});
