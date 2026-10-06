'use strict';

const fs = require('node:fs');
const path = require('node:path');
const GeoCore = require('../public/shared/geo-core.js');

const FILES = {
  zones: 'iasi_17_zone_mva_mvi.geojson',
  uats: 'zmi_uat_web.geojson',
  localitiesJson: 'zmi_localitati_siruta_2025.json',
  localitiesCsv: 'zmi_localitati_siruta_2025.csv',
  pois: 'mvi_poi_aliases.json'
};

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

/** Parser CSV minimal (separator , sau ;, ghilimele duble). */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

function loadGeo(dataDir) {
  const errors = [];
  const safe = (fn, label) => {
    try { return fn(); } catch (e) { errors.push(`${label}: ${e.message}`); return null; }
  };
  const zones = safe(() => readJson(path.join(dataDir, FILES.zones)), FILES.zones);
  const uats = safe(() => readJson(path.join(dataDir, FILES.uats)), FILES.uats);
  let localities = safe(() => readJson(path.join(dataDir, FILES.localitiesJson)), FILES.localitiesJson);
  if (!localities) {
    const csvPath = path.join(dataDir, FILES.localitiesCsv);
    localities = safe(() => (fs.existsSync(csvPath) ? parseCsv(fs.readFileSync(csvPath, 'utf8')) : null), FILES.localitiesCsv);
  }
  const pois = safe(() => readJson(path.join(dataDir, FILES.pois)), FILES.pois);

  const model = GeoCore.buildModel({ zones, uats, localities, pois });
  model.warnings = errors.concat(model.warnings);
  model.files = {
    zones: !!zones, uats: !!uats, localities: !!localities, pois: !!pois
  };
  return model;
}

function geoStatus(model) {
  return {
    files: model.files,
    counts: {
      zones_with_geometry: model.zones.filter((z) => z.polygons.length).length,
      uats: model.uats.length,
      localities: model.localities.length,
      localities_with_coords: model.localities.filter((l) => l.lat !== null && l.lng !== null).length,
      pois: model.pois.length
    },
    iasi_uat: model.iasiUat ? { siruta: model.iasiUat.siruta, name: model.iasiUat.name } : null,
    bbox: model.bbox,
    warnings: model.warnings.slice(0, 200)
  };
}

module.exports = { FILES, loadGeo, geoStatus, parseCsv };
