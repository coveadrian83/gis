/* „Drumul Unirii” – conduci de la Ungheni la Târgu Mureș pe loturile A8.
 * Distanța parcursă înaintează calendarul (nov. 2026 → dec. 2030 dacă nu lovești nimic);
 * fiecare obstacol lovit adaugă luni, fiecare soluție culeasă scade luni. Datele loturilor vin din core.js. */
(function () {
  'use strict';
  var C = window.A8Core, $ = function (id) { return document.getElementById(id); };

  var ORDINE = ['T4', 'T3', 'T2', 'T1', 'III', '2C', '2B', '2A', '1D', '1C', '1B', 'I'];   // de la Ungheni spre vest
  var LUNI_BAZA = 49;                       // nov. 2026 → dec. 2030
  var LUNI = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.'];
  var VEDERE_KM = 4.2;                      // cât din drum se vede pe ecran

  /* Obstacole (luni > 0) și soluții (luni < 0). */
  var TIP = {
    contestatie: { et: ['Contestație', 'CNSC'], luni: 4, text: 'Contestație la CNSC: procedura se reia, iar contractul așteaptă.' },
    reevaluare: { et: ['Reevaluare', 'ofertă'], luni: 3, text: 'Instanța cere reevaluarea ofertei câștigătoare.' },
    suspendare: { et: ['Suspendare', 'CAB'], luni: 6, text: 'Curtea de Apel suspendă executarea contractului până la soluționarea cauzei.' },
    insolventa: { et: ['Insolvență', 'constructor'], luni: 5, text: 'Un constructor neplătit sau cu o cerere de insolvență oprește lucrările.' },
    faraAC: { et: ['Fără', 'autorizație'], luni: 3, text: 'Proiectul nu are autorizație de construire: execuția nu poate începe.' },
    faraOrdin: { et: ['Fără ordin', 'de începere'], luni: 4, text: 'Contractul e semnat, dar ordinul de începere nu e emis: termenele nu curg.' },
    arierate: { et: ['Arierate'], luni: 2, text: 'Situațiile de lucrări nu se plătesc la timp; constructorul încetinește.' },
    alunecare: { et: ['Alunecare', 'de teren'], luni: 3, text: 'Studiile geotehnice cer refacerea unei părți din proiect.' },
    rectificare: { et: ['Rectificare', 'bugetară'], luni: 2, text: 'Banii vin abia după rectificarea bugetară.' },
    alegeri: { et: ['Alegeri'], luni: 3, text: 'Noul guvern „reevaluează” marile proiecte.' },
    exproprieri: { et: ['Exproprieri'], luni: 2, text: 'Terenurile nu sunt expropriate la timp.' },
    arheologie: { et: ['Arheologie'], luni: 2, text: 'Descărcare arheologică: accesul la terenuri se negociază la Prefectură.' },
    mobilizare: { et: ['Mobilizare', 'slabă'], luni: 2, text: 'Puțini oameni și utilaje pe șantier.' },
    iarna: { et: ['Iarnă', 'grea'], luni: 1, text: 'Iarna oprește lucrările pe munte.' },
    ordin: { et: ['Ordin', 'emis'], luni: -2, text: 'Ordinul de începere e emis: proiectarea pornește.' },
    ac: { et: ['Autorizație', 'emisă'], luni: -2, text: 'Autorizația de construire e emisă: execuția poate începe.' },
    plata: { et: ['Plata', '30 de zile'], luni: -1, text: 'Lucrările se plătesc la 30 de zile (Program, Transporturi M2).' },
    safe: { et: ['Bani', 'SAFE'], luni: -1, text: 'Plată SAFE aprobată: banii sunt asigurați până la 31.12.2030.' },
    ue: { et: ['Fonduri UE', '2028–2034'], luni: -2, text: 'A8 primește bani din noul exercițiu european.' },
    raportare: { et: ['Raportare', 'MVA'], luni: -1, text: 'Raportare publică lunară pe fiecare lot (propunere MVA): blocajele se văd și se rezolvă mai repede.' },
    credite: { et: ['Credite', 'multianuale'], luni: -1, text: 'Credite de angajament multianuale: finanțarea e asigurată pe toată durata contractului.' }
  };

  /* Ce te așteaptă pe fiecare lot: obstacolele și soluțiile tipice, cu explicațiile reale (oct. 2026). */
  var PE_LOT = {
    T4: { rau: ['reevaluare', 'suspendare', 'contestatie', 'exproprieri'], bun: ['safe', 'ordin'],
      text: { reevaluare: 'Iași – Ungheni: hotărârea definitivă din 13.10.2026 cere reevaluarea ofertei Itinera (Erbașu era la 0,06 puncte).', suspendare: 'Iași – Ungheni: contractul e suspendat de instanță din 5.08.2026.' } },
    T3: { rau: ['suspendare', 'insolventa', 'contestatie', 'arheologie'], bun: ['safe', 'raportare'],
      text: { suspendare: 'Lețcani – Iași: la 28.10.2026, Curtea de Apel a suspendat contractul cu FCC; termen 18.11.2026.', insolventa: 'Lețcani – Iași: cerere de insolvență împotriva FCC la Tribunalul București (26.10.2026).' } },
    T2: { rau: ['contestatie', 'reevaluare', 'contestatie', 'faraOrdin'], bun: ['safe', 'ordin'],
      text: { reevaluare: 'Târgu Frumos – Lețcani: oferta Danlin XXL (4,57 mld. lei) se reevaluează (CAB, 13.10.2026).', contestatie: 'Târgu Frumos – Lețcani: singurul tronson ieșean fără contract; contestațiile Strabag, Makyol și Kalyon.' } },
    T1: { rau: ['arheologie', 'exproprieri', 'faraAC'], bun: ['ac', 'safe', 'plata'],
      text: { arheologie: 'Moțca – Târgu Frumos: ședință la Prefectura Iași (8.10.2026) pentru accesul la terenuri pentru arheologie.', faraAC: 'Moțca – Târgu Frumos: autorizarea e înscrisă abia pentru august 2027.' } },
    III: { rau: ['mobilizare', 'arierate', 'mobilizare'], bun: ['plata', 'raportare'],
      text: { mobilizare: 'Leghin – Moțca: 12% progres fizic în aug. 2026; ritmul nu susține termenul (bilanț MVA).' } },
    '2C': { rau: ['faraOrdin', 'faraOrdin', 'exproprieri', 'alunecare'], bun: ['ordin', 'ue'],
      text: { faraOrdin: 'Pipirig – Leghin: contract semnat în aprilie 2025, ordinul de începere a proiectării încă neemis.' } },
    '2B': { rau: ['alunecare', 'iarna', 'faraAC', 'arierate'], bun: ['ue', 'credite'],
      text: { alunecare: 'Grințieș – Pipirig: ≈70% lucrări de artă și tuneluri; investigațiile de teren sunt în curs.' } },
    '2A': { rau: ['faraAC', 'alunecare', 'iarna'], bun: ['ac', 'ue'],
      text: { faraAC: 'Ditrău – Grințieș: proiectul pentru autorizație (PAC) nu era transmis în iulie 2026.' } },
    '1D': { rau: ['iarna', 'arierate'], bun: ['plata'], text: {} },
    '1C': { rau: ['alunecare', 'faraAC', 'iarna', 'exproprieri'], bun: ['ue', 'credite'],
      text: { alunecare: 'Sărățeni – Joseni: campaniile de teren rămase pot prelungi proiectarea.' } },
    '1B': { rau: ['faraAC', 'rectificare', 'faraAC'], bun: ['ac', 'plata'],
      text: { faraAC: 'Miercurea Nirajului – Sărățeni: constructorul așteaptă autorizația de ≈6 luni.', rectificare: 'Miercurea Nirajului – Sărățeni: autorizația e legată de rectificarea bugetară.' } },
    I: { rau: ['arierate'], bun: ['raportare'], text: {} }
  };

  var SCENARII = {
    realist: { nume: 'Realist', descriere: 'Blocajele de azi, în ritmul de azi.', rau: 1, bun: 1 },
    program: { nume: 'Programul de guvernare', descriere: 'Avize rapide, credite multianuale, plata în 30 de zile.', rau: 0.9, bun: 1.4 },
    mva: { nume: 'Agenda Moldova Vrea Autostradă', descriere: 'Deblocările cerute de MVA, raportare lunară, A8 de securitate națională.', rau: 0.75, bun: 1.8 },
    austeritate: { nume: 'Austeritate', descriere: 'Bani puțini, arierate și rectificări.', rau: 1.25, bun: 0.6, extra: ['arierate', 'rectificare'] }
  };

  /* ---------- Traseul ---------- */
  var SEG = [], KM = 0;
  ORDINE.forEach(function (id) {
    var inf = C.info(id);
    SEG.push({ id: id, inf: inf, de: KM, la: KM + inf.km });
    KM += inf.km;
  });
  function segLa(km) { for (var i = 0; i < SEG.length; i++) if (km < SEG[i].la) return SEG[i]; return SEG[SEG.length - 1]; }
  function stareLa(seg) {
    var st = seg.inf.stare;
    if (st === 'executie' || st === 'deschis') return 'executie';
    if (st === 'proiectare') return 'proiectare';
    return 'blocat';
  }
  var STARE_TXT = { executie: 'în execuție', proiectare: 'în proiectare', blocat: 'blocat' };
  var STARE_LOT = { executie: 'în execuție', proiectare: 'în proiectare', neatribuit: 'fără contract', suspendat: 'suspendat în instanță', neactivat: 'fără ordin de începere' };

  /* Generator determinist, ca un traseu să poată fi rejucat. */
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) >>> 0;
      var t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function construiesteTraseu(scen, seed) {
    var r = rng(seed), obiecte = [], sc = SCENARII[scen];
    SEG.forEach(function (s) {
      var st = stareLa(s), pool = PE_LOT[s.id];
      var dens = st === 'blocat' ? 0.3 : st === 'proiectare' ? 0.21 : 0.12;
      if (s.inf.lent) dens += 0.08;
      var nRau = Math.max(1, Math.round(s.inf.km * dens * sc.rau)), nBun = Math.max(1, Math.round(s.inf.km * 0.05 * sc.bun));
      var tipuri = [];
      for (var i = 0; i < nRau; i++) tipuri.push({ tip: (sc.extra && r() < 0.2) ? sc.extra[Math.floor(r() * sc.extra.length)] : pool.rau[Math.floor(r() * pool.rau.length)], bun: false });
      for (i = 0; i < nBun; i++) tipuri.push({ tip: pool.bun[Math.floor(r() * pool.bun.length)], bun: true });
      // amestecăm și așezăm de-a lungul lotului, cu distanță minimă între obiecte
      for (i = tipuri.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = tipuri[i]; tipuri[i] = tipuri[j]; tipuri[j] = t; }
      var pas = (s.la - s.de - 0.6) / tipuri.length;
      tipuri.forEach(function (o, k) {
        var km = s.de + 0.5 + k * pas + r() * pas * 0.6;
        var bariera = !o.bun && r() < 0.3, banda = Math.floor(r() * 3);
        obiecte.push({ km: km, tip: o.tip, bun: o.bun, lot: s.id, benzi: bariera ? (banda === 2 ? [1, 2] : [banda, banda + 1]) : [banda], lovit: false });
      });
    });
    // alegerile parlamentare din decembrie 2028, cam pe la mijlocul drumului (în calendar)
    var kmAlegeri = KM * (25 / LUNI_BAZA);
    obiecte.push({ km: kmAlegeri, tip: 'alegeri', bun: false, lot: segLa(kmAlegeri).id, benzi: [0, 1], lovit: false, global: true });
    obiecte.sort(function (a, b) { return a.km - b.km; });
    return obiecte;
  }

  /* ---------- Starea jocului ---------- */
  var cv = $('c'), ctx = cv.getContext('2d'), W = 480, H = 720, DPR = 1;
  var S = null, scenAles = 'realist', culori = {}, ultimTs = 0, rulare = false, toastT = null;

  function citesteCulori() {
    var cs = getComputedStyle(document.documentElement);
    ['camp', 'camp2', 'munte', 'munte2', 'stanca', 'asfalt', 'santier', 'blocat', 'marcaj', 'galben', 'masina', 'geam', 'ok', 'bad', 'warn', 'accent', 'ink', 'panel', 'line'].forEach(function (k) {
      culori[k] = cs.getPropertyValue('--' + k).trim();
    });
  }

  function dimensiuni() {
    var lat = Math.min($('scena').clientWidth || 480, 480);
    W = lat; H = Math.round(Math.min(lat * 1.45, Math.max(420, window.innerHeight * 0.72)));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function nou(scen) {
    S = { scen: scen, d: 0, luni: 0, banda: 1, x: 1, obiecte: construiesteTraseu(scen, (Date.now() & 0xffff) + 7), jurnal: [], lovituri: 0, culese: 0, flash: 0, incet: 0, segCurent: null, terminat: false, pauza: false };
  }

  function dataLa(luni) {
    var total = 10 + Math.round(luni);   // 0 = noiembrie 2026
    var an = 2026 + Math.floor(total / 12);
    return LUNI[((total % 12) + 12) % 12] + ' ' + an;
  }
  function luniTotal() { return LUNI_BAZA * Math.min(1, S.d / KM) + S.luni; }

  /* ---------- Desenul ---------- */
  function drumX() { var lat = Math.min(W * 0.62, 300); return { x0: (W - lat) / 2, lat: lat }; }
  function yLa(km) { return H * 0.8 - (km - S.d) * (H / VEDERE_KM); }
  function hash(n) { var x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

  function deseneaza() {
    var dr = drumX(), x0 = dr.x0, lat = dr.lat, banda = lat / 3;
    // fundalul: câmpie spre est, munte pe secțiunea montană
    ctx.fillStyle = culori.camp; ctx.fillRect(0, 0, W, H);
    for (var k = Math.floor(S.d - 1.5); k < S.d + VEDERE_KM + 1; k += 0.5) {
      var seg = segLa(Math.max(0, k)), munte = seg.inf.munte, y = yLa(k);
      ctx.fillStyle = munte ? culori.munte : ((Math.floor(k * 2) % 2) ? culori.camp : culori.camp2);
      ctx.fillRect(0, y - H / VEDERE_KM * 0.5, W, H / VEDERE_KM * 0.5 + 1);
      for (var p = 0; p < 2; p++) {
        var h = hash(Math.floor(k * 2) * 3 + p), side = p === 0 ? h * (x0 - 26) + 6 : x0 + lat + 20 + h * (W - x0 - lat - 30);
        if (munte) {
          ctx.fillStyle = h > 0.5 ? culori.munte2 : culori.stanca;
          ctx.beginPath(); ctx.moveTo(side, y - 4); ctx.lineTo(side + 14, y - 34); ctx.lineTo(side + 28, y - 4); ctx.fill();
        } else {
          ctx.fillStyle = culori.camp2;
          ctx.beginPath(); ctx.arc(side + 8, y - 12, 7 + h * 5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // suprafața șoselei, pe loturi
    SEG.forEach(function (s) {
      var yA = yLa(s.la), yB = yLa(s.de);
      if (yB < -20 || yA > H + 20) return;
      var st = stareLa(s);
      ctx.fillStyle = st === 'executie' ? culori.asfalt : st === 'proiectare' ? culori.santier : culori.blocat;
      ctx.fillRect(x0, Math.max(yA, -20), lat, Math.min(yB, H + 20) - Math.max(yA, -20));
      if (st === 'blocat') {          // hașuri de șantier oprit
        ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 6;
        for (var hy = Math.max(yA, -20) - ((S.d * 60) % 24); hy < Math.min(yB, H + 20); hy += 24) {
          ctx.beginPath(); ctx.moveTo(x0, hy); ctx.lineTo(x0 + 24, hy - 24); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x0 + lat - 24, hy); ctx.lineTo(x0 + lat, hy - 24); ctx.stroke();
        }
      }
      // portalul de la intrarea pe lot
      if (yB > -30 && yB < H + 30) {
        ctx.fillStyle = culori.ok; ctx.fillRect(x0 - 6, yB - 22, lat + 12, 20);
        ctx.fillStyle = '#fff'; ctx.font = '700 11px ' + getComputedStyle(document.body).fontFamily;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(scurt(s.inf.nume, lat), x0 + lat / 2, yB - 12);
      }
    });
    // marginile și marcajul
    ctx.fillStyle = culori.marcaj; ctx.fillRect(x0 - 3, 0, 3, H); ctx.fillRect(x0 + lat, 0, 3, H);
    ctx.fillStyle = culori.galben;
    var faza = (S.d * (H / VEDERE_KM)) % 40;
    for (var b = 1; b < 3; b++) for (var yy = -40 + faza; yy < H; yy += 40) ctx.fillRect(x0 + b * banda - 2, yy, 4, 20);
    // obiectele
    S.obiecte.forEach(function (o) {
      var y = yLa(o.km);
      if (y < -60 || y > H + 60) return;
      var xa = x0 + o.benzi[0] * banda + 6, wl = banda * o.benzi.length - 12;
      if (o.lovit && !o.bun) ctx.globalAlpha = 0.35;
      if (o.lovit && o.bun) return;
      if (o.bun) {
        ctx.fillStyle = culori.ok; rotunjit(xa + 6, y - 20, wl - 12, 40, 20); ctx.fill();
      } else {
        ctx.fillStyle = o.benzi.length > 1 ? culori.bad : culori.warn; rotunjit(xa, y - 20, wl, 40, 6); ctx.fill();
        if (o.benzi.length > 1) {                // barieră: dungi albe
          ctx.save(); rotunjit(xa, y - 20, wl, 40, 6); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,.25)';
          for (var dx = -40; dx < wl + 40; dx += 22) { ctx.beginPath(); ctx.moveTo(xa + dx, y + 20); ctx.lineTo(xa + dx + 12, y + 20); ctx.lineTo(xa + dx + 32, y - 20); ctx.lineTo(xa + dx + 20, y - 20); ctx.fill(); }
          ctx.restore();
        }
      }
      var et = TIP[o.tip].et;
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + (wl < 70 ? 10 : 12) + 'px ' + getComputedStyle(document.body).fontFamily;
      if (et.length > 1) { ctx.fillText(et[0], xa + wl / 2, y - 7); ctx.font = '400 ' + (wl < 70 ? 9 : 11) + 'px ' + getComputedStyle(document.body).fontFamily; ctx.fillText(et[1], xa + wl / 2, y + 8); }
      else ctx.fillText(et[0], xa + wl / 2, y);
      ctx.globalAlpha = 1;
    });
    // mașinuța
    var cx = x0 + (S.x + 0.5) * banda, cy = H * 0.8, mw = Math.min(banda * 0.5, 40), mh = mw * 1.8;
    if (S.flash > 0 && Math.floor(S.flash * 12) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; rotunjit(cx - mw / 2 + 3, cy - mh / 2 + 4, mw, mh, 9); ctx.fill();
    ctx.fillStyle = '#111'; [[-1, -0.3], [1, -0.3], [-1, 0.3], [1, 0.3]].forEach(function (r) { ctx.fillRect(cx + r[0] * mw / 2 - 3, cy + r[1] * mh - 7, 6, 14); });
    ctx.fillStyle = culori.masina; rotunjit(cx - mw / 2, cy - mh / 2, mw, mh, 9); ctx.fill();
    ctx.fillStyle = culori.geam; rotunjit(cx - mw / 2 + 5, cy - mh / 2 + 10, mw - 10, mh * 0.22, 4); ctx.fill();
    rotunjit(cx - mw / 2 + 6, cy + mh * 0.18, mw - 12, mh * 0.14, 3); ctx.fill();
    ctx.fillStyle = culori.galben; ctx.fillRect(cx - mw / 2 + 3, cy - mh / 2 + 2, 6, 4); ctx.fillRect(cx + mw / 2 - 9, cy - mh / 2 + 2, 6, 4);
    ctx.globalAlpha = 1;
  }
  function rotunjit(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function scurt(t, lat) { var max = Math.floor(lat / 6.2); return t.length > max ? t.slice(0, max - 1) + '…' : t; }

  /* ---------- Bucla ---------- */
  function pas(dt) {
    if (S.terminat || S.pauza) return;
    var viteza = (2.0 + 0.9 * (S.d / KM)) * (S.incet > 0 ? 0.5 : 1) * (location.hash === '#rapid' ? 15 : 1);
    S.d = Math.min(KM, S.d + viteza * dt);
    S.x += (S.banda - S.x) * Math.min(1, dt * 12);
    if (S.flash > 0) S.flash -= dt;
    if (S.incet > 0) S.incet -= dt;
    // coliziuni
    var bandaMasina = Math.round(S.x);
    S.obiecte.forEach(function (o) {
      if (o.lovit || Math.abs(o.km - S.d) > 0.13) return;
      if (o.benzi.indexOf(bandaMasina) < 0) return;
      o.lovit = true;
      var t = TIP[o.tip], txt = (PE_LOT[o.lot].text && PE_LOT[o.lot].text[o.tip]) || t.text;
      S.luni += t.luni;
      S.jurnal.push({ km: o.km, lot: o.lot, tip: o.tip, luni: t.luni, bun: o.bun });
      if (o.bun) { S.culese++; } else { S.lovituri++; S.flash = 0.8; S.incet = 0.6; }
      toast((o.bun ? 'Soluție: ' : 'Blocaj: ') + t.et.join(' ') + ' · ' + (t.luni > 0 ? '+' : '−') + Math.abs(t.luni) + (Math.abs(t.luni) === 1 ? ' lună' : ' luni'), txt, o.bun);
      jurnal();
    });
    // intrarea pe un lot nou
    var seg = segLa(S.d);
    if (seg !== S.segCurent) {
      S.segCurent = seg;
      $('hudLot').textContent = seg.inf.nume;
      $('hudStare').textContent = seg.inf.km.toFixed(1).replace('.', ',') + ' km · ' + (STARE_LOT[seg.inf.stare] || seg.inf.stare);
      harta();
    }
    $('hudData').textContent = dataLa(luniTotal());
    $('hudKm').textContent = Math.max(0, Math.round(KM - S.d)) + ' km până la Târgu Mureș';
    var pin = document.querySelector('#harta .pin');
    if (pin) pin.style.left = (S.d / KM * 100).toFixed(2) + '%';
    if (S.d >= KM) final();
  }

  function bucla(ts) {
    if (!rulare) return;
    var dt = Math.min(0.05, (ts - (ultimTs || ts)) / 1000);
    ultimTs = ts;
    pas(dt);
    deseneaza();
    requestAnimationFrame(bucla);
  }

  /* ---------- Interfața ---------- */
  function toast(titlu, text, bun) {
    var el = $('toast');
    el.className = 'toast on' + (bun ? ' bun' : '');
    el.innerHTML = '<b></b><span></span>';
    el.firstChild.textContent = titlu; el.lastChild.textContent = text;
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.className = 'toast' + (bun ? ' bun' : ''); }, 2600);
  }

  function harta() {
    var el = $('harta'), html = '';
    SEG.forEach(function (s) {
      var st = stareLa(s), c = st === 'executie' ? 'var(--ok)' : st === 'proiectare' ? 'var(--accent)' : 'var(--bad)';
      html += '<i style="flex:' + s.inf.km.toFixed(1) + ';background:' + c + (S && S.segCurent === s ? ';outline:2px solid var(--ink)' : '') + '" title="' + s.inf.nume + '"></i>';
    });
    el.innerHTML = html + '<span class="pin" style="left:' + (S ? (S.d / KM * 100).toFixed(2) : 0) + '%"></span>';
    // orașele de pe traseu, la kilometrul lor real
    var cap = $('capete');
    if (cap && !cap.querySelector('.mij')) {
      [['Iași', 'T3'], ['Târgu Neamț', 'T1'], ['Ditrău', '1D']].forEach(function (o) {
        var s = SEG.filter(function (x) { return x.id === o[1]; })[0], sp = document.createElement('span');
        sp.className = 'mij'; sp.textContent = o[0]; sp.style.left = (s.la / KM * 100).toFixed(1) + '%';
        cap.appendChild(sp);
      });
    }
  }

  function jurnal() {
    var el = $('jurnal');
    if (!S.jurnal.length) { el.innerHTML = '<li><span>Drum liber până acum.</span></li>'; return; }
    el.innerHTML = S.jurnal.slice().reverse().map(function (j) {
      var t = TIP[j.tip];
      return '<li class="' + (j.bun ? 'bun' : 'rau') + '"><span>' + t.et.join(' ') + ' · ' + C.info(j.lot).nume + '</span><b>' + (j.luni > 0 ? '+' : '−') + Math.abs(j.luni) + ' l.</b></li>';
    }).join('');
  }

  function verdict(luni) {
    var total = 10 + Math.round(luni), an = 2026 + Math.floor(total / 12);
    if (an <= 2030) return 'Ai ajuns la termenul din programul de guvernare. Pe drumul real, asta ar cere ca niciun lot să nu se mai blocheze.';
    if (an <= 2033) return 'Ai ajuns în intervalul estimat de Moldova Vrea Autostradă (2031–2033), cu proiectare riguroasă, bani asigurați și o societate civilă vigilentă.';
    if (an <= 2035) return 'Ai ajuns cam când estimează Pro Infrastructură: încă 7–8 ani din 2026.';
    return 'Ai ajuns după 2035. Blocajele s-au adunat ca în scenariile de austeritate și instabilitate.';
  }

  function final() {
    S.terminat = true; rulare = false;
    var L = luniTotal(), data = dataLa(L), rau = 0, bun = 0;
    S.jurnal.forEach(function (j) { if (j.bun) bun -= j.luni; else rau += j.luni; });
    var best = null;
    try { best = JSON.parse(localStorage.getItem('drumul-unirii-best') || 'null'); } catch (e) { best = null; }
    var record = !best || L < best.luni;
    if (record) { try { localStorage.setItem('drumul-unirii-best', JSON.stringify({ luni: L, data: data, scen: S.scen })); } catch (e) { /* fără stocare */ } }
    var el = $('final');
    el.hidden = false;
    el.innerHTML = '<p class="kicker" style="color:#cfd8d3">Ai ajuns la Târgu Mureș</p><div class="mare">' + data + '</div>' +
      '<p>' + verdict(L) + '</p>' +
      '<div class="repere"><div><span>Drumul fără blocaje</span><b>dec. 2030</b></div><div><span>Blocaje lovite: ' + S.lovituri + '</span><b>+' + rau + ' luni</b></div><div><span>Soluții culese: ' + S.culese + '</span><b>−' + bun + ' luni</b></div>' +
      (best && !record ? '<div><span>Cel mai bun drum al tău</span><b>' + best.data + '</b></div>' : '') + '</div>' +
      '<p class="note" style="color:#cfd8d3">Scenariu: ' + SCENARII[S.scen].nume + '. Termenele de comparație: programul de guvernare 2030, Moldova Vrea Autostradă 2031–2033, Pro Infrastructură 2033–2034.</p>' +
      '<div class="btns"><button type="button" class="btn" id="iarasi">Încă un drum</button><button type="button" class="btn sec" id="copiaza">Copiază rezultatul</button></div>';
    $('iarasi').addEventListener('click', ecranStart);
    $('copiaza').addEventListener('click', function () {
      var t = 'Drumul Unirii: am ajuns cu mașinuța de la Ungheni la Târgu Mureș în ' + data + ' (' + S.lovituri + ' blocaje, ' + S.culese + ' soluții, scenariul ' + SCENARII[S.scen].nume + '). ' + location.href;
      var b = $('copiaza');
      try { navigator.clipboard.writeText(t).then(function () { b.textContent = 'Copiat ✓'; }, function () { b.textContent = 'Nu s-a putut copia'; }); } catch (e) { b.textContent = 'Nu s-a putut copia'; }
    });
    $('iarasi').focus();
  }

  function ecranStart() {
    $('final').hidden = true;
    $('start').hidden = false;
    $('scenarii').innerHTML = Object.keys(SCENARII).map(function (k) {
      var s = SCENARII[k];
      return '<button type="button" data-k="' + k + '" class="' + (k === scenAles ? 'on' : '') + '" aria-pressed="' + (k === scenAles) + '"><b>' + s.nume + '</b><small>' + s.descriere + '</small></button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#scenarii button'), function (b) {
      b.addEventListener('click', function () { scenAles = b.getAttribute('data-k'); ecranStart(); });
    });
    nou(scenAles); harta(); jurnal(); deseneaza();
  }

  function porneste() {
    $('start').hidden = true;
    nou(scenAles); S.segCurent = null; harta(); jurnal();
    toast('Start: podul de la Ungheni', 'Podul peste Prut e la 56% (20.10.2026), cu termen în decembrie 2027. Drumul spre vest începe pe un tronson suspendat.', true);
    rulare = true; ultimTs = 0;
    requestAnimationFrame(bucla);
  }

  function muta(dir) { if (S && !S.terminat) S.banda = Math.max(0, Math.min(2, S.banda + dir)); }

  document.addEventListener('keydown', function (e) {
    if (!S || S.terminat || !$('start').hidden) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { muta(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { muta(1); e.preventDefault(); }
    else if (e.key === 'p' || e.key === 'P') { S.pauza = !S.pauza; if (S.pauza) toast('Pauză', 'Apasă P ca să continui.', true); }
  });
  cv.addEventListener('pointerdown', function (e) {
    if (S && S.pauza) { S.pauza = false; return; }
    var r = cv.getBoundingClientRect();
    muta(e.clientX - r.left < r.width / 2 ? -1 : 1);
  });
  $('stg').addEventListener('click', function () { muta(-1); });
  $('dr').addEventListener('click', function () { muta(1); });
  $('porneste').addEventListener('click', porneste);
  document.addEventListener('visibilitychange', function () { if (document.hidden && S && !S.terminat && rulare) { S.pauza = true; } });
  window.addEventListener('resize', function () { dimensiuni(); if (S) deseneaza(); });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var reCitire = function () { citesteCulori(); if (S) deseneaza(); };
    if (mq.addEventListener) mq.addEventListener('change', reCitire);
    new MutationObserver(reCitire).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  citesteCulori();
  dimensiuni();
  ecranStart();
})();
