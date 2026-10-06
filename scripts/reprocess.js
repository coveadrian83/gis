'use strict';
// Reconstruiește TRIPS_ANALYSIS din TRIPS_RAW cu geometriile și regulile curente.
const config = require('../server/config.js');
const { openDb } = require('../server/db.js');
const { loadGeo } = require('../server/geo.js');
const { reprocessAll } = require('../server/trips.js');

const db = openDb(config.DB_PATH);
const r = reprocessAll(db, loadGeo(config.DATA_DIR), config, 'cli');
console.log(`${r.processed} deplasări reprocesate (zonare ${config.GEOMETRY_VERSION}); ${r.errors.length} erori.`);
r.errors.slice(0, 20).forEach((e) => console.log(`  ${e.trip_id}: ${e.error}`));
