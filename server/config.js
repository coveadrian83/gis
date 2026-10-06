'use strict';

const path = require('node:path');
const fs = require('node:fs');

// în pachetul ESM al funcției Netlify __dirname nu există (și nici nu e nevoie de căi locale)
const ROOT = typeof __dirname !== 'undefined' ? path.resolve(__dirname, '..') : process.cwd();

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function loadPeriods() {
  const file = env('PERIODS_FILE', '');
  if (file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  }
  // require static: fișierul este inclus și în pachetul funcției Netlify
  return require('../config/periods.json');
}

const config = {
  ROOT,
  APP_VERSION: '0.7.0',
  PORT: parseInt(env('PORT', '8080'), 10),
  HOST: env('HOST', '0.0.0.0'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DATA_DIR: env('GEO_DATA_DIR', path.join(ROOT, 'public', 'data')),
  DB_PATH: env('DB_PATH', path.join(ROOT, 'var', 'mobilitate.sqlite')),
  TIMEZONE: 'Europe/Bucharest',

  // Versiunea zonării; se schimbă la orice modificare a geometriilor/nomenclatoarelor
  GEOMETRY_VERSION: env('GEOMETRY_VERSION', 'ZMI-2025.1'),

  STUDY_START: env('STUDY_START', '2026-10-01'),
  STUDY_END: env('STUDY_END', '2027-04-30'),
  MAX_DAYS_BACK: parseInt(env('MAX_DAYS_BACK', '7'), 10),

  // Administrare: fără ADMIN_PASSWORD, dashboardul este dezactivat
  ADMIN_PASSWORD: env('ADMIN_PASSWORD', ''),
  // cheie suplimentară opțională pentru semnarea sesiunilor (schimbarea ei deconectează toți administratorii)
  SESSION_SECRET: env('SESSION_SECRET', ''),
  SESSION_HOURS: parseInt(env('SESSION_HOURS', '12'), 10),
  // 'auto' = cookie Secure când cererea vine prin HTTPS (inclusiv X-Forwarded-Proto)
  COOKIE_SECURE: env('COOKIE_SECURE', 'auto'),
  TRUST_PROXY: env('TRUST_PROXY', '1') === '1',
  // trimiteri de deplasări permise pe IP în 10 minute
  RATE_LIMIT_TRIPS: parseInt(env('RATE_LIMIT_TRIPS', '40'), 10),

  // Geocodare externă pentru străzi/repere necunoscute (fallback). Gol = dezactivat.
  GEOCODER_URL: env('GEOCODER_URL', 'https://nominatim.openstreetmap.org/search'),
  TILE_URL: env('TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  TILE_ATTRIBUTION: env('TILE_ATTRIBUTION', '&copy; contribuitorii <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'),

  // Precizia coordonatelor stocate (zecimale; 4 ≈ 11 m)
  COORD_DECIMALS: parseInt(env('COORD_DECIMALS', '4'), 10),

  PERIODS: loadPeriods()
};

module.exports = config;
