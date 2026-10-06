'use strict';
// Date geografice SINTETICE pentru teste (pătrate simple, coduri SIRUTA de test) – nu reprezintă limite reale.
const GeoCore = require('../public/shared/geo-core.js');

const sq = (x1, y1, x2, y2) => ({ type: 'Polygon', coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]] });
const f = (props, geometry) => ({ type: 'Feature', properties: props, geometry });

const raw = {
  uats: {
    type: 'FeatureCollection',
    features: [
      f({ natCode: '95060', name: 'MUNICIPIUL IAŞI' }, sq(27.50, 47.10, 27.70, 47.22)),
      f({ natCode: '90001', name: 'COMUNA BÂRNOVA' }, sq(27.55, 47.02, 27.70, 47.10))
    ]
  },
  zones: {
    type: 'FeatureCollection',
    features: [
      f({ name: 'CENTRU' }, sq(27.57, 47.15, 27.61, 47.18)),
      f({ name: 'COPOU' }, sq(27.55, 47.18, 27.60, 47.20)),
      f({ name: 'UNNAMED_7' }, sq(27.55, 47.20, 27.60, 47.215)),
      f({ name: 'TATARASI' }, sq(27.61, 47.15, 27.65, 47.18))
    ]
  },
  localities: [
    { siruta: '95113', denumire: 'PĂUN', sirsup: '90001' },
    { siruta: '95121', denumire: 'VIŞAN', sirsup: '90001', lat: 47.07, lng: 27.62 },
    { siruta: '90002', denumire: 'BÂRNOVA', sirsup: '90001', lat: 47.06, lng: 27.60 }
  ],
  pois: [
    { id: 'POI-GARA', name: 'Gara Iași', aliases: ['Gara'], lat: 47.1654, lng: 27.5703 },
    { id: 'POI-PALAS', name: 'Palas Iași', aliases: ['Palas'], lat: 47.1564, lng: 27.5871 }
  ]
};

module.exports = { raw, build: () => GeoCore.buildModel(raw) };
