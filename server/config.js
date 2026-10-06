'use strict';

const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..');

function env(name, def) {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function loadPeriods() {
  const file = env('PERIODS_FILE', path.join(ROOT, 'config', 'periods.json'));
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

const config = {
  ROOT,
  APP_VERSION: '0.5.0',
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
  SESSION_HOURS: parseInt(env('SESSION_HOURS', '12'), 10),
  // 'auto' = cookie Secure când cererea vine prin HTTPS (inclusiv X-Forwarded-Proto)
  COOKIE_SECURE: env('COOKIE_SECURE', 'auto'),
  TRUST_PROXY: env('TRUST_PROXY', '1') === '1',

  // Geocodare externă pentru străzi/repere necunoscute (fallback). Gol = dezactivat.
  GEOCODER_URL: env('GEOCODER_URL', 'https://nominatim.openstreetmap.org/search'),
  TILE_URL: env('TILE_URL', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  TILE_ATTRIBUTION: env('TILE_ATTRIBUTION', '&copy; contribuitorii <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'),

  // Precizia coordonatelor stocate (zecimale; 4 ≈ 11 m)
  COORD_DECIMALS: parseInt(env('COORD_DECIMALS', '4'), 10),

  PERIODS: loadPeriods()
};

module.exports = config;
