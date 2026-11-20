'use strict';
// Secțiunea fixă „Izocrone de acces: periurban ↔ centru, pe moduri”, din static/acces.json → static/acces.html.
// Grila de 1 km (TP, bicicletă, pe jos) și de 1,5 km (mașina, TomTom) peste ZMI; timpul până în Piața Unirii și înapoi.
//   node scripts/atlas/acces.js
const fs = require('node:fs');
const path = require('node:path');
const { GEOM, shortName, mii, fmt, fix, esc, fig, legend, sw, notes, table, section, mapPanel, lista, nde } = require('./lib.js');
const D = JSON.parse(fs.readFileSync(path.join(__dirname, 'static', 'acces.json'), 'utf8'));
const U = D.unitati;
const BANDS = [[15, 'var(--f4)', '≤ 15 min'], [30, 'var(--f3)', '15–30'], [45, 'var(--f2)', '30–45'], [60, 'var(--t3)', '45–60'], [90, 'var(--t4)', '60–90'], [Infinity, 'var(--hatch)', 'peste 90']];
const col = (v) => (v == null ? 'none' : BANDS.find(([m]) => v <= m)[1]);
const contur = (panel) => GEOM[panel].units.map((u) => `<path d="${u.d}" style="fill:none;stroke:var(--paper)" stroke-width="${u.id.startsWith('IAS') ? 0.5 : 0.9}" stroke-linejoin="round" pointer-events="none"/>`).join('');
const centru = (panel) => { const a = GEOM[panel].anchors['IAS-Z15'] || GEOM[panel].units.find((u) => u.id === 'IAS-Z15').c; return `<circle cx="${a[0]}" cy="${a[1]}" r="5" style="fill:var(--ink);stroke:var(--paper);stroke-width:2"/>`; };
// etichete: comunele pe harta ZMI, cartierele pe harta mărită a Iașului
const etZ = Object.entries(U).filter(([id]) => id.startsWith('UAT')).map(([id, u]) => ({ id, lines: [['sm', u.n.replace(/ş/g, 'ș').replace(/ţ/g, 'ț').replace(/Ş/g, 'Ș').replace(/Ţ/g, 'Ț')]] }));
const etI = Object.keys(U).filter((id) => id.startsWith('IAS')).map((id) => ({ id, lines: [['lbl', shortName(id) || U[id].n]] }));
function harta(cells, k, ptag, aria, panel = 'zmi') {
  const iz = panel === 'zmi' ? D.iz[k] : D.iz_ias[k];
  const under = (iz || []).map((d, i) => (d ? `<path d="${d}" fill-rule="evenodd" style="fill:${BANDS[i][1]};stroke:var(--paper);stroke-width:0.6"/>` : '')).join('');
  return mapPanel(panel, { fill: () => 'var(--q1)', aria, ptag, under, extra: contur(panel) + centru(panel), labels: panel === 'zmi' ? etZ : etI });
}
const zoom = (k1, k2, t1, t2) => fig(harta(null, k1, 'Iași, mărit · ' + t1, 'Hartă mărită pe Iași: ' + t1, 'ias'), harta(null, k2, 'Iași, mărit · ' + t2, 'Hartă mărită pe Iași: ' + t2, 'ias'));
const km2 = (k, upto) => (D.iz_km2[k] || []).slice(0, upto).reduce((a, b) => a + b, 0);
const g = (a, b, k1, k2, t1, t2, ar1, ar2) => fig(harta(a, k1, t1, ar1), harta(b, k2, t2, ar2));
const comune = Object.entries(U).filter(([id]) => id.startsWith('UAT')).map(([id, u]) => ({ id, ...u }));
const cart = Object.entries(U).filter(([id]) => id.startsWith('IAS')).map(([id, u]) => ({ id, ...u }));
const med = (a) => { a = a.filter((v) => v != null).sort((x, y) => x - y); const n = a.length; return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };
// comunele din primul inel (cele cu drumuri în anchetă) – raportul TP / mașină
const rap = comune.filter((u) => u.cs && u.tps && u.tps <= 120).map((u) => ({ ...u, r: u.tps / u.cs })).sort((a, b) => a.r - b.r);
const rMed = med(rap.map((u) => u.r)), rCart = med(cart.filter((u) => u.cs && u.tps).map((u) => u.tps / u.cs));
const tp60 = comune.filter((u) => u.tps != null && u.tps <= 60).length;
const trafic = med(comune.map((u) => (u.cs && u.cl ? u.cs / u.cl : null)));
const obsCmp = Object.entries(U).filter(([, u]) => u.obs_spre?.masina?.n >= 10 && u.cs).map(([id, u]) => ({ n: u.n, d: u.obs_spre.masina.med, m: u.cs, k: u.obs_spre.masina.n }));
const obsTp = Object.entries(U).filter(([, u]) => u.obs_spre?.tp?.n >= 7 && u.tps).map(([id, u]) => ({ n: u.n, d: u.obs_spre.tp.med, m: u.tps, k: u.obs_spre.tp.n }));
const top = (L, k, n = 3) => [...L].filter((u) => u[k] != null).sort((a, b) => a[k] - b[k]).slice(0, n);
const nm = (u) => u.n;
const tpv = (v) => (v == null ? '–' : v > 120 ? '> 120' : fmt(v, 0));
const bic = comune.filter((u) => u.bic != null && u.bic <= 45 && u.cs != null);
const body =
  g(D.c15, D.c15, 'cs', 'cl', 'Mașina spre centru, marți 07:30', 'Mașina, fără trafic', 'Hartă: minute cu mașina până în centru, marți la 07:30 (trafic tipic TomTom)', 'Hartă: minute cu mașina până în centru, fără trafic') + '\n' +
  zoom('cs', 'cl', 'mașina 07:30', 'fără trafic') + '\n' +
  g(D.c1, D.c1, 'tps', 'tpd', 'Transport public spre centru, 07:00–08:00', 'Transport public din centru, 17:00–18:00', 'Hartă: minute cu transportul public până în centru, plecare între 07:00 și 08:00', 'Hartă: minute cu transportul public din centru, plecare între 17:00 și 18:00') + '\n' +
  zoom('tps', 'tpd', 'TP 07:00–08:00', 'TP 17:00–18:00') + '\n' +
  g(D.c1, D.c1, 'bic', 'jos', 'Bicicleta (în ambele sensuri)', 'Pe jos (în ambele sensuri)', 'Hartă: minute cu bicicleta până în centru', 'Hartă: minute pe jos până în centru') + '\n' +
  zoom('bic', 'jos', 'bicicleta', 'pe jos') + '\n' +
  legend('Minute până în Piața Unirii (sau înapoi)', BANDS.map(([, c, t]) => [sw(c), t])) + '\n' +
  notes([
    `<b>Mașina</b>, marți la 07:30: din comunele limitrofe, centrul e la ${lista(top(comune, 'cs').map((u) => `${nm(u)} ${fmt(u.cs, 0)}`))} de minute (mediana punctelor din zona construită); din ${lista([...comune].filter((u) => u.cs != null).sort((a, b) => b.cs - a.cs).slice(0, 2).map((u) => `${nm(u)} (${fmt(u.cs, 0)})`))}, cel mai departe. Traficul de dimineață lungește drumul din comune de ${fix(trafic, 2)} ori față de drumul liber; seara, din centru spre comune, ${fix(med(comune.map((u) => (u.cd && u.cl ? u.cd / u.cl : null))), 2)}.`,
    `<b>Transportul public</b> (orarul CTP, cu așteptarea și mersul pe jos până la stație): în cartierele Iașului durează median de ${fix(rCart, 1)} ori cât mașina, iar în cele ${rap.length} comune unde TP ajunge în centru în cel mult două ore, de ${fix(rMed, 1)} ori. ${tp60 === 1 ? 'Doar o comună din' : `Doar ${tp60} comune din`} ${comune.length} ${tp60 === 1 ? 'are' : 'au'} centrul la cel mult o oră cu TP (${lista(comune.filter((u) => u.tps != null && u.tps <= 60).sort((a, b) => a.tps - b.tps).map((u) => `${nm(u)} ${fmt(u.tps, 0)}`))}). Unde nu e nicio linie, timpul e cel de mers pe jos până la prima stație, adică practic lipsa accesului (banda gri).`,
    `<b>Bicicleta</b>, la 15 km/h pe străzile OSM, fără pante: ${lista(top(cart, 'bic', 20).filter((u) => u.bic <= 20).map(nm).slice(0, 8))} sunt la cel mult 20 de minute de centru. Din ${bic.length ? lista(bic.sort((a, b) => a.bic - b.bic).slice(0, 4).map((u) => `${nm(u)} (${fmt(u.bic, 0)} min, cu mașina ${fmt(u.cs, 0)})`)) : '–'}, bicicleta e comparabilă cu mașina la vârf, dacă ar exista piste sigure. Dealurile (Copou, Bucium, Galata) adaugă timp la urcare.`,
    obsCmp.length ? `<b>Ce declară participanții</b> (${nde(D.meta.obs_total.spre, 'drumuri')} spre centru, ${nde(D.meta.obs_total.dinspre, 'drumuri')} din centru, zile lucrătoare): cu mașina, ${lista(obsCmp.sort((a, b) => b.k - a.k).slice(0, 4).map((x) => `${x.n} ${fmt(x.d, 0)} min declarat față de ${fmt(x.m, 0)} măsurat (${x.k} drumuri)`))}. ${obsTp.length ? `Cu TP: ${lista(obsTp.sort((a, b) => b.k - a.k).slice(0, 4).map((x) => `${x.n} ${fmt(x.d, 0)} față de ${fmt(x.m, 0)}`))}.` : ''} Oamenii socotesc tot drumul, de acasă până la destinație, cu parcarea și opririle, deci timpii lor sunt mai lungi decât modelul.` : '',
    `<b>Suprafața accesibilă în 30 de minute</b> din centru (sau spre centru): cu mașina ${mii(km2('cs', 2))} km² la vârf și ${mii(km2('cl', 2))} km² fără trafic; cu transportul public ${mii(km2('tps', 2))} km²; cu bicicleta ${mii(km2('bic', 2))} km²; pe jos ${mii(km2('jos', 2))} km². Într-o oră: mașina acoperă practic toată zona metropolitană (${mii(km2('cs', 4))} km²), transportul public ${mii(km2('tps', 4))} km².`,
    `Ce înseamnă pentru planificare: unde harta TP e roșie sau gri, iar cea a mașinii e verde (sudul și estul periurban), oamenii nu au o alternativă reală la mașină. Acolo o linie metropolitană directă, cu bandă dedicată pe radiale, schimbă cel mai mult accesul la centru.`,
    `Cum am calculat: grilă de 1 km peste cele 28 de unități ale ZMI (${nde(D.meta.puncte_1km.toLocaleString('de-DE'), 'pătrate')}) pentru TP, bicicletă și pe jos și de 1,5 km (${D.meta.puncte_15km}) pentru mașină; destinația e Piața Unirii. Mașina: TomTom, trafic tipic de marți la 07:30 spre centru și la 17:30 din centru. TP: orarul GTFS CTP (zi lucrătoare), cu mersul pe jos la stație (până la 1,5 km) și transferuri; timpul e mediana plecărilor la fiecare 5 minute într-o oră. Liniile metropolitane fără orar în GTFS (${D.meta.sintetice.join(', ')}) sunt incluse cu o cursă la 30 de minute și 22 km/h (ipoteză). Pe jos: 4,8 km/h; bicicleta: 15 km/h. Benzile concentrice sunt interpolate din punctele grilei (raster de 200 m, ușor netezit), deci sunt o imagine de ansamblu; valorile exacte pe unități sunt în tabel. Mediana pe unitate folosește doar punctele din zona construită.`].filter(Boolean)) + '\n' +
  table('Datele pe unități (mediane, minute)', ['Unitate', 'Mașina 07:30', 'Mașina fără trafic', 'Mașina 17:30 (din centru)', 'TP spre centru', 'TP din centru', 'Bicicleta', 'Pe jos', 'Declarat mașină (n)', 'Declarat TP (n)'],
    [...cart.sort((a, b) => (a.cs ?? 99) - (b.cs ?? 99)), ...comune.sort((a, b) => (a.cs ?? 999) - (b.cs ?? 999))].map((u) => [esc(u.n), fmt(u.cs, 0), fmt(u.cl, 0), fmt(u.cd, 0), tpv(u.tps), tpv(u.tpd), fmt(u.bic, 0), fmt(u.jos, 0), u.obs_spre?.masina ? `${fmt(u.obs_spre.masina.med, 0)} (${u.obs_spre.masina.n})` : '–', u.obs_spre?.tp ? `${fmt(u.obs_spre.tp.med, 0)} (${u.obs_spre.tp.n})` : '–']),
    '<p class="fine">Valorile din tabel sunt mediane pe pătratele din zona construită a fiecărei unități (intravilanul 2020, cu 250 m în jur). „Declarat” = mediana duratelor din anchetă spre centru (destinația la cel mult 1,5 km de Piața Unirii), zile lucrătoare, fără jurnalul GPS.</p>');
fs.writeFileSync(path.join(__dirname, 'static', 'acces.html'), section('acces', 'Izocrone de acces · periurban ↔ centru', 'Harta', `Din comune, transportul public face median de ${fix(rMed, 1)} ori timpul mașinii`, 'În cât timp se ajunge în centrul Iașului (Piața Unirii) și înapoi, din toată zona metropolitană, în benzi de câte 15 minute: cu mașina la ora de vârf și fără trafic, cu transportul public dimineața și seara, cu bicicleta și pe jos. Lângă model, timpii declarați în anchetă.', body));
console.log('static/acces.html');
