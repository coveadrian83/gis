'use strict';
// Generatorul atlasului deplasărilor (studiul O–D, ZMI Iași).
//   node scripts/atlas/build.js --export <trips_raw.jsonl> --out <dosar> [--prev <stats.json anterior>]
// Exportul brut conține date personale: rămâne în afara repo-ului. Ieșirea: atlas.html (doar agregate)
// și stats.json (agregatele principale, pentru tabelul „Cum a evoluat acoperirea” la ediția următoare și pentru prezentare).
const fs = require('node:fs');
const path = require('node:path');
const { compute, isGPS, TPM, TPM13 } = require('./compute.js');
const { median } = require('./stats.js');
const L = require('./lib.js');
const ST = require('./static.json');
const { fmt, fix, mii, pct, de, nde, lista, esc, mapPanel, fig, legend, sw, swHatch, notes, table, section, barChart, hbarChart, anchor, shortName } = L;
const STATIC = path.join(__dirname, 'static');

const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const LS = ['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.'];
const zi = (d) => { const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd }; };
const perioada = (a, b) => { const A = zi(a), B = zi(b); return A.m === B.m ? `${A.d}–${B.d} ${LUNI[B.m - 1]} ${B.y}` : `${A.d} ${LS[A.m - 1]} – ${B.d} ${LS[B.m - 1]} ${B.y}`; };
const rng = (a) => { const lo = Math.min(...a), hi = Math.max(...a); return lo === hi ? fmt(lo) : fmt(lo) + '–' + fmt(hi); };
const mm = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const vac = (d) => d >= '2026-10-26' && d <= '2026-10-30';
const isZ = (id) => id && id.startsWith('IAS-');
const BARN = 'UAT-95088';
// Spearman (ranguri medii la egalitate)
function spearman(x, y) { const rk = (a) => { const s = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(a.length); for (let i = 0; i < s.length;) { let j = i; while (j + 1 < s.length && s[j + 1][0] === s[i][0]) j++; for (let k = i; k <= j; k++) r[s[k][1]] = (i + j) / 2; i = j + 1; } return r; };
  const a = rk(x), b = rk(y), n = a.length, ma = a.reduce((p, q) => p + q, 0) / n, mb = b.reduce((p, q) => p + q, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); }

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const file = arg('--export'), out = arg('--out') || '.', prev = arg('--prev') ? JSON.parse(fs.readFileSync(arg('--prev'), 'utf8')) : null;
  if (!file) { console.error('Folosire: node scripts/atlas/build.js --export <trips_raw.jsonl> --out <dosar> [--prev stats.json]'); process.exit(1); }
  const D = await compute(file);
  const R = D.rows, U = D.units, uname = (id) => U[id].n;
  const comName = (id) => (isZ(id) ? uname(id) : 'comuna ' + uname(id));
  const relName = (id) => (isZ(id) ? uname(id) : uname(id) + ' (comuna)');
  const zones = Object.values(U).filter((u) => u.zone), coms = Object.values(U).filter((u) => !u.zone);
  const IASI_UAT = 'UAT-95060';
  const S = {}; // statistici pentru stats.json
  S.n = D.n; S.participanti = D.participants; S.prima = D.first; S.ultima = D.last;
  S.zone10 = zones.filter((u) => u.t >= 10).length; S.zone50 = zones.filter((u) => u.t >= 50).length;
  S.com10 = coms.filter((u) => u.t >= 10).length; S.com0 = coms.filter((u) => u.t === 0).length; S.rel10 = D.rel.filter((r) => r.n >= 10 && r.o !== r.d && U[r.o] && U[r.d]).length;
  const sections = [];

  // ---------- 1. Acoperire
  {
    const q = (u) => (u.t === 0 ? 'var(--q0)' : u.t < 10 ? 'hatch' : u.t < 30 ? 'var(--q2)' : u.t < 50 ? 'var(--q3)' : 'var(--q4)');
    const fillZ = (id) => (id === IASI_UAT ? 'var(--q0)' : q(U[id]));
    const fillI = (id) => (isZ(id) ? q(U[id]) : id === IASI_UAT ? 'var(--q0)' : 'var(--ctx)');
    const lz = coms.filter((u) => u.t > 0).map((u) => ({ id: u.id, lines: [['num', String(u.t)]] }));
    const li = zones.map((u) => ({ id: u.id, lines: [['lbl', shortName(u.id)], ['num', String(u.t)]] }));
    const top = Object.values(U).filter((u) => u.t >= 50).sort((a, b) => b.t - a.t);
    const body = fig(mapPanel('zmi', { fill: fillZ, aria: 'Acoperire pe comunele ZMI: plecări plus sosiri', ptag: 'Zona Metropolitană · 27 de comune + Iași', labels: lz }),
      mapPanel('ias', { fill: fillI, aria: 'Acoperire pe cele 17 zone ale municipiului Iași', ptag: 'Municipiul Iași, mărit', labels: li })) + '\n' +
      legend('Plecări + sosiri pe unitate', [[sw('var(--q0)'), '0'], [swHatch, '1–9 · doar semnalare'], [sw('var(--q2)'), '10–29 · volum redus'], [sw('var(--q3)'), '30–49 · descriptiv robust'], [sw('var(--q4)'), '50+ · comparații']]) + '\n' +
      notes([`<b>${top.length} unități</b> au trecut de 50: ${top.map((u) => `${comName(u.id)} (${u.t})`).join(', ')}.`,
        zones.every((u) => u.t >= 10) ? 'În oraș, <b>toate cele 17 zone</b> au cel puțin 10 deplasări.' : `În oraș, <b>${S.zone10} din 17 zone</b> au cel puțin 10 deplasări.`,
        `<b>${S.com0} din 27 de comune</b> nu au nicio deplasare: aici promovarea nu a ajuns încă.`]) + '\n' +
      table('Datele hărții', ['Unitate', 'Plecări', 'Sosiri', 'Total'], Object.values(U).filter((u) => u.t > 0).sort((a, b) => b.t - a.t).map((u) => [u.n, u.o, u.d, u.t]));
    sections.push(section('acoperire', 'Acoperire teritorială', 'Harta 1', 'Unde avem destule date?', 'Fiecare unitate e colorată după numărul de deplasări care pleacă sau ajung acolo, cu pragurile de interpretare din metodologie.', body));
  }

  // ---------- 2. Plecări și sosiri
  {
    const maxO = Math.max(...Object.values(U).map((u) => u.o)), maxD = Math.max(...zones.map((u) => u.d));
    const circ = (panel, cls, key, k) => Object.values(U).filter((u) => u[key] > 0 && (panel === 'zmi' || u.zone)).sort((a, b) => b[key] - a[key])
      .map((u) => { const a = anchor(panel, u.id); return a ? `<circle cx="${a[0]}" cy="${a[1]}" r="${(k * Math.sqrt(u[key])).toFixed(1)}" class="${cls}" data-u="${u.id}"/>` : ''; }).join('');
    const fillBase = (panel) => (id) => (panel === 'zmi' ? (isZ(id) ? 'var(--ctx)' : id === IASI_UAT ? 'var(--ctx)' : 'var(--land)') : isZ(id) ? 'var(--land)' : 'var(--ctx)');
    const lz = Object.values(U).filter((u) => !u.zone && u.o >= 20).map((u) => ({ id: u.id, at: (() => { const a = anchor('zmi', u.id); return [a[0], a[1] + 26]; })(), lines: [['lbl', u.n]] }));
    const li = zones.filter((u) => u.d >= 10).map((u) => ({ id: u.id, lines: [['lbl', shortName(u.id)], ['num', String(u.d)]] }));
    const topO = Object.values(U).sort((a, b) => b.o - a.o).slice(0, 4);
    const sumD = zones.reduce((a, u) => a + u.d, 0), cop = U['IAS-Z05'], cen = U['IAS-Z15'];
    const dCom = coms.reduce((a, u) => a + u.d, 0);
    const body = fig(mapPanel('zmi', { fill: fillBase('zmi'), aria: 'Plecări pe unitate, cercuri proporționale', ptag: 'Plecări · Zona Metropolitană', extra: circ('zmi', 'dot-o', 'o', 34 / Math.sqrt(maxO)), labels: lz }),
      mapPanel('ias', { fill: fillBase('ias'), aria: 'Sosiri pe zonele Iașului, cercuri proporționale', ptag: 'Sosiri · Municipiul Iași', extra: circ('ias', 'dot-d', 'd', 46 / Math.sqrt(maxD)), labels: li })) + '\n' +
      legend('Cercuri proporționale', [['<span class="sw-dot dot-o"></span>', 'plecări'], ['<span class="sw-dot dot-d"></span>', 'sosiri']]) + '\n' +
      notes([`Cele mai multe plecări: ${topO.map((u) => (u.zone ? `<b>${u.n}</b>` : `comuna <b>${u.n}</b>`) + ` (${u.o})`).join(', ')}.`,
        `<b>Copou</b> primește ${cop.d} de deplasări, <b>Centru</b> ${cen.d}: împreună, ${Math.round((100 * (cop.d + cen.d)) / D.n)}% din toate sosirile.`,
        `Doar ${dCom} de deplasări au destinația într-o comună ZMI: drumul spre oraș domină eșantionul.`]) + '\n' +
      table('Datele hărții', ['Unitate', 'Plecări', 'Sosiri'], Object.values(U).filter((u) => u.t > 0).sort((a, b) => b.t - a.t).map((u) => [u.n, u.o, u.d]));
    sections.push(section('plecari-sosiri', 'Plecări și sosiri', 'Harta 2', 'Drumurile pornesc din periferie și converg spre Copou și Centru', 'Stânga: câte deplasări pornesc din fiecare unitate. Dreapta: câte ajung în fiecare zonă a orașului. Aria cercului e proporțională cu numărul de deplasări; în panoul mărit, cercurile sunt scalate la fel între ele.', body));
  }

  // ---------- 3. Fluxuri
  const FLOWS = {};
  {
    const F = D.rel.filter((r) => r.n >= 2 && r.o !== r.d && U[r.o] && U[r.d]);
    const maxN = Math.max(...F.map((r) => r.n));
    const draw = (panel) => { let s = '', nodes = new Set();
      for (const r of [...F].sort((a, b) => a.n - b.n)) { const a = anchor(panel, r.o), b = anchor(panel, r.d); if (!a || !b) continue;
        const k = r.o + '>' + r.d, cls = r.n >= 10 ? 'fl3' : r.n >= 5 ? 'fl2' : 'fl1', w = (1.2 + (9 * Math.sqrt(r.n)) / Math.sqrt(maxN)).toFixed(1);
        const mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.12, my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.12;
        s += `<path d="M${a[0]} ${a[1]} Q${mx.toFixed(1)} ${my.toFixed(1)} ${b[0]} ${b[1]}" class="flow ${cls}" stroke-width="${w}" data-f="${k}"/>`; nodes.add(r.o); nodes.add(r.d); FLOWS[k] = { a: relName(r.o), b: relName(r.d), n: r.n, p: r.p, med: r.med }; }
      for (const id of nodes) { const a = anchor(panel, id); if (a) s += `<circle cx="${a[0]}" cy="${a[1]}" r="3" class="node"/>`; }
      return s; };
    const base = (panel) => (id) => (panel === 'zmi' ? 'var(--land)' : isZ(id) ? 'var(--land)' : 'var(--ctx)');
    const lz = coms.filter((u) => u.o >= 30).map((u) => ({ id: u.id, at: (() => { const a = anchor('zmi', u.id); return [a[0], a[1] + 22]; })(), lines: [['lbl', u.n]] }));
    const li = zones.filter((u) => u.t >= 30).map((u) => ({ id: u.id, at: (() => { const a = anchor('ias', u.id); return [a[0], a[1] - 8]; })(), lines: [['lbl', shortName(u.id)]] }));
    const R10 = D.rel.filter((r) => r.n >= 10 && r.o !== r.d && U[r.o] && U[r.d]);
    const barnD = R10.filter((r) => r.o === BARN && isZ(r.d)).map((r) => uname(r.d));
    const body = fig(mapPanel('zmi', { fill: base('zmi'), aria: 'Fluxuri origine–destinație între comune și oraș', ptag: 'Zona Metropolitană', extra: draw('zmi'), labels: lz }),
      mapPanel('ias', { fill: base('ias'), aria: 'Fluxuri origine–destinație între zonele Iașului', ptag: 'Municipiul Iași, mărit', extra: draw('ias'), labels: li })) + '\n' +
      legend('Deplasări pe relație', [['<span class="sw-line fl3"></span>', '10 sau mai multe'], ['<span class="sw-line fl2"></span>', '5–9'], ['<span class="sw-line fl1"></span>', '2–4']]) + '\n' +
      notes([`<b>${R10.length} de relații</b> au trecut pragul de 10: ${R10.map((r) => `${relName(r.o)} → ${relName(r.d)} (${r.n}${r.p === 1 ? ', un singur participant' : ''})`).join(', ')}.`,
        barnD.length >= 2 ? `Comuna Bârnova trimite deja cel puțin 10 deplasări spre ${barnD.length} zone diferite: ${lista(barnD)}. Studențesc → Copou rămâne axa studenților, făcută mai ales cu autobuzul, tramvaiul sau pe jos.` : '',
        `Din ${D.rel.length} de relații distincte între unități, ${D.rel.filter((r) => r.n === 1).length} au o singură deplasare și nu apar pe hartă.`].filter(Boolean)) + '\n' +
      table('Datele hărții', ['Relație', 'Deplasări', 'Participanți', 'Mediană'], D.rel.filter((r) => r.n >= 3 && U[r.o] && U[r.d]).map((r) => [`${relName(r.o)} → ${relName(r.d)}`, r.n, r.p, fmt(r.med) + ' min']));
    sections.push(section('fluxuri', 'Fluxuri Origine → Destinație', 'Harta 3', 'Primele axe de deplasare', 'Linii de dorință între centrele unităților, nu trasee reale. Grosimea liniei e proporțională cu numărul de deplasări; sunt afișate doar relațiile cu cel puțin 2 deplasări.', body));
  }

  // ---------- 4. Durata mediană
  {
    const c = (u) => (u.o < 10 ? 'hatch' : u.med < 30 ? 'var(--t1)' : u.med < 45 ? 'var(--t2)' : u.med < 60 ? 'var(--t3)' : 'var(--t4)');
    const fz = (id) => (id === IASI_UAT ? 'var(--q0)' : c(U[id])), fi = (id) => (isZ(id) ? c(U[id]) : id === IASI_UAT ? 'var(--q0)' : 'var(--ctx)');
    const lz = coms.filter((u) => u.o >= 10).map((u) => ({ id: u.id, lines: [['num', fmt(u.med) + '′'], ['sm', `${u.n} · n=${u.o}`]] }));
    const li = zones.filter((u) => u.o >= 10).map((u) => ({ id: u.id, lines: [['lbl', shortName(u.id)], ['num', fmt(u.med) + '′'], ['sm', 'n=' + u.o, 16]] }));
    const V = Object.values(U).filter((u) => u.o >= 10).sort((a, b) => b.med - a.med || b.o - a.o);
    const lng = V.slice(0, 2), sh = V.slice(-3).reverse();
    S.durataMed = median(R.map((r) => r.duration_min));
    const body = fig(mapPanel('zmi', { fill: fz, aria: 'Durata mediană a deplasărilor după unitatea de plecare · comune', ptag: 'Zona Metropolitană', labels: lz }),
      mapPanel('ias', { fill: fi, aria: 'Durata mediană a deplasărilor după unitatea de plecare · zone Iași', ptag: 'Municipiul Iași, mărit', labels: li })) + '\n' +
      legend('Minute, mediană', [[sw('var(--t1)'), 'sub 30 min'], [sw('var(--t2)'), '30–44'], [sw('var(--t3)'), '45–59'], [sw('var(--t4)'), '60 min sau mai mult'], [swHatch, 'sub 10 plecări']]) + '\n' +
      notes([`Cele mai lungi drumuri pornesc din <b>${comName(lng[0].id)}</b> (${fmt(lng[0].med)} min, n=${lng[0].o}) și din <b>${comName(lng[1].id)}</b> (${fmt(lng[1].med)} min).`,
        `Cele mai scurte: ${sh.map((u) => `${comName(u.id)} (${fmt(u.med)} min)`).join(', ')}.`,
        'Durata depinde și de destinație și de modul de transport; harta compară locuri de plecare, nu calitatea drumului.']) + '\n' +
      table('Datele hărții', ['Unitate de plecare', 'Plecări', 'Mediană'], V.map((u) => [u.n, u.o, fmt(u.med) + '′']));
    sections.push(section('durata', 'Durata mediană', 'Harta 4', 'Cât durează drumul, după locul de plecare', 'Durata mediană a deplasărilor care pornesc din fiecare unitate, spre orice destinație. Apar doar unitățile cu cel puțin 10 plecări; restul sunt hașurate.', body));
  }

  // ---------- 5. Durata în timp
  {
    const W = R.filter((r) => r.day_type === 'weekday' && !vac(r.trip_date) && r.duration_min <= 180);
    const inI = (r) => isZ(r.o) && isZ(r.d);
    const B = [['06–07', 360, 420], ['07–08', 420, 480], ['08–09', 480, 540], ['09–12', 540, 720], ['12–15', 720, 900], ['15–18', 900, 1080], ['18–22', 1080, 1320]];
    const H = B.map(([l, a, z]) => { const X = W.filter((r) => mm(r.departure_time) >= a && mm(r.departure_time) < z); const I = X.filter(inI); return { l, n: X.length, med: median(X.map((r) => r.duration_min)), ni: I.length, medi: median(I.map((r) => r.duration_min)) }; });
    const PER = [['1–7 oct.', (d) => d <= '2026-10-07'], ['8–15 oct.', (d) => d >= '2026-10-08' && d <= '2026-10-15'], ['16–23 oct.', (d) => d >= '2026-10-16' && d <= '2026-10-23'], [`2–${zi(D.last).d} ${LS[zi(D.last).m - 1]}`, (d) => d >= '2026-11-02']];
    const grp = { 'Toate': () => true, 'În Iași': inI, 'Bârnova → Iași': (r) => r.o === BARN && isZ(r.d), 'Alte comune → Iași': (r) => !isZ(r.o) && r.o !== BARN && isZ(r.d) };
    const P = {}; for (const [g, f] of Object.entries(grp)) P[g] = PER.map(([l, pf]) => { const X = W.filter((r) => pf(r.trip_date) && f(r)); return { l, n: X.length, med: median(X.map((r) => r.duration_min)) }; });
    const WE = R.filter((r) => r.day_type === 'weekend' && r.duration_min <= 180);
    const n180 = R.filter((r) => r.duration_min > 180).length;
    // grafic 2: linii pe perioade
    const series = [['În Iași', 'var(--t3)'], ['Bârnova → Iași', 'var(--ink)'], ['Alte comune → Iași', 'var(--u3)']];
    const vals = series.flatMap(([g]) => P[g].map((x) => x.med).filter((v) => v != null));
    const lo = Math.floor(Math.min(...vals) / 10) * 10 - 10, hi = Math.ceil(Math.max(...vals) / 10) * 10 + 10;
    const Y = (v) => 530 - (460 * (v - lo)) / (hi - lo), X = (i) => 110 + i * (430 / (PER.length - 1));
    let g2 = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="Grafic: durata mediană pe perioade"><text x="16" y="28" class="axt">Durata mediană pe perioade (minute, zile lucrătoare)</text>`;
    for (let v = lo; v <= hi; v += 10) g2 += `<line x1="70" y1="${Y(v).toFixed(1)}" x2="610" y2="${Y(v).toFixed(1)}" class="grid"/><text x="62" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="ax">${v}</text>`;
    PER.forEach(([l], i) => { g2 += `<text x="${X(i)}" y="550" text-anchor="middle" class="ax-l">${l}</text>`; });
    g2 += `<text x="${X(1)}" y="568" text-anchor="middle" class="sm">Sărbătorile Iașului</text>`;
    series.forEach(([g, c], si) => { const pts = P[g].map((x, i) => (x.med == null || x.n < 5 ? null : [X(i), Y(x.med), x])).filter(Boolean);
      g2 += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1].toFixed(1)).join('')}" style="fill:none;stroke:${c};stroke-width:3"/>`;
      pts.forEach(([x, y, d]) => { g2 += `<circle cx="${x}" cy="${y.toFixed(1)}" r="6" style="fill:${c}"/><text x="${x}" y="${(y + (si === 0 ? 24 : -12)).toFixed(1)}" text-anchor="middle" class="ax"><tspan font-weight="700">${fmt(d.med)}</tspan> · ${d.n}</text>`; }); });
    g2 += '</svg>';
    const g1 = barChart({ title: 'Durata mediană după ora plecării (minute, zile lucrătoare)', aria: 'Grafic: durata mediană după ora plecării', groups: H.map((h) => ({ label: h.l, sub: 'n=' + h.n, values: [h.med, h.medi] })), series: [{ color: 'var(--t4)' }, { color: 'var(--t3)' }], max: 70, step: 10 });
    const tP = P['Toate'], iP = P['În Iași'], bP = P['Bârnova → Iași'];
    S.ora = H; S.perioade = P;
    const body = fig(g1, g2) + '\n' +
      legend('Drumuri', [[sw('var(--t4)'), 'toate drumurile'], [sw('var(--t3)'), 'drumuri în Iași'], [sw('var(--ink)'), 'Bârnova → Iași'], [sw('var(--u3)'), 'alte comune → Iași']]) + '\n' +
      notes([`Ora plecării contează cel mai mult: cine pleacă între 6 și 7 face median <b>${nde(H[0].med, 'minute')}</b>, între 7 și 8, <b>${fmt(H[1].med)}</b>; între 8 și 9, <b>${fmt(H[2].med)}</b>; iar între 9 și 12, doar <b>${fmt(H[3].med)}</b>. Și numai în Iași: ${H.slice(0, 4).map((h) => fmt(h.medi)).join(', ')} de minute. Cine pleacă devreme are de obicei și drumul mai lung, dar diferența se vede și pe aceleași relații.`,
        `De la o perioadă la alta (${PER.map((p) => p[0]).join(', ')}), mediana generală: ${tP.map((x) => fmt(x.med)).join(', ')} de minute. În Iași: ${iP.map((x) => fmt(x.med)).join(', ')}.`,
        `<b>Bârnova → Iași</b>: ${bP.map((x) => `${fmt(x.med)} (${x.n})`).join(' → ')} de minute (în paranteză, numărul de drumuri). Pe perioadele cu puține drumuri, e un semnal, nu o concluzie.`,
        `În weekend, drumul tipic durează ${nde(median(WE.map((r) => r.duration_min)), 'minute')} (${WE.length} de drumuri), față de ${fmt(median(W.map((r) => r.duration_min)))} în zilele lucrătoare.`]) + '\n' +
      table('Datele graficului', ['Ora plecării', 'Drumuri', 'Mediană', 'Drumuri în Iași', 'Mediană în Iași'], [...H.map((h) => [h.l, h.n, fmt(h.med), h.ni, fmt(h.medi)]),
        ...Object.keys(grp).flatMap((g) => P[g].map((x) => [`${g} · ${x.l}`, x.n, fmt(x.med), '', '']))]);
    sections.push(section('durata-timp', 'Durata în timp', 'Graficul 5', 'Cine pleacă mai devreme stă mai mult pe drum', `Cum variază durata mediană (${nde(S.durataMed, 'minute')} pe toate drumurile) după ora plecării și de la o perioadă la alta: înainte de Sărbătorile Iașului (1–7 octombrie), în timpul lor (8–15), după (16–23 octombrie) și după vacanța școlară. Doar zile lucrătoare, fără săptămâna de vacanță școlară (26–30 octombrie), analizată separat; fără ${n180} drumuri de peste trei ore.`, body));
  }

  // ---------- 6. Vacanța
  {
    const wk = R.filter((r) => r.duration_min <= 180 && r.day_type === 'weekday');
    const last = zi(D.last);
    const WKS = [['5–9 oct.', '2026-10-05', '2026-10-09'], ['12–16 oct.', '2026-10-12', '2026-10-16'], ['19–23 oct.', '2026-10-19', '2026-10-23'], ['26–30 oct. (vacanță)', '2026-10-26', '2026-10-30'], [`2–${last.d} nov. (după vacanță)`, '2026-11-02', D.last]];
    const pk = (r) => r.departure_time >= '06:00' && r.departure_time < '09:00';
    const st = WKS.map(([l, a, b]) => { const X = wk.filter((r) => r.trip_date >= a && r.trip_date <= b); const car = X.filter((r) => r.mode === 'car' && r.occupancy != null); const bi = X.filter((r) => r.o === BARN && isZ(r.d));
      return { l, n: X.length, p: new Set(X.map((r) => r.participant_id)).size, med: median(X.map((r) => r.duration_min)), medI: median(X.filter((r) => isZ(r.o) && isZ(r.d)).map((r) => r.duration_min)), bn: bi.length, bmed: median(bi.map((r) => r.duration_min)),
        car: median(X.filter((r) => r.mode === 'car' && pk(r)).map((r) => r.duration_min)), kids: X.length ? X.filter((r) => /escort_child/.test(r.stops || '')).length / X.length : null,
        occ: car.length ? car.reduce((a, r) => a + Math.min(r.occupancy, 5), 0) / car.length : null, solo: car.length ? car.filter((r) => r.occupancy === 1).length / car.length : null, tp: X.length ? X.filter((r) => ['bus', 'tram'].includes(r.mode)).length / X.length : null }; });
    // aceiași participanți, aceeași relație
    const V = wk.filter((r) => vac(r.trip_date)), Sc = wk.filter((r) => r.trip_date >= '2026-10-05' && r.trip_date <= '2026-10-23');
    const key = (r) => r.origin_unit_id + '>' + r.destination_unit_id; const pairs = [];
    for (const p of new Set(V.map((r) => r.participant_id))) { const a = V.filter((r) => r.participant_id === p), b = Sc.filter((r) => r.participant_id === p); const ks = new Set(a.map(key)); const bb = b.filter((r) => ks.has(key(r))); const aa = a.filter((r) => bb.some((x) => key(x) === key(r)));
      if (aa.length && bb.length) pairs.push({ v: median(aa.map((r) => r.duration_min)), s: median(bb.map((r) => r.duration_min)), mode: aa[0].mode, t: aa[0].departure_time }); }
    const dif = pairs.map((x) => x.v - x.s), shorter = dif.filter((x) => x < 0);
    const MODE = { car: 'mașină', bus: 'autobuz', tram: 'tramvai', walk: 'pe jos', bike: 'bicicletă', train: 'tren', multimodal: 'combinat', taxi: 'taxi', moto: 'motocicletă' };
    const vs = st[3], before = st[2], after = st[4];
    const g1 = (() => { const max = 80, Y = (v) => 520 - (454 * v) / max; let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="Grafic: durata mediană pe săptămâni, cu săptămâna de vacanță școlară"><text x="16" y="28" class="axt">Durata mediană pe săptămâni (minute, zile lucrătoare)</text><rect x="400" y="56" width="104" height="464" style="fill:var(--q1)"/><text x="452" y="84" text-anchor="middle" class="sm">vacanță</text>`;
      for (let v = 0; v <= max; v += 20) s += `<line x1="60" y1="${Y(v).toFixed(1)}" x2="620" y2="${Y(v).toFixed(1)}" class="grid"/><text x="52" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="ax">${v}</text>`;
      st.forEach((w, i) => { const cx = 116 + i * 112; [[w.med, 'var(--t4)'], [w.medI, 'var(--t3)'], [w.bmed, 'var(--ink)']].forEach(([v, c], j) => { if (v == null) return; const x = cx - 44 + j * 29.3; s += `<rect x="${x.toFixed(1)}" y="${Y(Math.min(v, max)).toFixed(1)}" width="26.3" height="${(520 - Y(Math.min(v, max))).toFixed(1)}" style="fill:${c}"/><text x="${(x + 13.2).toFixed(1)}" y="${(Y(Math.min(v, max)) - 5).toFixed(1)}" text-anchor="middle" class="sm">${fmt(v)}</text>`; });
        s += `<text x="${cx}" y="540" text-anchor="middle" class="ax-l">${w.l.replace(/ \(.*\)/, '')}</text><text x="${cx}" y="558" text-anchor="middle" class="sm">n=${w.n}</text>`; });
      return s + '</svg>'; })();
    const g2 = (() => { const P = [...pairs].sort((a, b) => b.s - a.s), n = P.length, X = (v) => 120 + Math.min(v, 120) * 4, h = Math.min(25.5, 500 / Math.max(n, 1));
      let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="Grafic: același drum al acelorași participanți, în săptămânile de școală și în vacanță"><text x="16" y="28" class="axt">Aceiași ${n} participanți, același drum: școală → vacanță</text>`;
      for (const v of [0, 30, 60, 90, 120]) s += `<line x1="${X(v)}" y1="48" x2="${X(v)}" y2="564" class="grid"/><text x="${X(v)}" y="582" text-anchor="middle" class="ax">${v}${v === 120 ? ' min' : ''}</text>`;
      P.forEach((p, i) => { const y = 68.8 + i * h; s += `<text x="112" y="${(y + 4).toFixed(1)}" text-anchor="end" class="sm">${MODE[p.mode] || p.mode} · ${p.t}</text><line x1="${X(p.s)}" y1="${y.toFixed(1)}" x2="${X(p.v)}" y2="${y.toFixed(1)}" style="stroke:var(--hatch);stroke-width:2"/><circle cx="${X(p.s)}" cy="${y.toFixed(1)}" r="5" style="fill:var(--t4)"/><circle cx="${X(p.v)}" cy="${y.toFixed(1)}" r="5" style="fill:var(--t1)"/>`; });
      return s + '</svg>'; })();
    S.vacanta = st;
    const body = fig(g1, g2) + '\n' +
      legend('Serii', [[sw('var(--t4)'), 'toate drumurile · săptămână de școală (dreapta)'], [sw('var(--t3)'), 'în Iași'], [sw('var(--ink)'), 'Bârnova → Iași'], [sw('var(--t1)'), 'vacanță (dreapta)']]) + '\n' +
      notes([`Drumul tipic a durat <b>${nde(vs.med, 'minute')}</b> în vacanță, față de ${rng([st[0].med, st[1].med, st[2].med])} de minute în săptămânile de școală. În Iași: ${fmt(vs.medI)} față de ${rng([st[0].medI, st[1].medI, st[2].medI])}. Cu mașina, la ora de vârf: ${fmt(vs.car)} față de ${rng([st[0].car, st[1].car, st[2].car])} de minute.`,
        `Cea mai solidă dovadă: <b>${pairs.length} de participanți</b> au raportat același drum și în școală, și în vacanță. La ${shorter.length} dintre ei, drumul a fost mai scurt în vacanță, cu <b>${nde(-median(dif), 'minute')}</b> mai puțin (mediană).`,
        `S-au schimbat și drumurile: în vacanță, doar ${pct(vs.kids)} din drumuri au inclus copii lăsați la școală (față de ${pct(before.kids)} în săptămâna dinainte), mașina a fost mai goală (${fix(vs.occ, 2)} persoane, ${pct(vs.solo)} cu șoferul singur, față de ${fix(before.occ, 2)} și ${pct(before.solo)}), iar ${pct(vs.tp)} din drumuri au fost cu autobuzul sau tramvaiul, mai ales ale studenților.`,
        `Bârnova → Iași: ${nde(vs.bmed, 'minute')} în vacanță, pe doar ${vs.bn} drumuri, față de ${fmt(before.bmed)} în săptămâna dinainte. Eșantionul din vacanță e mic și diferit (mai mulți studenți), de aceea comparația pe aceiași participanți e cea mai sigură.`,
        `După vacanță (${after.l.replace(' (după vacanță)', '')}, ${after.n} de drumuri), duratele au urcat din nou: drumul tipic ${nde(after.med, 'minute')}, Bârnova → Iași ${nde(after.bmed, 'minute')}, iar copiii duși la școală au reapărut în ${pct(after.kids)} din drumuri.`]) + '\n' +
      table('Datele graficului', ['Săptămâna', 'Drumuri', 'Mediană (min)', 'În Iași', 'Bârnova → Iași', 'Auto la vârf', 'Cu copii la școală', 'Persoane în mașină', 'Transport public'],
        st.map((w) => [w.l, w.n, fmt(w.med), fmt(w.medI), `${fmt(w.bmed)} (${w.bn})`, fmt(w.car), pct(w.kids), fix(w.occ, 2), pct(w.tp)]));
    sections.push(section('vacanta', 'Vacanța școlară, 26–30 octombrie', 'Graficul 6', `În vacanța școlară, drumurile au fost mai scurte`, `Săptămâna 26–30 octombrie, vacanța dintre cele două module ale anului școlar (universitățile au avut cursuri), comparată cu săptămânile de școală din octombrie și cu zilele de după. Doar zile lucrătoare; ${vs.n} de drumuri în vacanță, de la ${vs.p} de participanți. În dreapta: participanții care au raportat același drum și în școală, și în vacanță.`, body));
  }

  // ---------- 7. Ocupare
  {
    const cars = R.filter((r) => r.mode === 'car' && r.occupancy != null && !isGPS(r));
    const avg = (X) => X.reduce((a, r) => a + Math.min(r.occupancy, 5), 0) / X.length;
    const com = cars.filter((r) => !isZ(r.o)), zon = cars.filter((r) => isZ(r.o) && r.o !== 'IAS-Z10');
    const c = (u) => (u.car < 10 ? 'hatch' : +u.occ.toFixed(1) <= 1.7 ? 'var(--u1)' : +u.occ.toFixed(1) <= 1.9 ? 'var(--u2)' : +u.occ.toFixed(1) <= 2.2 ? 'var(--u3)' : 'var(--u4)');
    const fz = (id) => (id === IASI_UAT ? 'var(--q0)' : c(U[id])), fi = (id) => (isZ(id) ? c(U[id]) : id === IASI_UAT ? 'var(--q0)' : 'var(--ctx)');
    const lz = coms.filter((u) => u.car >= 10).map((u) => ({ id: u.id, lines: [['num', fix(u.occ)], ['sm', `${u.n} · n=${u.car}`]] }));
    const li = zones.filter((u) => u.car >= 10).map((u) => ({ id: u.id, lines: [['lbl', shortName(u.id)], ['num', fix(u.occ)], ['sm', 'n=' + u.car, 16]] }));
    const V = Object.values(U).filter((u) => u.car >= 10).sort((a, b) => b.occ - a.occ || b.car - a.car);
    const w = (X) => X.filter((r) => r.purpose === 'work' && !/escort_child/.test(r.stops || ''));
    S.ocupare = { n: cars.length, comune: avg(com), nComune: com.length, soloComune: com.filter((r) => r.occupancy === 1).length / com.length, oras: avg(zon), bucium: U['IAS-Z10'].occ, muncaComune: avg(w(com)), muncaOras: avg(w(zon)) };
    const body = fig(mapPanel('zmi', { fill: fz, aria: 'Persoane în mașină, media pe comune', ptag: 'Zona Metropolitană', labels: lz }), mapPanel('ias', { fill: fi, aria: 'Persoane în mașină, media pe zonele Iașului', ptag: 'Municipiul Iași, mărit', labels: li })) + '\n' +
      legend('Persoane în mașină (medie)', [[sw('var(--u1)'), '1,7 sau mai puțin'], [sw('var(--u2)'), '1,8–1,9'], [sw('var(--u3)'), '2,0–2,2'], [sw('var(--u4)'), '2,3 sau mai mult'], [swHatch, 'sub 10 drumuri cu mașina']]) + '\n' +
      notes([`Din comune, o mașină duce în medie <b>${fix(S.ocupare.comune)} persoane</b> (${com.length} de drumuri), iar doar ${pct(S.ocupare.soloComune)} au șoferul singur. Din zonele Iașului, fără Bucium: <b>${fix(S.ocupare.oras)}</b>.`,
        `Cele mai pline: ${V.slice(0, 4).map((u) => `${comName(u.id)} (${fix(u.occ)})`).join(', ')}. Cele mai goale: ${V.slice(-3).reverse().map((u) => `${comName(u.id)} (${fix(u.occ)})`).join(', ')}.`,
        `Bucium, deși e în oraș, seamănă cu comunele (${fix(U['IAS-Z10'].occ)}). Diferența vine mai ales din drumurile cu copiii duși la școală și din cele spre școală sau facultate; la drumul la muncă fără copii, diferența dintre comune și oraș e mică (${fix(S.ocupare.muncaComune)} față de ${fix(S.ocupare.muncaOras)}).`]) + '\n' +
      table('Datele hărții', ['Unitate de plecare', 'Drumuri cu mașina', 'Participanți', 'Persoane (medie)', 'Șofer singur', 'Cu copii lăsați pe drum'], V.map((u) => [comName(u.id), u.car, u.carP, fix(u.occ), pct(u.solo), u.kids]));
    sections.push(section('ocupare', 'Persoane în mașină', 'Harta 7', 'Din comune și de la marginea orașului, mașina vine mai plină', `Media persoanelor din mașină, inclusiv șoferul, în drumurile cu mașina care pornesc din fiecare unitate, spre orice destinație. Doar unitățile cu cel puțin 10 drumuri cu mașina; ${cars.length} de drumuri, fără jurnalul GPS.`, body));
  }

  // ---------- 8. Dotări
  {
    const DT = ST.dotari, byN = Object.fromEntries(zones.map((u) => [u.n, u]));
    const Z = Object.entries(DT).map(([n, d]) => ({ u: byN[n], ...d })).filter((x) => x.u);
    const tot = Object.fromEntries(Z.map((x) => [x.u.id, x.total]));
    const c = (id) => (!isZ(id) ? (id === IASI_UAT ? 'var(--q0)' : 'var(--ctx)') : tot[id] < 10 ? 'var(--f1)' : tot[id] < 20 ? 'var(--f2)' : tot[id] < 40 ? 'var(--f3)' : 'var(--f4)');
    const maxD = Math.max(...zones.map((u) => u.d));
    const circ = zones.map((u) => { const a = anchor('ias', u.id); return `<circle cx="${a[0]}" cy="${a[1]}" r="${((40 * Math.sqrt(u.d)) / Math.sqrt(maxD)).toFixed(1)}" class="dot-d hollow" data-u="${u.id}"/>`; }).join('');
    const li = zones.map((u) => ({ id: u.id, at: (() => { const a = anchor('ias', u.id); return [a[0], a[1] - 6]; })(), lines: [['lbl', shortName(u.id)]] }));
    const rD = spearman(Z.map((x) => x.total), Z.map((x) => x.u.d)), rO = spearman(Z.map((x) => x.total), Z.map((x) => x.u.o));
    const sc = (() => { const mx = Math.ceil(Math.max(...Z.map((x) => x.total)) / 10) * 10, my = Math.ceil(maxD / 100) * 100, X = (v) => 80 + (510 * v) / mx, Y = (v) => 530 - (460 * v) / my;
      let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="Grafic: dotări publice și sosiri pe zonele Iașului"><text x="16" y="28" class="axt">Dotări publice (orizontal) și sosiri (vertical), pe zone</text>`;
      for (let v = 0; v <= mx; v += 10) s += `<line x1="${X(v)}" y1="70" x2="${X(v)}" y2="530" class="grid"/><text x="${X(v)}" y="550" text-anchor="middle" class="ax">${v}</text>`;
      for (let v = 0; v <= my; v += 100) s += `<line x1="80" y1="${Y(v)}" x2="590" y2="${Y(v)}" class="grid"/><text x="72" y="${Y(v) + 4}" text-anchor="end" class="ax">${v}</text>`;
      s += `<line x1="80" y1="530" x2="590" y2="530" class="axis"/><text x="335" y="580" text-anchor="middle" class="axt">dotări publice</text>`;
      for (const x of Z) s += `<circle cx="${X(x.total).toFixed(1)}" cy="${Y(x.u.d).toFixed(1)}" r="7" class="pt${x.u.d >= 200 ? ' pt-hl' : ''}" data-u="${x.u.id}"/>` + (x.u.d >= 40 || x.total >= 40 ? `<text x="${(X(x.total) + 10).toFixed(1)}" y="${(Y(x.u.d) - 8).toFixed(1)}" class="lbl halo">${esc(shortName(x.u.id))}</text>` : '');
      return s + '</svg>'; })();
    const av = Z.find((x) => x.u.id === 'IAS-Z02'), mv = Z.find((x) => x.u.id === 'IAS-Z03');
    S.dotari = { rD, rO };
    const body = fig(mapPanel('ias', { fill: c, aria: 'Dotări publice pe zonele Iașului și sosirile din studiu', ptag: 'Municipiul Iași · dotări și sosiri', extra: circ, labels: li }), sc) + '\n' +
      legend('Dotări publice pe zonă', [[sw('var(--f1)'), 'sub 10 dotări'], [sw('var(--f2)'), '10–19'], [sw('var(--f3)'), '20–39'], [sw('var(--f4)'), '40 sau mai multe'], ['<span class="sw-dot dot-d"></span>', 'sosiri']]) + '\n' +
      notes([`Legătura dintre dotări și sosiri e <b>${rD >= 0.7 ? 'puternică' : rD >= 0.4 ? 'moderată' : 'slabă'}</b> (Spearman ${fix(rD, 2)}); între dotări și plecări e <b>${rO >= 0.7 ? 'puternică' : rO >= 0.4 ? 'moderată' : 'slabă'}</b> (${fix(rO, 2)}). Drumurile merg spre dotări, dar pornesc din zonele în care locuiesc participanții.`,
        `<b>Aviației</b> are doar ${av.total} dotări și ${av.u.d} sosiri. <b>Moara de Vânt</b> are ${mv.total} dotări (mai ales școli) și ${mv.u.o} plecări de acolo: lipsa datelor ține de promovare, nu de dotări.`,
        'Cartierele mari de locuințe (Alexandru cel Bun, Tătărași, Nicolina, Păcurari) au multe dotări de proximitate, dar puține sosiri: drumurile scurte de cartier sunt raportate rar.']) + '\n' +
      table('Datele hărții', ['Zonă', 'Școli', 'Univ.', 'Sănătate', 'Admin.', 'Comerț', 'Total', 'Sosiri'], Z.sort((a, b) => b.total - a.total).map((x) => [x.u.n, x.scoli, x.univ, x.sanatate, x.admin, x.comert, x.total, x.u.d]), '<p class="fine">Dotări: OpenStreetMap, clasificate pe tipuri (extras octombrie 2026).</p>');
    sections.push(section('dotari', 'Dotări publice și sosiri', 'Harta 8', 'Drumurile merg spre dotări, dar pleacă de unde locuim', 'Dotări din OpenStreetMap pe fiecare zonă a Iașului: școli și grădinițe, universități, spitale și clinici, instituții publice, supermarketuri, mall-uri și piețe. Cercurile arată sosirile din studiu. Numărăm obiecte, nu mărimea lor: o universitate contează cât o grădiniță.', body));
  }

  // ---------- 9. Transport public
  {
    const c = (u) => (u.o < 10 ? 'hatch' : u.tpShare < 0.1 ? 'var(--p1)' : u.tpShare < 0.2 ? 'var(--p2)' : u.tpShare < 0.35 ? 'var(--p3)' : 'var(--p4)');
    const fz = (id) => (id === IASI_UAT ? 'var(--q0)' : c(U[id])), fi = (id) => (isZ(id) ? c(U[id]) : id === IASI_UAT ? 'var(--q0)' : 'var(--ctx)');
    const lz = coms.filter((u) => u.o >= 10).map((u) => ({ id: u.id, lines: [['num', pct(u.tpShare)], ['sm', `${u.n} · n=${u.o}`]] }));
    const li = zones.filter((u) => u.o >= 10).map((u) => ({ id: u.id, lines: [['lbl', shortName(u.id)], ['num', pct(u.tpShare)]] }));
    const AC = ST.tp_acoperire, V = Object.values(U).filter((u) => u.o >= 10).sort((a, b) => b.tpShare - a.tpShare);
    const withC = V.filter((u) => AC[u.n] && AC[u.n].tram400 != null);
    const tram = withC.filter((u) => AC[u.n].tram400 > 50), rest = withC.filter((u) => !(AC[u.n].tram400 > 50));
    const sh = (X) => { const a = X.reduce((s, u) => s + u.tp, 0), b = X.reduce((s, u) => s + u.o, 0); return [a, b, a / b]; };
    const [ta, tb, ts] = sh(tram), [ra, rb, rs] = sh(rest);
    const rT = spearman(withC.map((u) => AC[u.n].tram400), withC.map((u) => u.tpShare)), rS = spearman(withC.map((u) => AC[u.n].statii300), withC.map((u) => u.tpShare));
    S.tp = { tram: ts, rest: rs, rT, rS };
    const body = fig(mapPanel('zmi', { fill: fz, aria: 'Rețeaua metropolitană de transport public și ponderea drumurilor cu transportul public, pe comune', ptag: 'Zona Metropolitană', extra: L.GEOM.tp_overlay.zmi, labels: lz }),
      mapPanel('ias', { fill: fi, aria: 'Rețeaua urbană de transport public și ponderea drumurilor cu transportul public, pe zonele Iașului', ptag: 'Municipiul Iași, mărit', extra: L.GEOM.tp_overlay.ias, labels: li })) + '\n' +
      legend('Drumuri cu transportul public', [[sw('var(--p1)'), 'sub 10%'], [sw('var(--p2)'), '10–19%'], [sw('var(--p3)'), '20–34%'], [sw('var(--p4)'), '35% sau mai mult'], [swHatch, 'sub 10 plecări'], ['<span class="sw-ln ln-tram"></span>', 'tramvai'], ['<span class="sw-ln ln-metro"></span>', 'trasee metropolitane'], ['<span class="sw-mk mk-gara"></span>', 'gară'], ['<span class="sw-mk mk-tm"></span>', 'stație tren metropolitan propusă']]) + '\n' +
      notes([`Din zonele cu tramvai la cel mult 400 m pe peste jumătate din suprafață, <b>${pct(ts, 1)}</b> din drumuri se fac cu transportul public (${ta} din ${tb}); din restul, doar <b>${pct(rs, 1)}</b> (${ra} din ${rb}).`,
        `Legătura cu ponderea transportului public, pe ${withC.length} de unități (Spearman): tramvai <b>${fix(rT, 2)}</b>, stații de autobuz la 300 m <b>${fix(rS, 2)}</b>.`,
        `Stațiile singure nu ajung: Bucium și comuna Bârnova au câte 25 de stații, dar doar ${pct(U['IAS-Z10'].tpShare, 1)}, respectiv ${pct(U[BARN].tpShare, 1)} din drumuri sunt cu transportul public. Coridorul cel mai lent din studiu este și cel fără tramvai.`]) + '\n' +
      table('Datele hărții', ['Unitate de plecare', 'Plecări', 'Cu TP', '% TP', 'Tramvai ≤400 m', 'Stații ≤300 m'], V.map((u) => [comName(u.id), u.o, u.tp, pct(u.tpShare, 1), AC[u.n] ? fmt(AC[u.n].tram400) + '%' : '–', AC[u.n] ? fmt(AC[u.n].statii300) + '%' : '–']));
    sections.push(section('transport-public', 'Rețeaua de transport public', 'Harta 9', 'Unde e tramvai, oamenii folosesc transportul public', 'Culoarea arată ce parte din drumurile care pornesc din unitate se fac cu autobuzul, tramvaiul sau trenul; doar unitățile cu cel puțin 10 plecări. Peste ea: tramvaiul existent și extinderile propuse (punctat), traseele de autobuz urban, stațiile de autobuz urbane și metropolitane, traseele metropolitane TP 101–902, căile ferate, gările și stațiile propuse pentru trenul metropolitan.', body));
  }
  sections.push(fs.readFileSync(path.join(STATIC, 'benzi-dedicate.html'), 'utf8'));

  // ---------- 11. TP după domiciliu
  {
    const P = {};
    for (const r of R) { const p = P[r.participant_id] || (P[r.participant_id] = { trips: [], home: {} }); p.trips.push(r); const h = r.purpose === 'home' ? r.d : r.o; if (h && U[h]) p.home[h] = (p.home[h] || 0) + (r.purpose === 'home' ? 3 : 1); }
    const PT = new Set(TPM), H = {};
    for (const [id, p] of Object.entries(P)) { if (id.startsWith('import-')) continue; const hh = Object.entries(p.home).sort((a, b) => b[1] - a[1])[0]; if (!hh) continue; const h = hh[0];
      const x = H[h] || (H[h] = { n: 0, pt: 0, trips: 0, ptTrips: 0 }); x.n++; if (p.trips.some((t) => PT.has(t.mode) || t.mode === 'multimodal')) x.pt++; x.trips += p.trips.length; x.ptTrips += p.trips.filter((t) => PT.has(t.mode)).length; }
    const grp = (k) => (isZ(k) ? (k === 'IAS-Z10' ? 'Bucium' : 'Cartierele Iașului') : 'Comunele ZMI');
    const G = {}; for (const [k, x] of Object.entries(H)) { const g = G[grp(k)] || (G[grp(k)] = { n: 0, pt: 0, trips: 0, ptTrips: 0 }); for (const f in g) g[f] += x[f]; }
    const col = { 'Cartierele Iașului': 'var(--p4)', 'Bucium': 'var(--p2)', 'Comunele ZMI': 'var(--metro)' };
    const nPart = Object.values(G).reduce((a, g) => a + g.n, 0);
    const g1 = (() => { let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="Grafic: ce parte din participanți au folosit transportul public, după locul de domiciliu"><text x="16" y="28" class="axt">Participanți care au folosit transportul public</text>`;
      ['Cartierele Iașului', 'Bucium', 'Comunele ZMI'].forEach((g, i) => { const x = G[g], y = 90 + i * 160, w = (560 * (x.pt / x.n)) / 0.6;
        s += `<text x="24" y="${y}" class="ax-l"><tspan font-weight="700">${g}</tspan></text><text x="24" y="${y + 20}" class="ax">${nde(x.n, 'participanți')} · ${x.ptTrips} din ${nde(x.trips, 'drumuri')} cu autobuzul, tramvaiul sau trenul</text><rect x="24" y="${y + 34}" width="560" height="44" class="bar-bg"/><rect x="24" y="${y + 34}" width="${Math.min(560, w).toFixed(1)}" height="44" style="fill:${col[g]}"/><text x="${(34 + Math.min(560, w)).toFixed(1)}" y="${y + 64}" class="num">${pct(x.pt / x.n)}</text>`; });
      [0, 20, 40, 60].forEach((v) => { s += `<text x="${24 + (560 * v) / 60}" y="560" text-anchor="middle" class="ax">${v}%</text>`; }); return s + '</svg>'; })();
    const rowsU = Object.entries(H).filter(([, x]) => x.n >= 10).sort((a, b) => b[1].pt / b[1].n - a[1].pt / a[1].n || b[1].n - a[1].n);
    const g2 = hbarChart({ title: 'Pe cartier sau comună (cel puțin 10 participanți)', aria: 'Grafic: ce parte din participanți au folosit transportul public, pe cartiere și comune', max: 0.8 * 100, ticks: [0, 25, 50, 75],
      rows: rowsU.map(([k, x]) => ({ id: k, label: isZ(k) ? shortName(k) : uname(k) + ' (comună)', v: (100 * x.pt) / x.n, color: col[grp(k)], text: `${pct(x.pt / x.n)} · ${x.n}` })) });
    const gz = G['Cartierele Iașului'], gb = G['Bucium'], gc = G['Comunele ZMI'];
    S.tpDomiciliu = { oras: gz.pt / gz.n, comune: gc.pt / gc.n, bucium: gb.pt / gb.n, nOras: gz.n, ptOras: gz.pt, nComune: gc.n, ptComune: gc.pt };
    const top = rowsU.slice(0, 4).map(([k, x]) => `${comName(k)} (${pct(x.pt / x.n)})`), bot = rowsU.slice(-4).reverse().map(([k, x]) => `${comName(k)} (${pct(x.pt / x.n)})`);
    const body = fig(g1, g2) + '\n' + legend('Locul de domiciliu', [[sw('var(--p4)'), 'Cartierele Iașului'], [sw('var(--p2)'), 'Bucium'], [sw('var(--metro)'), 'Comunele ZMI']]) + '\n' +
      notes([`Din cartierele Iașului (fără Bucium), <b>${pct(gz.pt / gz.n)}</b> din participanți au folosit transportul public (${gz.pt} din ${gz.n}). Din comune, doar <b>${pct(gc.pt / gc.n)}</b> (${gc.pt} din ${gc.n}), iar din Bucium <b>${pct(gb.pt / gb.n)}</b>.`,
        `Cei mai mulți utilizatori: ${top.join(', ')}, adică zonele de pe linia de tramvai și cu mulți studenți. Cei mai puțini: ${bot.join(', ')}.`,
        'Eșantionul e voluntar și majoritatea participanților au raportat un singur drum, deci „a folosit transportul public” înseamnă „în drumul raportat”. Studenții, mulți în Studențesc, Tătărași și Copou, ridică ponderea în oraș.']) + '\n' +
      table('Datele graficului', ['Domiciliu', 'Grup', 'Participanți', 'Au folosit TP', '% participanți', 'Drumuri cu TP', '% drumuri'], rowsU.map(([k, x]) => [uname(k), grp(k), x.n, x.pt, pct(x.pt / x.n, 1), x.ptTrips, pct(x.ptTrips / x.trips, 1)]));
    sections.push(section('tp-domiciliu', 'Transportul public după domiciliu', 'Graficul 11', `Din cartierele Iașului, ${pct(gz.pt / gz.n)} au mers cu transportul public; din comune, ${pct(gc.pt / gc.n)}`, `Ce parte din participanți au raportat cel puțin un drum cu autobuzul, tramvaiul, trenul sau combinat, după locul în care locuiesc. Domiciliul e dedus din drumuri: destinația drumurilor spre casă sau, dacă nu există, locul de plecare. ${nPart} de participanți, fără jurnalul GPS.`, body));
  }

  // ---------- 12. Participare
  {
    const POP = ST.populatie, totPop = Object.values(POP).reduce((a, b) => a + b, 0);
    const iasiO = zones.reduce((a, u) => a + u.o, 0);
    const rows = Object.entries(POP).map(([n, pop]) => { const u = n === 'Municipiul Iași' ? null : coms.find((x) => x.n === n); const o = u ? u.o : iasiO; const tgt = Math.max(10, Math.round((2000 * pop) / totPop)); return { n, id: u ? u.id : IASI_UAT, pop, o, rate: (1000 * o) / pop, tgt, miss: Math.max(0, tgt - o) }; });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    const c = (r) => (r.o === 0 ? 'var(--q0)' : r.rate < 0.5 ? 'var(--t4)' : r.rate < 1 ? 'var(--t3)' : r.rate < 3 ? 'var(--t2)' : 'var(--t1)');
    const fz = (id) => (isZ(id) ? c(byId[IASI_UAT]) : byId[id] ? c(byId[id]) : 'var(--q0)');
    const lz = rows.filter((r) => r.id !== IASI_UAT).map((r) => ({ id: r.id, lines: [['num', fix(r.rate)]] }));
    const tcol = (f) => (f < 0.25 ? 'var(--t4)' : f < 0.5 ? 'var(--t3)' : f < 1 ? 'var(--t2)' : 'var(--t1)');
    const RR = [...rows].sort((a, b) => b.pop - a.pop);
    const g2 = hbarChart({ title: 'Cât din ținta proporțională s-a strâns', aria: 'Grafic: plecări față de ținta proporțională, pe unități', max: 100, ticks: [0, 25, 50, 75, 100],
      rows: RR.filter((r) => r.pop >= 2500).map((r) => ({ id: r.id, label: r.n === 'Municipiul Iași' ? 'Iași' : r.n, v: Math.min(100, (100 * r.o) / r.tgt), color: tcol(r.o / r.tgt), text: `${r.o} / ${r.tgt}` })) });
    const big = ['Miroslava', 'Ciurea', 'Valea Lupului', 'Holboca', 'Tomești'].map((n) => rows.find((r) => r.n === n));
    const barn = rows.find((r) => r.n === 'Bârnova'), second = [...rows].filter((r) => r.n !== 'Bârnova').sort((a, b) => b.rate - a.rate)[0];
    S.participare = { lipsa: rows.reduce((a, r) => a + r.miss, 0), lipsaIasi: byId[IASI_UAT].miss, zero: rows.filter((r) => r.o === 0).length };
    const body = fig(mapPanel('zmi', { fill: fz, aria: 'Plecări din studiu la 1.000 de locuitori', ptag: 'Plecări la 1.000 de locuitori', labels: [...lz, { id: 'IAS-Z15', lines: [['lbl', 'Iași ' + fix(byId[IASI_UAT].rate)]] }] }), g2) + '\n' +
      legend('Plecări la 1.000 de locuitori', [[sw('var(--q0)'), 'nicio plecare'], [sw('var(--t4)'), 'sub 0,5'], [sw('var(--t3)'), '0,5–0,99'], [sw('var(--t2)'), '1–2,99'], [sw('var(--t1)'), '3 sau mai mult']]) + '\n' +
      notes([`<b>Bârnova</b> are ${fix(barn.rate)} plecări la 1.000 de locuitori, de ${fmt(barn.rate / second.rate, 0)} ori mai mult decât următoarea unitate: acolo a pornit promovarea. Ținta ei proporțională (${barn.tgt}) e deja depășită.`,
        `În comunele mari din jurul orașului (${big.map((r) => r.n).join(', ')}), împreună ${mii(big.reduce((a, r) => a + r.pop, 0) / 1000)} de mii de locuitori, mai lipsesc ${big.reduce((a, r) => a + r.miss, 0)} de deplasări până la ținta proporțională.`,
        `${S.participare.zero} comune nu au încă nicio plecare. Până la ținta proporțională lipsesc în total circa ${S.participare.lipsa} de deplasări, din care ${S.participare.lipsaIasi} în municipiul Iași.`]) + '\n' +
      table('Datele hărții', ['Unitate', 'Locuitori 2021', 'Plecări', 'La 1.000 loc.', 'Țintă', 'Lipsesc'], RR.map((r) => [r.n, mii(r.pop), r.o, fix(r.rate, 2), r.tgt, r.miss]));
    sections.push(section('participare', 'Participare și țintă', 'Harta 12', 'Cine a participat, față de câți locuitori are fiecare unitate', 'Plecări din studiu la 1.000 de locuitori (recensământul 2021) și cât s-a strâns din ținta de 2.000 de deplasări, împărțită proporțional cu populația (cel puțin 10 pe comună). Municipiul Iași apare ca un întreg: nu avem populația pe cele 17 zone. În grafic, culoarea arată cât din țintă s-a strâns: roșu sub 25%, portocaliu 25–49%, verde deschis 50–99%, verde închis ținta atinsă.', body));
  }

  // ---------- 13. Moduri
  {
    const M = [['Autoturism', (r) => r.mode === 'car'], ['Transport public', (r) => TPM13.includes(r.mode)], ['Pe jos', (r) => r.mode === 'walk'], ['Bicicletă / trotinetă', (r) => r.mode === 'bike'], ['Tren', (r) => r.mode === 'train'], ['Altele', (r) => ['moto', 'multimodal'].includes(r.mode)]];
    const RG = [['Drumuri în Iași', (r) => isZ(r.o) && isZ(r.d)], ['Bârnova → Iași', (r) => r.o === BARN && isZ(r.d)], ['Alte comune → Iași', (r) => !isZ(r.o) && r.o !== BARN && isZ(r.d)]];
    const T = M.map(([l, f]) => { const X = R.filter(f); return { l, n: X.length, share: X.length / D.n, med: median(X.map((r) => r.duration_min)), g: RG.map(([, g]) => { const Y = X.filter(g); return { n: Y.length, med: median(Y.map((r) => r.duration_min)) }; }) }; });
    S.moduri = T.map((t) => ({ l: t.l, n: t.n, share: t.share, med: t.med, g: t.g }));
    const g1 = hbarChart({ title: 'Cota modală · deplasări raportate', aria: 'Grafic: cota modală a deplasărilor', max: 80, ticks: [0, 20, 40, 60, 80], rows: T.map((t) => ({ label: t.l, v: 100 * t.share, color: 'var(--u4)', text: `${pct(t.share, 1)} · ${t.n} · ${fmt(t.med)} min` })) });
    const groups = RG.map(([l], j) => ({ label: l, values: T.slice(0, 4).map((t) => (t.g[j].n >= 5 ? t.g[j].med : null)) }));
    const g2 = barChart({ title: 'Durata mediană pe mod și relație (minute)', aria: 'Grafic: durata mediană pe mod, pe aceleași tipuri de relații', groups, series: [{ color: 'var(--u4)' }, { color: 'var(--p3)' }, { color: 'var(--f3)' }, { color: 'var(--t3)' }], max: 100, step: 20 });
    const car = T[0], tp = T[1];
    const body = fig(g1, g2) + '\n' + legend('Moduri (dreapta)', [[sw('var(--u4)'), 'autoturism'], [sw('var(--p3)'), 'transport public'], [sw('var(--f3)'), 'pe jos'], [sw('var(--t3)'), 'bicicletă / trotinetă']]) + '\n' +
      notes([`În interiorul Iașului, un drum cu mașina durează median <b>${nde(car.g[0].med, 'minute')}</b> (${car.g[0].n} de drumuri), iar unul cu transportul public <b>${nde(tp.g[0].med, 'minute')}</b> (${tp.g[0].n}): diferența e de ${nde(tp.g[0].med - car.g[0].med, 'minute')}.`,
        `Din comuna Bârnova spre Iași: mașina ${fmt(car.g[1].med)} min (${car.g[1].n}), transportul public ${fmt(tp.g[1].med)} min (${tp.g[1].n}). Din celelalte comune: ${fmt(car.g[2].med)}, respectiv ${fmt(tp.g[2].med)} min.`,
        `Drumurile pe jos și cu bicicleta sunt de obicei mai scurte, deci duratele lor nu se compară direct cu ale mașinii; bicicleta are doar ${T[3].n} de drumuri. Taxiul e inclus la transport public. Cota modală descrie cine a răspuns, nu populația: șoferii sunt supra-reprezentați.`]) + '\n' +
      table('Datele graficului', ['Mod', 'Deplasări', 'Cota modală', 'Durata mediană', ...RG.map(([l]) => `${l} (mediană, n)`)], T.map((t) => [t.l, t.n, pct(t.share, 1), fmt(t.med) + ' min', ...t.g.map((g) => (g.n ? `${fmt(g.med)} min (${g.n})` : '–'))]));
    sections.push(section('moduri', 'Cota modală și durata', 'Graficul 13', 'Cât durează drumul, după modul de transport', 'Stânga: ce pondere are fiecare mod în deplasările raportate și durata lui mediană. Dreapta: durata mediană pe mod, comparată pe aceleași tipuri de relații (drumuri în interiorul Iașului, din comuna Bârnova spre Iași, din celelalte comune spre Iași). Grupurile cu sub 5 drumuri nu sunt afișate.', body));
  }
  for (const s of ['jurnal-gps', 'tomtom', 'piste', 'urgenta', 'regional', 'scenarii']) sections.push(fs.readFileSync(path.join(STATIC, s + '.html'), 'utf8'));

  // ---------- antet, evoluție, cuprins, subsol
  const per = perioada(D.first, D.last);
  const evoRow = (lbl, a, b, fmtv = (v) => v) => { const d = typeof a === 'number' && typeof b === 'number' ? b - a : null; return [lbl, a == null ? '–' : fmtv(a), `<b>${fmtv(b)}</b>`, d == null ? '' : d === 0 ? '<span class="tr eq">neschimbat</span>' : `<span class="tr ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</span>`]; };
  const evo = prev ? `<section class="evo" aria-labelledby="evo-t"><h2 id="evo-t">Cum a evoluat acoperirea</h2><p class="fine">Față de ediția anterioară: ${prev.n} deplasări, până la ${zi(prev.ultima).d} ${LUNI[zi(prev.ultima).m - 1]} ${zi(prev.ultima).y}</p><div class="tw"><table><thead><tr><th>Indicator</th><th class="n">Anterior</th><th class="n">Acum</th><th class="n">Schimbare</th></tr></thead><tbody>` +
    [evoRow('Deplasări', prev.n, S.n), evoRow('Participanți', prev.participanti, S.participanti), evoRow('Zone din Iași cu cel puțin 10', prev.zone10, S.zone10, (v) => v + ' / 17'), evoRow('Zone din Iași cu cel puțin 50', prev.zone50, S.zone50, (v) => v + ' / 17'),
      evoRow('Comune cu cel puțin 10', prev.com10, S.com10, (v) => v + ' / 27'), evoRow('Comune fără nicio deplasare', prev.com0, S.com0, (v) => v + ' / 27'), evoRow('Relații O–D cu cel puțin 10', prev.rel10, S.rel10)]
      .map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('') + '</tbody></table></div></section>' : '';
  const TOC = [['acoperire', 'Acoperire teritorială'], ['plecari-sosiri', 'Plecări și sosiri'], ['fluxuri', 'Fluxuri Origine → Destinație'], ['durata', 'Durata mediană'], ['durata-timp', 'Durata în timp'], ['vacanta', 'Vacanța școlară, 26–30 octombrie'], ['ocupare', 'Persoane în mașină'], ['dotari', 'Dotări publice și sosiri'], ['transport-public', 'Rețeaua de transport public'], ['benzi-dedicate', 'Benzi dedicate · date GPS ale vehiculelor CTP'], ['tp-domiciliu', 'Transportul public după domiciliu'], ['participare', 'Participare și țintă'], ['moduri', 'Cota modală și durata'], ['jurnal-gps', 'Jurnal GPS · un participant'], ['tomtom', 'Timp declarat vs. timp de condus'], ['piste', 'Piste de lucru pentru planificare'], ['urgenta', 'Accesibilitate · spitalele de urgență'], ['regional', 'Spitalul Regional de Urgență'], ['scenarii', 'Scenariu · inele și radiale']];
  const UNITS = Object.fromEntries(Object.values(U).map((u) => [u.id, { n: u.n, o: u.o, d: u.d, t: u.t, po: u.po, med: u.med, p90: u.p90 == null ? null : Math.round(u.p90 * 10) / 10 }]));
  const rd = (n) => fs.readFileSync(path.join(STATIC, n), 'utf8');
  const html = `<title>Atlasul deplasărilor ZMI Iași</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Public+Sans:wght@400;600;700&display=swap">
<style>${rd('atlas.css')}</style>
<div class="wrap">
<header class="mast">
<p class="org">Moldova Vrea Autostradă × Moldova Vrea Infrastructură</p>
<h1>Atlasul deplasărilor<br>Zona Metropolitană Iași</h1>
<p class="sub">Ediție de lucru, din datele studiului participativ Origine–Destinație. Hărțile se refac la fiecare export nou.</p>
<dl class="stamp">
<div><dt>Deplasări</dt><dd>${S.n}</dd></div>
<div><dt>Participanți</dt><dd>${S.participanti}</dd></div>
<div><dt>Perioada</dt><dd>${per}</dd></div>
<div><dt>Unități de hartă</dt><dd>17 zone + 27 comune</dd></div>
</dl>
</header>
<aside class="caveat" aria-label="Cum se citesc hărțile">
<h2>Cum citim hărțile</h2>
<p>Eșantionul este voluntar și încă nu acoperă tot teritoriul: multe unități au sub 10 observații. Hărțile arată <b>unde sunt deja date solide</b> și <b>ce semnale apar</b>, nu harta definitivă a mobilității. Pragurile vin din metodologie:</p>
<ol class="thr"><li><b>sub 10</b> semnalare</li><li><b>10–29</b> volum redus</li><li><b>30–49</b> descriptiv robust</li><li><b>50+</b> comparații</li></ol>
<p class="fine">Satele sunt incluse în comuna lor. Deplasări VALID și de verificat; nu apare niciun punct individual, doar totaluri pe unitate.</p>
</aside>
${evo}
<nav class="toc" aria-label="Hărți">${TOC.map(([id, t], i) => `<a href="#${id}"><span>${i + 1}</span>${t}</a>`).join('')}</nav>
${sections.join('\n')}
<footer class="foot"><p>Studiu participativ O–D · Zona Metropolitană Iași · date preliminare ${per} · ${S.n} deplasări, ${S.participanti} participanți. Timpi de condus: TomTom (trafic istoric, marți 10 noiembrie 2026). Inele și radiale: MVA × MVI, rev. 3.3. Limite administrative: ANCPI (UAT), zonare de analiză MVA–MVI.</p><p>mobilitate-iasi.netlify.app · contact@moldovavreainfrastructura.ro</p></footer>
</div>
<div id="tip" class="tip" role="status" hidden></div>
<script>const SCN=${rd('SCN.json')};const REG=${rd('REG.json')};const ACC=${rd('ACC.json')};const TT=${rd('TT.json')};const UNITS=${JSON.stringify(UNITS)};const FLOWS=${JSON.stringify(FLOWS)};
${rd('tooltip.js')}
</script>
`;
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'atlas.html'), html);
  fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(S, null, 1));
  console.log(`atlas.html: ${S.n} deplasări, ${S.participanti} participanți, ${per}; ${(html.length / 1e6).toFixed(2)} MB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
