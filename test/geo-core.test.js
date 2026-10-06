'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const GeoCore = require('../public/shared/geo-core.js');
const Domain = require('../public/shared/domain.js');
const { build } = require('./fixtures.js');

const geo = build();

test('normalizare fără diacritice (ș/ş, ț/ţ, majuscule)', () => {
  assert.equal(GeoCore.normalize('Tătărași'), 'tatarasi');
  assert.equal(GeoCore.normalize('VIŞAN'), 'visan');
  assert.equal(GeoCore.normalize('Podu Roș'), 'podu ros');
  assert.equal(GeoCore.normalize('Țicău – Sărărie'), 'ticau sararie');
});

test('modelul detectează UAT Iași, armonizează UNNAMED_7 → Copou și leagă localitățile de UAT', () => {
  assert.equal(geo.iasiUat.siruta, '95060');
  assert.equal(geo.zoneByCode['IAS-Z05'].polygons.length, 2);
  assert.equal(geo.localityBySiruta['95113'].uat_name, 'Bârnova');
  assert.equal(geo.localityBySiruta['95113'].name, 'Păun');
});

test('căutare tolerantă: ordinea repere → localități → zone; greșeli minore', () => {
  assert.equal(GeoCore.search(geo, 'Paun')[0].ref, '95113');
  assert.equal(GeoCore.search(geo, 'gara')[0].ref, 'POI-GARA');
  assert.equal(GeoCore.search(geo, 'tatarasi')[0].ref, 'IAS-Z17');
  assert.equal(GeoCore.search(geo, 'Vsan')[0].ref, '95121');
  assert.equal(GeoCore.search(geo, 'x').length, 0);
});

test('clasificare point-in-polygon', () => {
  assert.equal(GeoCore.classifyPoint(geo, 47.16, 27.59).unit_id, 'IAS-Z15');
  assert.equal(GeoCore.classifyPoint(geo, 47.21, 27.58).unit_id, 'IAS-Z05');
  const rest = GeoCore.classifyPoint(geo, 47.11, 27.51);
  assert.equal(rest.unit_type, 'UAT_REST');
  assert.ok(rest.flags.includes('IASI_NO_ZONE'));
  // clic liber într-o comună: UAT-ul, fără atribuire forțată la localitate (metodologia v0.4)
  const comuna = GeoCore.classifyPoint(geo, 47.071, 27.621);
  assert.equal(comuna.unit_id, 'UAT-90001');
  assert.equal(comuna.unit_type, 'UAT_REST');
  assert.equal(GeoCore.classifyPoint(geo, 44.43, 26.10).unit_type, 'OUT_ZMI');
});

test('fâșie la marginea Iașului (< 500 m de o zonă) → zona cea mai apropiată', () => {
  const c = GeoCore.classifyPoint(geo, 47.149, 27.59); // ~110 m sud de Centru
  assert.equal(c.unit_id, 'IAS-Z15');
  assert.ok(c.flags.includes('ZONE_NEAREST'));
});

test('localitatea aleasă din nomenclator își păstrează identitatea SIRUTA (marker provizoriu)', () => {
  const u = geo.uatBySiruta['90001'];
  const c = GeoCore.classifyEndpoint(geo, { source: 'locality', ref: '95113', lat: u.centroid[0], lng: u.centroid[1], approx: true });
  assert.equal(c.unit_id, 'LOC-95113');
  assert.equal(c.uat_siruta, '90001');
  assert.ok(c.flags.includes('LOCATION_APPROX'));
});

test('poligon cu gol (inel interior)', () => {
  const polys = GeoCore.toPolygons({ type: 'Polygon', coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]
  ] });
  assert.equal(GeoCore.inPolygons(polys, 1, 1), true);
  assert.equal(GeoCore.inPolygons(polys, 5, 5), false);
});

test('căutare pe categorii de repere: „spita” → toate spitalele, „univ” → toate universitățile', () => {
  const m = GeoCore.buildModel({
    poiCategories: Domain.POI_CATEGORIES,
    pois: [
      { id: 'a', name: 'Spitalul Clinic Județean de Urgență „Sf. Spiridon”', category: 'spital', aliases: ['Spiridon'], lat: 47.17, lng: 27.58 },
      { id: 'b', name: 'Institutul Regional de Oncologie', category: 'spital', aliases: ['IRO'], lat: 47.15, lng: 27.6 },
      { id: 'c', name: 'Universitatea „Alexandru Ioan Cuza”', category: 'universitate', lat: 47.17, lng: 27.57 },
      { id: 'd', name: 'Universitatea Tehnică „Gheorghe Asachi”', category: 'universitate', lat: 47.15, lng: 27.59 },
      { id: 'e', name: 'Spital fără coordonate', category: 'spital' }
    ]
  });
  assert.deepEqual(GeoCore.search(m, 'spita').map((e) => e.ref).sort(), ['a', 'b']);
  assert.deepEqual(GeoCore.search(m, 'univ').map((e) => e.ref).sort(), ['c', 'd']);
  assert.deepEqual(GeoCore.search(m, 'spital spiridon').map((e) => e.ref), ['a']);
  assert.deepEqual(GeoCore.search(m, 'iro').map((e) => e.ref), ['b']);
});
