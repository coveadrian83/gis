'use strict';

const GeoCore = require('../public/shared/geo-core.js');

// Încărcarea datelor geografice dintr-o sursă oarecare: fișiere locale (server Node) sau URL (Netlify).

const FILES = {
  zones: 'iasi_17_zone_mva_mvi.geojson',
  uats: 'zmi_uat_web.geojson',
  localitiesJson: 'zmi_localitati_siruta_2025.json',
  localitiesCsv: 'zmi_localitati_siruta_2025.csv',
  pois: 'mvi_poi_aliases.json'
};

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

/** readText(fileName) → Promise<string|null> */
async function loadGeoWith(readText) {
  const errors = [];
  const json = async (name) => {
    try {
      const t = await readText(name);
      return t === null ? null : JSON.parse(t.replace(/^﻿/, ''));
    } catch (e) { errors.push(`${name}: ${e.message}`); return null; }
  };
  const [zones, uats, locJson, pois] = await Promise.all([json(FILES.zones), json(FILES.uats), json(FILES.localitiesJson), json(FILES.pois)]);
  let localities = locJson;
  if (!localities) {
    try {
      const t = await readText(FILES.localitiesCsv);
      localities = t === null ? null : parseCsv(t);
    } catch (e) { errors.push(`${FILES.localitiesCsv}: ${e.message}`); }
  }
  const model = GeoCore.buildModel({ zones, uats, localities, pois });
  model.warnings = errors.concat(model.warnings);
  model.files = { zones: !!zones, uats: !!uats, localities: !!localities, pois: !!pois };
  model.loaded_at = new Date().toISOString();
  return model;
}

/** Din director local. */
function loadGeoFromDir(dir) {
  const fs = require('node:fs');
  const path = require('node:path');
  return loadGeoWith(async (name) => {
    const f = path.join(dir, name);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  });
}

/** De la o adresă web (ex. https://site.netlify.app/data/). */
function loadGeoFromUrl(baseUrl) {
  return loadGeoWith(async (name) => {
    const r = await fetch(new URL(name, baseUrl), { headers: { 'cache-control': 'no-cache' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    // unele găzduiri întorc pagina HTML principală pentru fișiere inexistente
    if (ct.includes('text/html') || /^\s*</.test(text)) return null;
    return text;
  });
}

function geoStatus(model) {
  return {
    files: model.files,
    loaded_at: model.loaded_at,
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

module.exports = { FILES, parseCsv, loadGeoWith, loadGeoFromDir, loadGeoFromUrl, geoStatus };
