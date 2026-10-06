'use strict';
// Verifică fișierele geografice din public/data (sau GEO_DATA_DIR) și raportează ce a fost detectat.
const config = require('../server/config.js');
const { loadGeo, geoStatus, FILES } = require('../server/geo.js');
const GeoCore = require('../public/shared/geo-core.js');

const geo = loadGeo(config.DATA_DIR);
const st = geoStatus(geo);
console.log(`Director: ${config.DATA_DIR}`);
for (const [k, f] of Object.entries(FILES)) console.log(`  ${f.padEnd(36)} ${k.startsWith('localities') ? (st.files.localities ? 'OK' : 'lipsă') : (st.files[k] ? 'OK' : 'lipsă')}`);
console.log('\nDetectat:', JSON.stringify(st.counts));
console.log('UAT Iași:', st.iasi_uat ? `${st.iasi_uat.name} (${st.iasi_uat.siruta})` : 'NEGĂSIT');
console.log('\nZone:');
geo.zones.forEach((z) => console.log(`  ${z.code} ${z.name.padEnd(28)} ${z.polygons.length ? z.polygons.length + ' poligon(e)' : 'FĂRĂ GEOMETRIE'}`));
if (geo.uats.length) {
  console.log('\nUAT-uri:');
  geo.uats.forEach((u) => console.log(`  ${u.siruta.padEnd(7)} ${u.name.padEnd(22)} ${geo.localities.filter((l) => l.uat_siruta === u.siruta).length} localități`));
}
const orphan = geo.localities.filter((l) => !geo.uatBySiruta[l.uat_siruta]);
if (orphan.length) console.log(`\n${orphan.length} localități fără UAT corespunzător (ex.: ${orphan.slice(0, 5).map((l) => l.name).join(', ')})`);

// Teste de căutare din ghidul de testare v0.4.5
console.log('\nCăutări de control:');
for (const q of ['Paun', 'Visan', 'Valea Adanca', 'Gara', 'Universitate', 'Palas', 'tatarasi', 'podu ros', 'Dancu', 'Breazu']) {
  const r = GeoCore.search(geo, q, 3);
  console.log(`  ${q.padEnd(14)} → ${r.length ? r.map((e) => `${e.label} [${e.kind}]`).join(' | ') : '(nimic)'}`);
}
if (st.warnings.length) {
  console.log(`\nAvertismente (${st.warnings.length}):`);
  st.warnings.slice(0, 40).forEach((w) => console.log('  - ' + w));
}
process.exitCode = st.files.zones && st.files.uats && st.files.localities && st.iasi_uat ? 0 : 1;
