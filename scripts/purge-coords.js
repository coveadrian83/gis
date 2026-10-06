'use strict';
/*
 * Politica de retenție pentru serverul propriu (SQLite). Pe Netlify se folosește butonul din dashboard.
 *   npm run purge-coords -- --older-than-days 90 [--apply]
 * Fără --apply rulează în mod „simulare”. Clasificarea deplasărilor se păstrează.
 */
const config = require('../server/config.js');
const { createSqliteStorage } = require('../server/storage-sqlite.js');
const { loadGeoFromDir } = require('../server/geo.js');
const { analyzeAll } = require('../server/analysis.js');
const { purgeCoords } = require('../server/maintenance.js');

(async () => {
  const args = process.argv.slice(2);
  const i = args.indexOf('--older-than-days');
  const days = i >= 0 ? parseInt(args[i + 1], 10) : NaN;
  if (!Number.isFinite(days) || days < 1) {
    console.error('Utilizare: npm run purge-coords -- --older-than-days <N> [--apply]');
    process.exit(2);
  }
  const apply = args.includes('--apply');
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const storage = createSqliteStorage(config.DB_PATH);
  const geo = await loadGeoFromDir(config.DATA_DIR);
  const { rows } = analyzeAll(await storage.listRaws(), await storage.getReviews(), geo, config);
  const n = await purgeCoords(storage, rows, cutoff, { dryRun: !apply });
  if (apply) await storage.appendAudit({ at: new Date().toISOString(), actor: 'cli', action: 'PURGE_COORDS', note: `${n} deplasări primite înainte de ${cutoff}` });
  console.log(`${apply ? 'Coordonate eliminate' : '[simulare] S-ar elimina coordonatele'} pentru ${n} deplasări primite înainte de ${cutoff}.`);
  if (!apply) console.log('Adăugați --apply pentru a executa.');
})();
