'use strict';
// Secțiunea fixă „Iași față de alte orașe” (TomTom), din static/orase.json → static/orase.html.
//   node scripts/atlas/orase.js
const fs = require('node:fs');
const path = require('node:path');
const { fmt, fix, esc, fig, legend, sw, notes, table, section, barChart, hbarChart, lista } = require('./lib.js');
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
// weekend față de marți: Iași și mediana celorlalte orașe, pe fiecare moment măsurat
const MOM = [['m0730', 'marți 07:30', 'spre centru'], ['m1730', 'marți 17:30', 'din centru'], ['s0730', 'sâmbătă 07:30', 'spre centru'], ['s1730', 'sâmbătă 17:30', 'din centru'], ['d0730', 'duminică 07:30', 'spre centru'], ['d1730', 'duminică 17:30', 'din centru']].filter(([k]) => O.some((o) => o[k]));
const medO = (k) => { const a = O.filter((o) => !IASI(o) && o[k]).map((o) => o[k].min6).sort((x, y) => x - y); const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
const loc = (k) => by(k).findIndex(IASI) + 1;
const g3 = barChart({ title: 'Minute pe 6 km: Iași și mediana celorlalte 14 orașe', aria: 'Grafic: minute cu mașina pe 6 km, în zilele lucrătoare și în weekend, Iași față de celelalte orașe', groups: MOM.map(([k, l]) => ({ label: l.split(' ')[0], sub: l.split(' ')[1] + ' · loc ' + loc(k), values: [ia[k].min6, medO(k)] })), series: [{ color: 'var(--accent)' }, { color: 'var(--u4)' }], max: 35, step: 5 });
const kw = MOM.find(([k]) => k === 's0730') ? 's0730' : MOM[MOM.length - 1][0];
const g4 = hbarChart({ title: 'Sâmbătă 07:30 · 6 km spre centru (minute)', aria: 'Grafic: clasamentul orașelor sâmbătă dimineață', rows: by(kw).map((o) => ({ label: o.oras, v: o[kw].min6, color: IASI(o) ? 'var(--accent)' : 'var(--u4)', text: fmt(o[kw].min6) + ' (fără trafic ' + fmt(o[kw].liber6) + ')' })), max: 25, ticks: [0, 5, 10, 15, 20, 25], unit: '' });
const we = MOM.filter(([k]) => k[0] !== 'm');
const body = fig(g1, g2) + '\n' +
  legend('Puncte', [[sw('var(--t1)'), 'drum liber (fără trafic)'], ['<span class="sw-dot" style="background:var(--u4)"></span>', 'marți 17 nov. (trafic real)'], ['<span class="sw-dot" style="background:none;border:2px solid var(--u4)"></span>', 'aceeași oră într-o marți obișnuită (model TomTom)'], [sw('var(--accent)'), 'Iași']]) + '\n' +
  notes([`Marți, 17 noiembrie, la 07:30, un drum de 6 km spre centru dura cu mașina <b>${fmt(ia.m0730.min6)} minute în Iași</b>: ${ord(rM)} din cele ${O.length} orașe${rM > 1 ? `, după ${before(M, rM, 'm0730')}` : ''}. Într-o marți obișnuită, la aceeași oră, modelul TomTom dă ${fmt(ia.m0730.tipic6)} minute: dimineața aceasta a fost cu ${fmt(dM)} minute mai grea decât de obicei, în timp ce în celelalte orașe abaterea mediană a fost de doar ${fmt(dMed)} minute. Un accident sau o lucrare poate explica diferența, așa că o singură dimineață nu ajunge pentru o concluzie.`,
    `Seara, la 17:30, pe drumul invers (din centru spre cartiere), Iașul a avut <b>${fmt(ia.m1730.min6)} minute</b>, ${ord(rS)} oraș, după ${before(S, rS, 'm1730')}. Seara, Iașul a fost aproape de valoarea obișnuită (${fmt(ia.m1730.tipic6)} minute).`,
    `Traficul de dimineață a înmulțit timpul de drum cu <b>${fix(ia.m0730.indice, 2)}</b> în Iași (locul ${rI} din ${O.length}); cel mai mult în ${byI.slice(0, 2).map((o) => `${o.oras} (${fix(o.m0730.indice, 2)})`).join(' și ')}. În ${and(byI.slice(-3).map((o) => o.oras))}, ora de vârf adaugă mai puțin de un sfert.`,
    `Iașul are o particularitate: drumurile sunt lungi și fără trafic. Pentru 6 km în linie dreaptă se fac ${fmt(ia.tipic.liber6)} minute cu drumul liber, ${rL === 1 ? 'cel mai mult' : `locul ${rL}`} dintre cele ${O.length} orașe (Brașov ${fmt(O.find((o) => o.oras === 'Brașov').tipic.liber6)}, Ploiești ${fmt(O.find((o) => o.oras === 'Ploiești').tipic.liber6)}). Contează dealurile și lipsa legăturilor directe, care lungesc traseele. Peste asta vine traficul.`,
    `Prima măsurătoare, vineri 13 noiembrie la 08:08 (în ${V.length} orașe), arăta același tablou: Iași ${fmt(ia.vineri.min6)} minute, ${ord(rV)}, după ${before(V, rV, 'vineri')}.`,
    `Cum am măsurat: în fiecare oraș, 24 de puncte la 3, 6 și 9 km de centru, în 8 direcții, cu drumul cu mașina până în centru (dimineața) și din centru (seara), toate în aceleași două minute (TomTom). Punctele fără drum în apropiere (râuri, mare, câmp) au fost scoase; în Constanța au rămas doar ${O.find((o) => o.oras === 'Constanța').puncte}. Sunt instantanee din câte o zi, puse lângă modelul de trafic tipic al TomTom.`]) + '\n' +
  fig(g3, g4) + '\n' +
  legend('Weekend față de marți', [[sw('var(--accent)'), 'Iași'], [sw('var(--u4)'), 'mediana celorlalte 14 orașe']]) + '\n' +
  notes([`<b>În weekend, Iașul e mult mai liber:</b> pe 6 km, ${we.map(([k, l]) => `${l} ${fmt(ia[k].min6)} minute`).join(', ')}, față de ${fmt(ia.m0730.min6)} marți dimineață. Traficul de weekend adaugă doar ${lista(we.map(([k]) => fmt(ia[k].min6 - ia[k].liber6) + ' min'))} față de drumul liber.`,
    `<b>Și totuși, în weekend Iașul urcă pe locul 1</b> (${we.map(([k, l]) => `${l}: locul ${loc(k)}`).join(', ')}). Când traficul de navetă dispare, toate orașele ajung aproape de timpul fără trafic, iar clasamentul arată ce rămâne: lungimea și ocolurile traseelor. Iașul are cele mai lungi drumuri pentru aceeași distanță în linie dreaptă, din cauza dealurilor și a lipsei legăturilor directe.`,
    `Diferența dintre marți și sâmbătă dimineață (${fmt(ia.m0730.min6 - ia.s0730.min6)} minute în Iași, față de ${fmt(medO('m0730') - medO('s0730'))} în orașul median) arată cât cântărește traficul de navetă și de școală; diferența dintre sâmbătă și drumul liber arată ce ar rămâne și fără el.`,
    MOM.some(([k]) => k === 'd0730') ? '' : 'Măsurătoarea de duminică dimineață nu s-a putut face (pornirea programată a întârziat), deci duminica e reprezentată doar de seară.'].filter(Boolean)) + '\n' +
  table('Datele graficelor', ['Oraș', 'Puncte', '6 km drum liber', '6 km tipic 07:30', '6 km marți 07:30', '6 km marți 17:30', '6 km vineri 08:08', ...we.map(([, l]) => '6 km ' + l), '9 km marți 07:30', 'Indice marți 07:30', 'Indice marți 17:30', 'Viteză marți 07:30'], M.map((o) => [o.oras, o.puncte, fmt(o.tipic.liber6) + '′', fmt(o.tipic.min6) + '′', fmt(o.m0730.min6) + '′', fmt(o.m1730.min6) + '′', o.vineri ? fmt(o.vineri.min6) + '′' : '–', ...we.map(([k]) => (o[k] ? fmt(o[k].min6) + '′' : '–')), fmt(o.m0730.min9) + '′', fix(o.m0730.indice, 2) + '×', fix(o.m1730.indice, 2) + '×', fix(o.m0730.kmh) + ' km/h']),
    '<p class="fine">Mediane pe punctele fiecărui oraș. Indicele = timpul cu trafic împărțit la timpul cu drumul liber. Viteza = lungimea traseului împărțită la timp. Seara, drumul e din centru spre aceleași puncte. Centre: Piața Unirii (Iași, Cluj-Napoca, Oradea), Piața Universității (București), Piața Victoriei (Timișoara), Piața Mihai Viteazul (Craiova), Piața Sfatului (Brașov), Piața Mare (Sibiu), Piața Tricolorului (Bacău) și centrul civic în celelalte orașe.</p>');
fs.writeFileSync(path.join(__dirname, 'static', 'orase.html'), section('orase', 'Iași față de alte orașe · TomTom', 'Graficul', `Cum se circulă la ora de vârf în Iași, față de alte ${O.length - 1} orașe`, `Timpul cu mașina între centru și cartiere, pe distanțe egale, în ${O.length} orașe mari din România, măsurat în aceleași minute marți 17 noiembrie, la 07:30 (spre centru) și la 17:30 (dinspre centru), lângă modelul de trafic tipic TomTom.`, body));
console.log('static/orase.html');
