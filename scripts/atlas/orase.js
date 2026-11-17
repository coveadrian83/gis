'use strict';
// Secțiunea fixă „Iași față de alte orașe” (TomTom), din static/orase.json → static/orase.html.
//   node scripts/atlas/orase.js
const fs = require('node:fs');
const path = require('node:path');
const { fmt, fix, esc, fig, legend, sw, notes, table, section } = require('./lib.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'static', 'orase.json'), 'utf8'));
const O = D.orase;
const IASI = (o) => o.oras === 'Iași';
const ORD = ['', 'cel mai lent', 'al doilea cel mai lent', 'al treilea cel mai lent', 'al patrulea cel mai lent', 'al cincilea cel mai lent', 'al șaselea cel mai lent'];
const ord = (r) => ORD[r] || `al ${r}-lea cel mai lent`;
const by = (k) => [...O].filter((o) => o[k]).sort((a, b) => b[k].min6 - a[k].min6);
const H = 36, Y0 = 60;
// grafic: 6 km cu mașina — drum liber, tipic, real (marți)
const chart = (k, title, aria) => { const L = by(k), x0 = 130, x1 = 560, max = 35, X = (v) => x0 + ((x1 - x0) * v) / max, yb = Y0 + L.length * H;
  let s = `<svg class="map" viewBox="0 0 640 ${yb + 40}" role="img" aria-label="${esc(aria)}"><text x="16" y="28" class="axt">${esc(title)}</text>`;
  for (const t of [0, 10, 20, 30]) s += `<line x1="${X(t)}" y1="50" x2="${X(t)}" y2="${yb}" class="grid"/><text x="${X(t)}" y="${yb + 18}" text-anchor="middle" class="ax">${t}</text>`;
  L.forEach((o, i) => { const y = Y0 + i * H, c = IASI(o) ? 'var(--accent)' : 'var(--u4)', m = o[k];
    s += `<text x="${x0 - 8}" y="${y + 20}" text-anchor="end" class="ax-l"${IASI(o) ? ' font-weight="700"' : ''}>${esc(o.oras)}</text>`;
    s += `<line x1="${X(m.liber6).toFixed(1)}" y1="${y + 15}" x2="${X(m.min6).toFixed(1)}" y2="${y + 15}" style="stroke:var(--hatch);stroke-width:3"/>`;
    s += `<circle cx="${X(m.liber6).toFixed(1)}" cy="${y + 15}" r="6" style="fill:var(--t1)"/><circle cx="${X(m.tipic6).toFixed(1)}" cy="${y + 15}" r="5" style="fill:none;stroke:${c};stroke-width:2.5"/><circle cx="${X(m.min6).toFixed(1)}" cy="${y + 15}" r="8" style="fill:${c}"/>`;
    s += `<text x="${(X(Math.max(m.min6, m.tipic6)) + 12).toFixed(1)}" y="${y + 20}" class="ax"><tspan font-weight="700">${fmt(m.min6)}</tspan></text>`; });
  return s + '</svg>'; };
const g1 = chart('m0730', 'Marți 07:30 · 6 km spre centru (minute)', 'Grafic: minute cu mașina pentru 6 km spre centru, marți la 07:30, pe orașe');
const g2 = chart('m1730', 'Marți 17:30 · 6 km dinspre centru (minute)', 'Grafic: minute cu mașina pentru 6 km dinspre centru, marți la 17:30, pe orașe');
const M = by('m0730'), S = by('m1730'), V = by('vineri');
const ia = O.find(IASI), rM = M.findIndex(IASI) + 1, rS = S.findIndex(IASI) + 1, rV = V.findIndex(IASI) + 1;
const byI = [...O].sort((a, b) => b.m0730.indice - a.m0730.indice), rI = byI.findIndex(IASI) + 1;
const byL = [...O].sort((a, b) => b.tipic.liber6 - a.tipic.liber6), rL = byL.findIndex(IASI) + 1;
const and = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' și ' + a[a.length - 1] : a.join(''));
const before = (L, r, k) => and(L.slice(0, r - 1).map((o) => `${o.oras} (${fmt(o[k].min6)})`));
const peste = (o, k) => o[k].min6 - o[k].tipic6;
const dM = peste(ia, 'm0730'), others = O.filter((o) => !IASI(o)).map((o) => peste(o, 'm0730')).sort((a, b) => a - b), dMed = others[others.length >> 1];
const body = fig(g1, g2) + '\n' +
  legend('Puncte', [[sw('var(--t1)'), 'drum liber (fără trafic)'], ['<span class="sw-dot" style="background:var(--u4)"></span>', 'marți 17 nov. (trafic real)'], ['<span class="sw-dot" style="background:none;border:2px solid var(--u4)"></span>', 'aceeași oră într-o marți obișnuită (model TomTom)'], [sw('var(--accent)'), 'Iași']]) + '\n' +
  notes([`Marți, 17 noiembrie, la 07:30, un drum de 6 km spre centru dura cu mașina <b>${fmt(ia.m0730.min6)} minute în Iași</b>: ${ord(rM)} din cele ${O.length} orașe${rM > 1 ? `, după ${before(M, rM, 'm0730')}` : ''}. Într-o marți obișnuită, la aceeași oră, modelul TomTom dă ${fmt(ia.m0730.tipic6)} minute: dimineața aceasta a fost cu ${fmt(dM)} minute mai grea decât de obicei, în timp ce în celelalte orașe abaterea mediană a fost de doar ${fmt(dMed)} minute. Un accident sau o lucrare poate explica diferența, așa că o singură dimineață nu ajunge pentru o concluzie.`,
    `Seara, la 17:30, pe drumul invers (din centru spre cartiere), Iașul a avut <b>${fmt(ia.m1730.min6)} minute</b>, ${ord(rS)} oraș, după ${before(S, rS, 'm1730')}. Seara, Iașul a fost aproape de valoarea obișnuită (${fmt(ia.m1730.tipic6)} minute).`,
    `Traficul de dimineață a înmulțit timpul de drum cu <b>${fix(ia.m0730.indice, 2)}</b> în Iași (locul ${rI} din ${O.length}); cel mai mult în ${byI.slice(0, 2).map((o) => `${o.oras} (${fix(o.m0730.indice, 2)})`).join(' și ')}. În ${and(byI.slice(-3).map((o) => o.oras))}, ora de vârf adaugă mai puțin de un sfert.`,
    `Iașul are o particularitate: drumurile sunt lungi și fără trafic. Pentru 6 km în linie dreaptă se fac ${fmt(ia.tipic.liber6)} minute cu drumul liber, ${rL === 1 ? 'cel mai mult' : `locul ${rL}`} dintre cele ${O.length} orașe (Brașov ${fmt(O.find((o) => o.oras === 'Brașov').tipic.liber6)}, Ploiești ${fmt(O.find((o) => o.oras === 'Ploiești').tipic.liber6)}). Contează dealurile și lipsa legăturilor directe, care lungesc traseele. Peste asta vine traficul.`,
    `Prima măsurătoare, vineri 13 noiembrie la 08:08 (în ${V.length} orașe), arăta același tablou: Iași ${fmt(ia.vineri.min6)} minute, ${ord(rV)}, după ${before(V, rV, 'vineri')}.`,
    `Cum am măsurat: în fiecare oraș, 24 de puncte la 3, 6 și 9 km de centru, în 8 direcții, cu drumul cu mașina până în centru (dimineața) și din centru (seara), toate în aceleași două minute (TomTom). Punctele fără drum în apropiere (râuri, mare, câmp) au fost scoase; în Constanța au rămas doar ${O.find((o) => o.oras === 'Constanța').puncte}. Sunt instantanee din câte o zi, puse lângă modelul de trafic tipic al TomTom.`]) + '\n' +
  table('Datele graficelor', ['Oraș', 'Puncte', '6 km drum liber', '6 km tipic 07:30', '6 km marți 07:30', '6 km marți 17:30', '6 km vineri 08:08', '9 km marți 07:30', 'Indice marți 07:30', 'Indice marți 17:30', 'Viteză marți 07:30'], M.map((o) => [o.oras, o.puncte, fmt(o.tipic.liber6) + '′', fmt(o.tipic.min6) + '′', fmt(o.m0730.min6) + '′', fmt(o.m1730.min6) + '′', o.vineri ? fmt(o.vineri.min6) + '′' : '–', fmt(o.m0730.min9) + '′', fix(o.m0730.indice, 2) + '×', fix(o.m1730.indice, 2) + '×', fix(o.m0730.kmh) + ' km/h']),
    '<p class="fine">Mediane pe punctele fiecărui oraș. Indicele = timpul cu trafic împărțit la timpul cu drumul liber. Viteza = lungimea traseului împărțită la timp. Seara, drumul e din centru spre aceleași puncte. Centre: Piața Unirii (Iași, Cluj-Napoca, Oradea), Piața Universității (București), Piața Victoriei (Timișoara), Piața Mihai Viteazul (Craiova), Piața Sfatului (Brașov), Piața Mare (Sibiu), Piața Tricolorului (Bacău) și centrul civic în celelalte orașe.</p>');
fs.writeFileSync(path.join(__dirname, 'static', 'orase.html'), section('orase', 'Iași față de alte orașe · TomTom', 'Graficul', `Cum se circulă la ora de vârf în Iași, față de alte ${O.length - 1} orașe`, `Timpul cu mașina între centru și cartiere, pe distanțe egale, în ${O.length} orașe mari din România, măsurat în aceleași minute marți 17 noiembrie, la 07:30 (spre centru) și la 17:30 (dinspre centru), lângă modelul de trafic tipic TomTom.`, body));
console.log('static/orase.html');
