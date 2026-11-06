'use strict';
// Colectarea traficului real TomTom pe relațiile principale din studiu, la orele de vârf (punctul 4 din analiza TomTom).
// Rulează din acțiunea GitHub .github/workflows/tomtom-trafic.yml; rezultatele se salvează pe branch-ul date/tomtom
// (nu pe main), în data/tomtom/colectare/AAAA-LL-ZZ_dimineata.json și _seara.json.
// La fiecare rulare: timpul de drum cu traficul de acum pe cele 26 de relații (26 de cereri), viteza pe 160 de puncte
// de pe coridoare (160) și incidentele din zona metropolitană (1) – în total ~190 de cereri, sub limita gratuită zilnică.
// Cheia vine din variabila de mediu TOMTOM_KEY (secret GitHub), niciodată din cod.
//   node scripts/tomtom-trafic.js --out <dosar>            colectează doar în fereastra de vârf (ora României)
//   node scripts/tomtom-trafic.js --out <dosar> --forteaza  colectează oricând (pornire manuală, test)
const fs = require('node:fs');
const path = require('node:path');

const FERESTRE = [['dimineata', 7 * 60, 9 * 60], ['seara', 17 * 60, 19 * 60]];

// ora locală (Europe/Bucharest) a unui moment: { data: 'AAAA-LL-ZZ', min: minute de la miezul nopții, zi: 1=luni..7=duminică }
function oraLocala(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute, ora: `${p.hour}:${p.minute}`, zi: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1 };
}

// fereastra de vârf în care cade momentul (sau null)
function fereastra(d) {
  const { min } = oraLocala(d);
  const f = FERESTRE.find(([, a, b]) => min >= a && min < b);
  return f ? f[0] : null;
}

function numeFisier(d, fer) { return `${oraLocala(d).data}_${fer}.json`; }

const r1 = (v) => (v == null ? null : +(+v).toFixed(1));

async function cerere(url, key, opts = {}) {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key), opts);
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (i + 1))); continue; }
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch { /* răspuns care nu e JSON */ }
    return { status: res.status, j };
  }
  return { status: 429, j: null };
}

async function colecteaza(cfg, key, acum = new Date()) {
  const out = { moment_utc: acum.toISOString(), ora_locala: oraLocala(acum).ora, sursa: 'TomTom (trafic în timp real)', rute: [], viteze: [], incidente: null, erori: [] };
  for (const r of cfg.relatii) {
    const x = await cerere(`https://api.tomtom.com/routing/1/calculateRoute/${r.oc[0]},${r.oc[1]}:${r.dc[0]},${r.dc[1]}/json?routeType=fastest&traffic=true&travelMode=car&computeTravelTimeFor=all&routeRepresentation=summaryOnly`, key);
    if (x.status !== 200 || !x.j || !x.j.routes) { out.erori.push(['ruta', r.o, r.d, x.status]); continue; }
    const s = x.j.routes[0].summary;
    out.rute.push({ o: r.o, d: r.d, km: r1(s.lengthInMeters / 1000), min: r1(s.travelTimeInSeconds / 60), liber: r1(s.noTrafficTravelTimeInSeconds / 60), istoric: r1(s.historicTrafficTravelTimeInSeconds / 60), intarziere: r1(s.trafficDelayInSeconds / 60) });
  }
  for (const [la, lo] of cfg.puncte_viteza) {
    const x = await cerere(`https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/12/json?point=${la},${lo}&unit=KMPH`, key);
    if (x.status !== 200 || !x.j || !x.j.flowSegmentData) { out.erori.push(['viteza', la, lo, x.status]); continue; }
    const f = x.j.flowSegmentData;
    out.viteze.push({ p: [la, lo], frc: f.frc, v: f.currentSpeed, vl: f.freeFlowSpeed, t: f.currentTravelTime, tl: f.freeFlowTravelTime, incredere: f.confidence, inchis: f.roadClosure });
  }
  const b = cfg.bbox.join(',');
  const fields = '{incidents{type,geometry{type,coordinates},properties{iconCategory,magnitudeOfDelay,events{description,code},startTime,endTime,from,to,length,delay,roadNumbers}}}';
  const x = await cerere(`https://api.tomtom.com/traffic/services/5/incidentDetails?bbox=${b}&fields=${encodeURIComponent(fields)}&language=ro-RO&timeValidityFilter=present`, key);
  if (x.status === 200 && x.j) out.incidente = x.j.incidents || []; else out.erori.push(['incidente', x.status]);
  return out;
}

async function main(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--out'); const dir = i >= 0 ? argv[i + 1] : 'data/tomtom/colectare';
  const forteaza = argv.includes('--forteaza');
  const key = process.env.TOMTOM_KEY;
  if (!key) { console.error('Lipsește TOMTOM_KEY (adaug-o ca secret în GitHub: Settings → Secrets and variables → Actions).'); return 1; }
  const acum = new Date();
  const fer = fereastra(acum) || (forteaza ? 'manual' : null);
  if (!fer) { console.log(`Ora ${oraLocala(acum).ora} (România) e în afara ferestrelor de vârf; nu colectez.`); return 0; }
  const fis = path.join(dir, fer === 'manual' ? `${oraLocala(acum).data}_manual_${oraLocala(acum).ora.replace(':', '')}.json` : numeFisier(acum, fer));
  if (fs.existsSync(fis)) { console.log(`Există deja ${fis}; nu colectez din nou.`); return 0; }
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'tomtom', 'config.json'), 'utf8'));
  const out = await colecteaza(cfg, key, acum);
  out.fereastra = fer;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fis, JSON.stringify(out));
  console.log(`${fis}: ${out.rute.length} rute, ${out.viteze.length} viteze, ${out.incidente ? out.incidente.length : '–'} incidente, ${out.erori.length} erori`);
  // dacă aproape totul a eșuat (cheie greșită, limită depășită), acțiunea trebuie să apară cu roșu
  return out.rute.length < cfg.relatii.length / 2 ? 1 : 0;
}

module.exports = { oraLocala, fereastra, numeFisier, FERESTRE };
if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
