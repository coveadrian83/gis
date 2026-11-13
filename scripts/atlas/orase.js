'use strict';
// Secțiunea fixă „Iași față de alte orașe” (TomTom), din static/orase.json → static/orase.html.
//   node scripts/atlas/orase.js
const fs = require('node:fs');
const path = require('node:path');
const { fmt, fix, esc, fig, legend, sw, notes, table, section } = require('./lib.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'static', 'orase.json'), 'utf8'));
const O = D.orase;
const IASI = (o) => o.oras === 'Iași';
// grafic 1: minute pentru 6 km spre centru, acum (live) și cu drumul liber
const byT = [...O].sort((a, b) => b.live.min6 - a.live.min6);
const g1 = (() => { const x0 = 130, x1 = 560, max = 35, X = (v) => x0 + ((x1 - x0) * v) / max, h = 44;
  let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="Grafic: minute cu mașina pentru 6 km spre centru, pe orașe"><text x="16" y="28" class="axt">6 km spre centru cu mașina (minute)</text>`;
  for (const t of [0, 10, 20, 30]) s += `<line x1="${X(t)}" y1="50" x2="${X(t)}" y2="${56 + byT.length * h}" class="grid"/><text x="${X(t)}" y="${74 + byT.length * h}" text-anchor="middle" class="ax">${t}</text>`;
  byT.forEach((o, i) => { const y = 60 + i * h, c = IASI(o) ? 'var(--accent)' : 'var(--u4)';
    s += `<text x="${x0 - 8}" y="${y + 20}" text-anchor="end" class="ax-l"${IASI(o) ? ' font-weight="700"' : ''}>${esc(o.oras)}</text>`;
    s += `<line x1="${X(o.tipic.liber6).toFixed(1)}" y1="${y + 15}" x2="${X(o.live.min6).toFixed(1)}" y2="${y + 15}" style="stroke:var(--hatch);stroke-width:3"/>`;
    s += `<circle cx="${X(o.tipic.liber6).toFixed(1)}" cy="${y + 15}" r="6" style="fill:var(--t1)"/><circle cx="${X(o.tipic.min6).toFixed(1)}" cy="${y + 15}" r="5" style="fill:none;stroke:${c};stroke-width:2.5"/><circle cx="${X(o.live.min6).toFixed(1)}" cy="${y + 15}" r="8" style="fill:${c}"/>`;
    s += `<text x="${(X(o.live.min6) + 12).toFixed(1)}" y="${y + 20}" class="ax"><tspan font-weight="700">${fmt(o.live.min6)}</tspan></text>`; });
  return s + '</svg>'; })();
// grafic 2: de câte ori mai mult decât cu drumul liber
const byI = [...O].sort((a, b) => b.live.indice - a.live.indice);
const g2 = (() => { const x0 = 130, x1 = 560, lo = 1, hi = 2, X = (v) => x0 + ((x1 - x0) * (v - lo)) / (hi - lo), h = 44;
  let s = `<svg class="map" viewBox="0 0 640 600" role="img" aria-label="Grafic: de câte ori durează drumul mai mult decât cu drumul liber, pe orașe"><text x="16" y="28" class="axt">De câte ori mai mult decât cu drumul liber</text>`;
  for (const t of [1, 1.25, 1.5, 1.75, 2]) s += `<line x1="${X(t)}" y1="50" x2="${X(t)}" y2="${56 + byI.length * h}" class="grid"/><text x="${X(t)}" y="${74 + byI.length * h}" text-anchor="middle" class="ax">${fix(t, 2).replace(',00', '')}×</text>`;
  byI.forEach((o, i) => { const y = 60 + i * h, c = IASI(o) ? 'var(--accent)' : 'var(--u4)', w = X(o.live.indice) - x0;
    s += `<text x="${x0 - 8}" y="${y + 20}" text-anchor="end" class="ax-l"${IASI(o) ? ' font-weight="700"' : ''}>${esc(o.oras)}</text><rect x="${x0}" y="${y + 4}" width="${w.toFixed(1)}" height="22" style="fill:${c}"/>`;
    s += `<line x1="${X(o.tipic.indice).toFixed(1)}" y1="${y}" x2="${X(o.tipic.indice).toFixed(1)}" y2="${y + 30}" style="stroke:var(--ink);stroke-width:2.5"/><text x="${(X(Math.max(o.live.indice, o.tipic.indice)) + 8).toFixed(1)}" y="${y + 20}" class="ax"><tspan font-weight="700">${fix(o.live.indice, 2)}×</tspan></text>`; });
  return s + '</svg>'; })();
const ia = O.find(IASI), rank = byT.findIndex(IASI) + 1, rankI = byI.findIndex(IASI) + 1;
const buc = O.find((o) => o.oras === 'București'), clj = O.find((o) => o.oras === 'Cluj-Napoca'), tm = O.find((o) => o.oras === 'Timișoara');
const body = fig(g1, g2) + '\n' +
  legend('Puncte și bare', [[sw('var(--t1)'), 'drum liber (noaptea)'], ['<span class="sw-dot" style="background:var(--u4)"></span>', 'vineri 13 nov., 08:08 (trafic real)'], ['<span class="sw-dot" style="background:none;border:2px solid var(--u4)"></span>', 'o marți obișnuită, 07:30 (trafic tipic)'], [sw('var(--accent)'), 'Iași']]) + '\n' +
  notes([`Vineri dimineață, la 08:08, un drum de 6 km spre centru dura cu mașina <b>${fmt(ia.live.min6)} minute în Iași</b>: al ${rank}-lea cel mai lent din ${O.length} orașe, după ${byT.slice(0, rank - 1).map((o) => `${o.oras} (${fmt(o.live.min6)})`).join(', ')}. Într-o marți obișnuită, la 07:30: ${fmt(ia.tipic.min6)} minute.`,
    `Traficul înmulțea timpul de drum cu <b>${fix(ia.live.indice, 2)}</b> în Iași, cât în Timișoara (${fix(tm.live.indice, 2)}), dar mai puțin decât în Cluj-Napoca (${fix(clj.live.indice, 2)}) și București (${fix(buc.live.indice, 2)}). În Galați, Constanța, Craiova sau Ploiești, ora de vârf adaugă doar o treime sau mai puțin.`,
    `Iași are o particularitate: drumurile sunt lungi și cu drumul liber. Pentru 6 km în linie dreaptă, noaptea se fac ${fmt(ia.tipic.liber6)} minute, cel mai mult dintre cele ${O.length} orașe (Brașov ${fmt(O.find((o) => o.oras === 'Brașov').tipic.liber6)}, Ploiești ${fmt(O.find((o) => o.oras === 'Ploiești').tipic.liber6)}). Probabil contează dealurile și lipsa legăturilor directe, care lungesc traseele. Peste asta vine traficul.`,
    `La 9 km de centru, Iași (${fmt(ia.live.min9)} minute vineri) e aproape la egalitate cu Cluj-Napoca (${fmt(clj.live.min9)}); doar București e mai lent (${fmt(buc.live.min9)}).`,
    'Cum am măsurat: în fiecare oraș, 24 de puncte la 3, 6 și 9 km de centru, în 8 direcții, cu drumul cu mașina până în centru (TomTom). Punctele fără drum în apropiere (râuri, mare, câmp) au fost scoase; în Constanța au rămas doar 13. E o singură dimineață de vineri, deci un instantaneu, completat cu modelul de trafic tipic al TomTom.']) + '\n' +
  table('Datele graficelor', ['Oraș', 'Puncte', '3 km acum', '6 km acum', '9 km acum', '6 km tipic 07:30', '6 km drum liber', 'Indice acum', 'Indice tipic', 'Viteză acum'], byI.map((o) => [o.oras, o.puncte, fmt(o.live.min3) + '′', fmt(o.live.min6) + '′', fmt(o.live.min9) + '′', fmt(o.tipic.min6) + '′', fmt(o.tipic.liber6) + '′', fix(o.live.indice, 2) + '×', fix(o.tipic.indice, 2) + '×', fix(o.live.kmh) + ' km/h']),
    '<p class="fine">Mediane pe punctele fiecărui oraș. Indicele = timpul cu trafic împărțit la timpul cu drumul liber. Viteza = lungimea traseului împărțită la timp. Centre: Piața Unirii (Iași, Cluj-Napoca, Oradea), Piața Universității (București), Piața Victoriei (Timișoara), Piața Mihai Viteazul (Craiova), Piața Sfatului (Brașov), Piața Mare (Sibiu) și centrul civic în celelalte orașe.</p>');
fs.writeFileSync(path.join(__dirname, 'static', 'orase.html'), section('orase', 'Iași față de alte orașe · TomTom', 'Graficul', 'Cum se circulă dimineața în Iași, față de alte zece orașe', 'Timpul cu mașina spre centru, pe distanțe egale, în 11 orașe mari din România: măsurat în aceleași minute, vineri 13 noiembrie la 08:08, și într-o marți obișnuită la 07:30, după modelul de trafic TomTom.', body));
console.log('static/orase.html');
