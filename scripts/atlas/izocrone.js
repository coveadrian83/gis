'use strict';
// Secțiunea fixă „Izocrone: cât de departe ajungi în 15 minute” (TomTom), din static/izocrone.json → static/izocrone.html.
//   node scripts/atlas/izocrone.js
const fs = require('node:fs');
const path = require('node:path');
const { fmt, esc, legend, sw, notes, table, section, hbarChart } = require('./lib.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'static', 'izocrone.json'), 'utf8')).orase;
const O = [...D].sort((a, b) => a.km2.km2_15min_0730 - b.km2.km2_15min_0730);
const ia = O.find((o) => o.oras === 'Iași');
// hărți mici, aceeași scară: 22 × 22 km în jurul centrului
const cols = 5, cw = 236, ch = 262, map = 206, R = 11; // km de la centru
let s = `<svg class="map" viewBox="0 0 ${cols * cw} ${Math.ceil(O.length / cols) * ch + 10}" role="img" aria-label="Hărți: unde ajungi cu mașina în 15 minute pornind din centru, la 07:30 și noaptea, în 15 orașe, la aceeași scară">`;
O.forEach((o, i) => { const x0 = (i % cols) * cw + 15, y0 = Math.floor(i / cols) * ch + 48, [la, lo] = o.centru, kx = 111.32 * Math.cos((la * Math.PI) / 180), ky = 110.57;
  const P = (pts) => pts.map(([x, y]) => { const px = x0 + map / 2 + (((x - lo) * kx) / R) * (map / 2), py = y0 + map / 2 - (((y - la) * ky) / R) * (map / 2); return `${px.toFixed(1)},${py.toFixed(1)}`; }).join(' ');
  const IA = o.oras === 'Iași', id = 'iz' + i;
  s += `<clipPath id="${id}"><rect x="${x0}" y="${y0}" width="${map}" height="${map}"/></clipPath><rect x="${x0}" y="${y0}" width="${map}" height="${map}" style="fill:var(--panel);stroke:${IA ? 'var(--accent)' : 'var(--rule)'}" stroke-width="${IA ? 3 : 1}"/>`;
  s += `<g clip-path="url(#${id})">`;
  if (o.izo['15_0300']) s += `<polygon points="${P(o.izo['15_0300'])}" style="fill:var(--t1);fill-opacity:.35;stroke:var(--t1)" stroke-width="1"/>`;
  if (o.izo['15_0730']) s += `<polygon points="${P(o.izo['15_0730'])}" style="fill:var(--t4);fill-opacity:.7;stroke:var(--t4)" stroke-width="1"/>`;
  s += `<path d="M${x0 + map / 2} ${y0 + map / 2 - 6} l2 4 4 .5 -3 3 .8 4.5 -3.8 -2 -3.8 2 .8 -4.5 -3 -3 4 -.5z" style="fill:var(--ink)"/></g>`;
  s += `<text x="${x0 + map / 2}" y="${y0 - 22}" text-anchor="middle" class="ax-l"${IA ? ' font-weight="700"' : ''}>${esc(o.oras)}</text><text x="${x0 + map / 2}" y="${y0 - 6}" text-anchor="middle" class="sm">${fmt(o.km2.km2_15min_0730, 0)} km² la 07:30 · ${fmt(o.km2.km2_15min_0300, 0)} noaptea</text>`; });
s += '</svg>';
const grid = `<div class="panels"><figure class="panel" style="grid-column:1/-1">${s}</figure></div>`;
const byP = [...D].sort((a, b) => a.pastrat15 - b.pastrat15);
const g2 = hbarChart({ title: 'Cât din suprafața de noapte rămâne la 07:30 (15 minute)', aria: 'Grafic: ce parte din zona accesibilă în 15 minute noaptea rămâne accesibilă la ora de vârf', max: 100, ticks: [0, 25, 50, 75, 100], x0: 120,
  rows: byP.map((o) => ({ label: o.oras, v: o.pastrat15, color: o.oras === 'Iași' ? 'var(--accent)' : 'var(--u4)', text: `${fmt(o.pastrat15, 0)}%` })) });
const g3 = hbarChart({ title: 'Suprafața accesibilă în 15 minute la 07:30 (km²)', aria: 'Grafic: suprafața accesibilă în 15 minute la ora de vârf, pe orașe', max: 160, ticks: [0, 40, 80, 120, 160], unit: '', x0: 120,
  rows: O.map((o) => ({ label: o.oras, v: o.km2.km2_15min_0730, color: o.oras === 'Iași' ? 'var(--accent)' : 'var(--u4)', text: `${fmt(o.km2.km2_15min_0730, 0)} km²` })) });
const rank = O.findIndex((o) => o.oras === 'Iași') + 1, rankP = byP.findIndex((o) => o.oras === 'Iași') + 1;
const buc = D.find((o) => o.oras === 'București'), bac = D.find((o) => o.oras === 'Bacău'), clj = D.find((o) => o.oras === 'Cluj-Napoca');
const body = grid + '\n' + `<div class="panels"><figure class="panel">${g3}</figure><figure class="panel">${g2}</figure></div>` + '\n' +
  legend('Izocrone de 15 minute', [[sw('var(--t4)'), 'marți 07:30 (trafic tipic)'], [sw('var(--t1)'), 'noaptea, drum liber'], [sw('var(--accent)'), 'Iași']]) + '\n' +
  notes([`Pornind din centrul Iașului, la 07:30 ajungi cu mașina în 15 minute pe <b>${fmt(ia.km2.km2_15min_0730, 0)} km²</b>: locul ${rank} din ${D.length}, după Cluj-Napoca (${fmt(clj.km2.km2_15min_0730, 0)} km²). În Bacău sau Ploiești, zona e de patru ori mai mare.`,
    `Noaptea, din același punct ajungi pe ${fmt(ia.km2.km2_15min_0300, 0)} km². La ora de vârf rămâne doar <b>${fmt(ia.pastrat15, 0)}%</b>, cel mai puțin dintre toate orașele${rankP === 1 ? '' : ` (locul ${rankP})`}. În București rămâne ${fmt(buc.pastrat15, 0)}%, în Bacău ${fmt(bac.pastrat15, 0)}%.`,
    'Forma contează: zona Iașului e o stea cu brațe subțiri, nu un cerc, pentru că se înaintează repede doar pe câteva artere. Între ele, cartierele și comunele sunt departe în timp, deși sunt aproape în linie dreaptă. Inelele și radialele ar umple tocmai golurile dintre brațe.',
    `La 30 de minute, Iașul păstrează la ora de vârf ${fmt(ia.pastrat30, 0)}% din suprafața de noapte, aproape cât Clujul (${fmt(clj.pastrat30, 0)}%) și Bucureștiul (${fmt(buc.pastrat30, 0)}%).`,
    'Cum citim: izocrona e conturul zonei în care ajungi cu mașina în timpul dat, pornind din centrul orașului (TomTom, marți 17 noiembrie, trafic tipic, față de ora 03:00). E o măsură teoretică a accesibilității, calculată pe rețeaua de drumuri, nu numărul de oameni afectați. Hărțile sunt la aceeași scară: 22 × 22 km în jurul centrului.']) + '\n' +
  table('Datele hărților', ['Oraș', '15 min · 07:30', '15 min · noaptea', 'Rămâne', '30 min · 07:30', '30 min · noaptea', 'Rămâne'], O.map((o) => [o.oras, fmt(o.km2.km2_15min_0730, 0) + ' km²', fmt(o.km2.km2_15min_0300, 0) + ' km²', fmt(o.pastrat15, 0) + '%', fmt(o.km2.km2_30min_0730, 0) + ' km²', fmt(o.km2.km2_30min_0300, 0) + ' km²', fmt(o.pastrat30, 0) + '%']));
fs.writeFileSync(path.join(__dirname, 'static', 'izocrone.html'), section('izocrone', 'Izocrone · accesibilitate teoretică · TomTom', 'Harta', `În 15 minute din centrul Iașului ajungi pe ${fmt(ia.km2.km2_15min_0730, 0)} km² la ora de vârf: de trei ori mai puțin decât noaptea`, 'Unde ajungi cu mașina în 15 minute, pornind din centrul fiecărui oraș: la ora de vârf (roșu) și noaptea, cu drumul liber (verde). Toate orașele sunt desenate la aceeași scară, în ordinea suprafeței accesibile la 07:30.', body));
console.log('static/izocrone.html');
