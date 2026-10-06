'use strict';

// Server Node propriu (VPS, calculator local): fișiere statice + API, cu stocare SQLite.
// Pe Netlify nu se folosește acest fișier (vezi netlify/functions/api.mjs).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const config = require('./config.js');
const { createApi, securityHeaders } = require('./api.js');
const { loadGeoFromDir, geoStatus } = require('./geo.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function createApp(cfg = config, deps = {}) {
  let storage = deps.storage;
  if (!storage) {
    const { createSqliteStorage } = require('./storage-sqlite.js');
    storage = createSqliteStorage(cfg.DB_PATH);
  }
  let geoPromise = deps.geo ? Promise.resolve(deps.geo) : loadGeoFromDir(cfg.DATA_DIR);
  const api = createApi(cfg, {
    storage,
    getGeo: () => geoPromise,
    reloadGeo: () => (geoPromise = deps.geo ? Promise.resolve(deps.geo) : loadGeoFromDir(cfg.DATA_DIR))
  });
  const headers = securityHeaders(cfg);

  function clientIp(req) {
    if (cfg.TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || '';
  }

  async function handleApi(req, res) {
    const proto = req.socket.encrypted ? 'https' : 'http';
    const url = `${proto}://${req.headers.host || 'localhost'}${req.url}`;
    const init = { method: req.method, headers: req.headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') { init.body = Readable.toWeb(req); init.duplex = 'half'; }
    const response = await api.handle(new Request(url, init), { ip: clientIp(req) });
    const out = {};
    response.headers.forEach((v, k) => { out[k] = v; });
    res.writeHead(response.status, out);
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  function send(res, status, text) {
    res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(text);
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    // /data/* se servește din GEO_DATA_DIR, ca browserul și serverul să folosească aceleași fișiere
    const isData = rel.startsWith('/data/');
    const root = isData ? path.resolve(cfg.DATA_DIR) : cfg.PUBLIC_DIR;
    const file = path.normalize(path.join(root, isData ? rel.slice(5) : rel));
    if (!file.startsWith(root + path.sep)) return send(res, 403, 'Interzis');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        if (!path.extname(rel)) {
          if (fs.existsSync(file + '.html')) { res.writeHead(301, { Location: url.pathname + '.html' }); return res.end(); }
          if (fs.existsSync(path.join(file, 'index.html'))) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
        }
        return send(res, 404, 'Pagina nu există.');
      }
      const ext = path.extname(file).toLowerCase();
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      res.writeHead(200, {
        ...headers,
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        ETag: etag,
        'Cache-Control': ext === '.html' || isData ? 'no-cache' : 'public, max-age=3600'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Cerere invalidă'); }
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metodă nepermisă');
      return serveStatic(req, res, url);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, 'Eroare internă.');
    }
  });

  return { server, storage, getGeo: () => geoPromise };
}

if (require.main === module) {
  const { server, getGeo } = createApp();
  server.listen(config.PORT, config.HOST, async () => {
    const g = geoStatus(await getGeo());
    console.log(`Mobilitate Iași v${config.APP_VERSION} – http://${config.HOST}:${config.PORT}`);
    console.log(`Date geografice: ${g.counts.zones_with_geometry}/17 zone, ${g.counts.uats} UAT, ${g.counts.localities} localități, ${g.counts.pois} repere`);
    if (g.warnings.length) console.log(`Avertismente geo (${g.warnings.length}):\n - ` + g.warnings.slice(0, 10).join('\n - '));
    if (!config.ADMIN_PASSWORD) console.log('ADMIN_PASSWORD nu este setat – dashboardul /admin/ este dezactivat.');
  });
}

module.exports = { createApp };
