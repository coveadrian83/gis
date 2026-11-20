'use strict';
// Secțiunea fixă „Traficul la vârf, zi de zi” din colectarea automată TomTom (branch-ul date/tomtom, data/tomtom/colectare):
// marți–joi, 07:30 și 17:30. Agregă pe relațiile O–D din studiu, pe punctele de viteză și pe incidente, și pune lângă ele
// timpul declarat în anchetă pe aceleași relații (doar mediane, fără drumuri individuale).
//   git archive origin/date/tomtom data/tomtom/colectare | tar -x -C <dir>
//   node scripts/atlas/colectare.js --dir <dir>/data/tomtom/colectare [--export trips.jsonl]
const fs = require('node:fs');
const path = require('node:path');
const { fmt, fix, esc, fig, legend, sw, notes, table, section, mapPanel, lista, nde } = require('./lib.js');
const ROOT = path.join(__dirname, '..', '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const median = (a) => { a = a.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
const quant = (a, p) => { a = a.filter((v) => v != null).sort((x, y) => x - y); if (!a.length) return null; const i = (a.length - 1) * p, lo = Math.floor(i); return a[lo] + (a[Math.ceil(i)] - a[lo]) * (i - lo); };
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'tomtom', 'config.json'), 'utf8'));
const PJ = JSON.parse(fs.readFileSync(path.join(__dirname, 'static', 'proiectie.json'), 'utf8'));
const proj = (panel, lat, lon) => { const p = PJ[panel]; return [p.cx[0] * lon + p.cx[1] * lat + p.cx[2], p.cy[0] * lon + p.cy[1] * lat + p.cy[2]]; };
const FER = { dimineata: 'dimineața (07:30)', seara: 'seara (17:30)' };
const CAT = { 1: 'accidente', 6: 'ambuteiaje', 7: 'benzi închise', 8: 'drumuri închise', 9: 'lucrări', 14: 'vehicule în pană' };

async function agrega(dir, exportFile) {
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d\d-\d\d_(dimineata|seara)\.json$/.test(f)).sort();
  const zile = files.map((f) => ({ data: f.slice(0, 10), fer: f.slice(11, -5), j: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
  const key = (r) => r.o + '>' + r.d;
  const rel = CFG.relatii.map((r) => {
    const o = { o: r.o, on: r.on, d: r.d, dn: r.dn };
    for (const fer of Object.keys(FER)) {
      const X = zile.filter((z) => z.fer === fer).map((z) => z.j.rute.find((x) => key(x) === key(r))).filter(Boolean);
      o[fer] = { n: X.length, min: median(X.map((x) => x.min)), p90: quant(X.map((x) => x.min), 0.9), liber: median(X.map((x) => x.liber)), istoric: median(X.map((x) => x.istoric)), km: median(X.map((x) => x.km)) };
    }
    return o;
  });
  const pv = CFG.puncte_viteza.map(([la, lo]) => { const o = { p: [la, lo] };
    for (const fer of Object.keys(FER)) { const X = zile.filter((z) => z.fer === fer).map((z) => z.j.viteze.find((v) => v.p[0] === la && v.p[1] === lo)).filter((v) => v && !v.inchis && v.vl > 0);
      o[fer] = X.length ? { n: X.length, r: median(X.map((v) => v.v / v.vl)), v: median(X.map((v) => v.v)), vl: median(X.map((v) => v.vl)) } : null; }
    return o; });
  const inc = {}; const drum = {};
  for (const z of zile) { const L = z.j.incidente || []; const k = z.fer; inc[k] ??= { zile: 0, total: 0, cat: {} }; inc[k].zile++; inc[k].total += L.length;
    for (const x of L) { const c = CAT[x.properties.iconCategory] || 'altele'; inc[k].cat[c] = (inc[k].cat[c] || 0) + 1;
      if (x.properties.iconCategory === 6 || x.properties.iconCategory === 1) for (const rn of (x.properties.roadNumbers || []).slice(0, 1)) { drum[rn] ??= new Set(); drum[rn].add(z.data + z.fer); } } }
  // timpul declarat în anchetă, cu mașina, zile lucrătoare, pe aceleași relații (plecare 06:30–09:30 / 15:30–19:30)
  let decl = null;
  if (exportFile) {
    const { load } = require('./stats.js'); const { isGPS } = require('./compute.js');
    const { rows } = await load(exportFile); decl = {};
    const hm = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : null);
    for (const r of CFG.relatii) for (const fer of Object.keys(FER)) {
      const [a, b] = fer === 'dimineata' ? [390, 570] : [930, 1170];
      const L = rows.filter((x) => x.o === r.o && x.d === r.d && x.mode === 'car' && x.day_type === 'weekday' && x.duration_min <= 180 && !isGPS(x) && hm(x.departure_time) >= a && hm(x.departure_time) <= b).map((x) => x.duration_min);
      if (L.length >= 5) decl[key(r) + '|' + fer] = { n: L.length, med: median(L) };
    }
  }
  return { generat: new Date().toISOString().slice(0, 10), zile: zile.map((z) => z.data + ' ' + z.fer), relatii: rel, puncte: pv, incidente: inc, drumuri: Object.fromEntries(Object.entries(drum).map(([k, v]) => [k, v.size]).sort((a, b) => b[1] - a[1]).slice(0, 8)), declarat: decl };
}

function render(D) {
  const ferestre = Object.keys(FER).filter((f) => D.relatii.some((r) => r[f].n));
  const nZ = (f) => D.zile.filter((z) => z.endsWith(f)).length;
  const zileU = [...new Set(D.zile.map((z) => z.slice(0, 10)))];
  const dmy = (s) => `${+s.slice(8, 10)} ${['ian.', 'feb.', 'mar.', 'apr.', 'mai', 'iun.', 'iul.', 'aug.', 'sept.', 'oct.', 'nov.', 'dec.'][+s.slice(5, 7) - 1]}`;
  // grafic: relațiile spre centru și Copou, cu drum liber, măsurat și declarat
  const chart = (fer) => { const R = D.relatii.filter((r) => r[fer].n).sort((a, b) => b[fer].min - a[fer].min); const x0 = 210, x1 = 590, max = Math.max(60, ...R.map((r) => Math.max(r[fer].p90 || 0, (D.declarat?.[r.o + '>' + r.d + '|' + fer]?.med) || 0))), X = (v) => x0 + ((x1 - x0) * v) / max, h = 20, yb = 60 + R.length * h;
    let s = `<svg class="map" viewBox="0 0 640 ${yb + 40}" role="img" aria-label="Grafic: timpul cu mașina pe relațiile din studiu, ${FER[fer]}"><text x="16" y="28" class="axt">${esc('Minute cu mașina, ' + FER[fer])}</text>`;
    for (let t = 0; t <= max; t += 15) s += `<line x1="${X(t).toFixed(1)}" y1="50" x2="${X(t).toFixed(1)}" y2="${yb}" class="grid"/><text x="${X(t).toFixed(1)}" y="${yb + 16}" text-anchor="middle" class="ax">${t}</text>`;
    R.forEach((r, i) => { const y = 60 + i * h, m = r[fer], dc = D.declarat?.[r.o + '>' + r.d + '|' + fer];
      s += `<text x="${x0 - 6}" y="${y + 13}" text-anchor="end" class="sm">${esc(r.on + ' → ' + r.dn)}</text>`;
      s += `<line x1="${X(m.liber).toFixed(1)}" y1="${y + 9}" x2="${X(m.p90 ?? m.min).toFixed(1)}" y2="${y + 9}" style="stroke:var(--hatch);stroke-width:2"/><circle cx="${X(m.liber).toFixed(1)}" cy="${y + 9}" r="4" style="fill:var(--t1)"/><circle cx="${X(m.min).toFixed(1)}" cy="${y + 9}" r="5.5" style="fill:var(--accent)"/>`;
      if (dc && dc.n >= 5) s += `<rect x="${(X(dc.med) - 1.5).toFixed(1)}" y="${y + 1}" width="3" height="16" style="fill:var(--ink)"/>`; });
    return s + '</svg>'; };
  const speedMap = (fer) => { const P = D.puncte.filter((p) => p[fer]);
    const col = (r) => (r < 0.4 ? 'var(--t4)' : r < 0.6 ? 'var(--t3)' : r < 0.8 ? 'var(--t2)' : 'var(--t1)');
    const extra = P.map((p) => { const [x, y] = proj('ias', p.p[0], p.p[1]); if (x < 8 || x > 632 || y < 44 || y > 592) return ''; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" style="fill:${col(p[fer].r)};stroke:var(--paper);stroke-width:1"><title>${fmt(p[fer].v, 0)} km/h din ${fmt(p[fer].vl, 0)} km/h fără trafic</title></circle>`; }).join('');
    return mapPanel('ias', { fill: () => 'var(--q1)', aria: `Hartă: viteza pe coridoare ${FER[fer]}, față de viteza fără trafic`, ptag: `Viteza pe coridoare, ${FER[fer]}`, extra }); };
  const all = (fer, k) => median(D.relatii.map((r) => r[fer][k] && r[fer].liber ? r[fer][k] / r[fer].liber : null));
  const ixM = all('dimineata', 'min'), ixS = all('seara', 'min');
  const top = (fer) => D.relatii.filter((r) => r[fer].n).map((r) => ({ r, x: r[fer].min / r[fer].liber })).sort((a, b) => b.x - a.x).slice(0, 3);
  const vsT = (fer) => median(D.relatii.map((r) => r[fer].min && r[fer].istoric ? r[fer].min / r[fer].istoric : null));
  const lent = (fer) => D.puncte.filter((p) => p[fer]).length ? D.puncte.filter((p) => p[fer] && p[fer].r < 0.5).length / D.puncte.filter((p) => p[fer]).length : null;
  const dec = D.declarat ? D.relatii.flatMap((r) => ferestre.map((f) => { const dc = D.declarat[r.o + '>' + r.d + '|' + f]; return dc && dc.n >= 5 && r[f].min ? { r, f, dc, m: r[f].min } : null; })).filter(Boolean) : [];
  const incTxt = Object.entries(D.incidente).map(([f, x]) => `${FER[f]}: în medie ${fmt(x.total / x.zile, 0)} de incidente active (${Object.entries(x.cat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${c} ${fmt(n / x.zile, 0)}`).join(', ')})`);
  const N = [];
  N.push(`Colectarea a început pe ${dmy(zileU[0])} și are până acum ${D.zile.length === 1 ? 'o măsurătoare' : nde(D.zile.length, 'măsurători')} (${ferestre.map((f) => `${nZ(f)} ${FER[f].replace(/ \(.*/, '')}`).join(', ')}), ${zileU.length === 1 ? 'într-o singură zi' : `în ${nde(zileU.length, 'zile')}`} de marți, miercuri sau joi. Pe fiecare: timpul cu mașina pe ${D.relatii.length} de relații din studiu, viteza în ${D.puncte.length} de puncte de pe coridoare și incidentele din zona metropolitană.`);
  for (const f of ferestre) { const t = top(f); N.push(`${FER[f][0].toUpperCase() + FER[f].slice(1)}, drumurile au durat median de <b>${fix(f === 'dimineata' ? ixM : ixS, 2)} ori</b> cât fără trafic (${fmt(100 * (vsT(f) - 1), 0)}% față de ce estimează TomTom pentru o zi obișnuită). Cel mai mult au lungit traficul: ${lista(t.map(({ r, x }) => `${r.on} → ${r.dn} (×${fix(x, 2)}, ${fmt(r[f].min, 0)} min)`))}. ${lent(f) != null ? `În ${fmt(100 * lent(f), 0)}% din punctele de pe coridoare se mergea cu mai puțin de jumătate din viteza fără trafic.` : ''}`); }
  if (dec.length) { const r = median(dec.map((x) => x.dc.med / x.m)); N.push(`Pe ${nde(dec.length, 'relații')} cu cel puțin 5 drumuri cu mașina în anchetă la aceeași oră, participanții declară median de <b>${fix(r, 2)} ori</b> timpul măsurat de TomTom. Diferența vine din faptul că oamenii socotesc tot drumul, de acasă până la destinație: parcarea, mersul pe jos, oprirea la școală, plus faptul că oamenii rotunjesc.`); }
  if (incTxt.length) N.push(`Incidente TomTom: ${incTxt.join('; ')}. Drumurile cu cele mai multe zile cu ambuteiaje sau accidente: ${lista(Object.entries(D.drumuri).slice(0, 5).map(([k, v]) => `${k} (${v})`))}.`);
  if (zileU.length < 6) N.push('Colectarea abia a început: cu câteva zile, valorile sunt instantanee. Variabilitatea de la o zi la alta (cât de sigur e timpul de drum) devine măsurabilă după 3–4 săptămâni.');
  const body = fig(...ferestre.map(chart)) + '\n' +
    legend('Relații', [[sw('var(--t1)'), 'fără trafic'], [`<span class="sw-dot" style="background:var(--accent)"></span>`, 'măsurat (mediana zilelor)'], [sw('var(--hatch)'), 'până la a 9-a zi din 10 (P90)'], [sw('var(--ink)'), 'declarat în anchetă (≥ 5 drumuri)']]) + '\n' +
    fig(...ferestre.map(speedMap)) + '\n' +
    legend('Viteza față de cea fără trafic', [[sw('var(--t4)'), 'sub 40%'], [sw('var(--t3)'), '40–60%'], [sw('var(--t2)'), '60–80%'], [sw('var(--t1)'), 'peste 80%']]) + '\n' +
    notes(N) + '\n' +
    table('Datele relațiilor', ['Relație', 'Km', ...ferestre.flatMap((f) => [`${FER[f]}: măsurat`, 'P90', 'fără trafic', 'tipic TomTom', 'declarat (n)'])], D.relatii.map((r) => [`${esc(r.on)} → ${esc(r.dn)}`, fmt(r.dimineata.km ?? r.seara.km), ...ferestre.flatMap((f) => { const dc = D.declarat?.[r.o + '>' + r.d + '|' + f]; return [fmt(r[f].min) + '′', fmt(r[f].p90) + '′', fmt(r[f].liber) + '′', fmt(r[f].istoric) + '′', dc && dc.n ? `${fmt(dc.med)}′ (${dc.n})` : '–']; })]),
      `<p class="fine">Sursa: TomTom (trafic în timp real), colectare automată marți–joi la 07:30 și 17:30, ${D.zile.length} măsurători până la ${dmy(zileU[zileU.length - 1])}. Măsurat = mediana zilelor; P90 = valoarea depășită într-o zi din zece. Declarat = mediana duratelor din anchetă cu mașina, zile lucrătoare, plecare 06:30–09:30 sau 15:30–19:30, pe aceeași pereche de unități.</p>`);
  return section('colectare', 'Traficul la vârf, zi de zi · TomTom', 'Graficul', `${ixM != null ? 'Dimineața' : 'Seara'}, drumurile cu mașina durează de ${fix(ixM ?? ixS, 1)} ori cât fără trafic`, `Colectarea automată TomTom pe relațiile principale din studiu, marți–joi la 07:30 și 17:30, de la ${dmy(zileU[0])}: timpul măsurat lângă timpul fără trafic, cel tipic TomTom și cel declarat de participanți, plus viteza pe coridoare.`, body);
}

(async () => {
  const dir = arg('--dir'); let D;
  if (dir) { D = await agrega(dir, arg('--export')); fs.writeFileSync(path.join(__dirname, 'static', 'colectare.json'), JSON.stringify(D)); }
  else D = JSON.parse(fs.readFileSync(path.join(__dirname, 'static', 'colectare.json'), 'utf8'));
  fs.writeFileSync(path.join(__dirname, 'static', 'colectare.html'), render(D)); console.log('static/colectare.html', D.zile.length, 'măsurători');
})();
