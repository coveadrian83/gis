'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const config = require('./config.js');
const { openDb, transaction } = require('./db.js');
const { loadGeo, geoStatus } = require('./geo.js');
const trips = require('./trips.js');
const stats = require('./stats.js');
const GeoCore = require('../public/shared/geo-core.js');
const Domain = require('../public/shared/domain.js');
const time = require('./time.js');

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
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8'
};

function originOf(url) {
  try { return new URL(url.replace(/\{[a-z]\}/g, 'a')).origin; } catch { return ''; }
}

function securityHeaders(cfg) {
  const tileOrigin = originOf(cfg.TILE_URL).replace('://a.', '://*.');
  const tileHosts = [tileOrigin, originOf(cfg.TILE_URL)].filter(Boolean).join(' ');
  const geocoder = cfg.GEOCODER_URL ? originOf(cfg.GEOCODER_URL) : '';
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data: ${tileHosts}`,
      `connect-src 'self' ${geocoder}`.trim(),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()'
  };
}

// ---------------------------------------------------------------------------
// Limitare de rată simplă, în memorie
// ---------------------------------------------------------------------------
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    return h.n <= limit;
  };
}

function createApp(cfg = config, deps = {}) {
  const db = deps.db || openDb(cfg.DB_PATH);
  let geo = deps.geo || loadGeo(cfg.DATA_DIR);
  const headers = securityHeaders(cfg);
  const sessions = new Map();
  const tripLimiter = rateLimiter(deps.tripLimit || 40, 10 * 60 * 1000);
  const loginLimiter = rateLimiter(10, 15 * 60 * 1000);
  const passwordHash = cfg.ADMIN_PASSWORD ? crypto.createHash('sha256').update(cfg.ADMIN_PASSWORD).digest() : null;

  function clientIp(req) {
    if (cfg.TRUST_PROXY && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
    return req.socket.remoteAddress || '';
  }

  function isHttps(req) {
    return req.socket.encrypted || (cfg.TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
  }

  function send(res, status, body, extra = {}) {
    const isBuf = Buffer.isBuffer(body);
    const payload = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      ...headers,
      'Content-Type': isBuf || typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra
    });
    res.end(payload);
  }

  function readBody(req, max = 16 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > max) { reject(Object.assign(new Error('Cerere prea mare.'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  async function readJson(req) {
    const t = await readBody(req);
    try { return JSON.parse(t || '{}'); } catch { throw Object.assign(new Error('JSON invalid.'), { status: 400 }); }
  }

  // --- sesiuni administrator --------------------------------------------------
  function parseCookies(req) {
    const out = {};
    String(req.headers.cookie || '').split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
  }

  function adminSession(req) {
    const token = parseCookies(req).mob_admin;
    if (!token) return null;
    const s = sessions.get(token);
    if (!s || s.expires < Date.now()) { sessions.delete(token); return null; }
    return s;
  }

  function requireAdmin(req, res) {
    if (!passwordHash) { send(res, 503, { error: 'Administrarea este dezactivată: setați ADMIN_PASSWORD.' }); return null; }
    const s = adminSession(req);
    if (!s) { send(res, 401, { error: 'Autentificare necesară.' }); return null; }
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'mobilitate-admin') {
      send(res, 403, { error: 'Cerere respinsă.' });
      return null;
    }
    return s;
  }

  // --- rute publice -----------------------------------------------------------
  function publicConfig() {
    const today = time.localDate();
    const minDate = [cfg.STUDY_START, time.addDays(today, -cfg.MAX_DAYS_BACK)].sort().pop();
    return {
      app_version: cfg.APP_VERSION,
      geometry_version: cfg.GEOMETRY_VERSION,
      study_start: cfg.STUDY_START,
      study_end: cfg.STUDY_END,
      max_days_back: cfg.MAX_DAYS_BACK,
      today,
      min_date: minDate,
      max_date: today < cfg.STUDY_END ? today : cfg.STUDY_END,
      collection_open: today >= cfg.STUDY_START && today <= cfg.STUDY_END,
      geocoder_url: cfg.GEOCODER_URL || null,
      tile_url: cfg.TILE_URL,
      tile_attribution: cfg.TILE_ATTRIBUTION,
      coord_decimals: cfg.COORD_DECIMALS
    };
  }

  function exportResponse(res, filename, contentType, body) {
    send(res, 200, body, {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`
    });
  }

  function stamp() {
    return time.localDate().replace(/-/g, '');
  }

  async function handleApi(req, res, url) {
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);

    if (p === '/api/health') return send(res, 200, { ok: true, version: cfg.APP_VERSION });
    if (p === '/api/config' && req.method === 'GET') return send(res, 200, publicConfig());

    if (p === '/api/trips' && req.method === 'POST') {
      if (!tripLimiter(clientIp(req))) return send(res, 429, { error: 'Prea multe trimiteri într-un interval scurt. Încearcă din nou peste câteva minute.' });
      const raw = await readBody(req);
      const r = trips.submitTrip(db, geo, cfg, raw);
      const row = r.row;
      return send(res, r.duplicate_submission ? 200 : 201, {
        trip_id: row.trip_id,
        already_received: r.duplicate_submission,
        origin: { unit_id: row.origin_unit_id, unit_name: row.origin_unit_name, unit_type: row.origin_unit_type, uat_name: row.origin_uat_name },
        destination: { unit_id: row.destination_unit_id, unit_name: row.destination_unit_name, unit_type: row.destination_unit_type, uat_name: row.destination_uat_name },
        duration_min: row.duration_min,
        distance_km: row.distance_km
      });
    }

    // Dreptul la ștergere: participantul își poate șterge toate deplasările de pe dispozitiv
    if (p === '/api/participant/erase' && req.method === 'POST') {
      if (!tripLimiter(clientIp(req))) return send(res, 429, { error: 'Prea multe cereri.' });
      const body = await readJson(req);
      const pid = String(body.participant_id || '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(pid)) return send(res, 400, { error: 'Identificator invalid.' });
      const n = transaction(db, () => {
        db.prepare('DELETE FROM trips_analysis WHERE participant_id = ?').run(pid);
        const r = db.prepare('DELETE FROM trips_raw WHERE participant_id = ?').run(pid);
        db.prepare('INSERT INTO audit_log (at, actor, action, note) VALUES (?,?,?,?)')
          .run(new Date().toISOString(), 'participant', 'PARTICIPANT_ERASURE', `${r.changes} deplasări șterse la cererea participantului`);
        return r.changes;
      });
      return send(res, 200, { deleted: n });
    }

    // --- administrare -------------------------------------------------------
    if (p === '/api/admin/session') {
      return send(res, 200, { enabled: !!passwordHash, authenticated: !!adminSession(req) });
    }
    if (p === '/api/admin/login' && req.method === 'POST') {
      if (!passwordHash) return send(res, 503, { error: 'Administrarea este dezactivată: setați ADMIN_PASSWORD.' });
      if (!loginLimiter(clientIp(req))) return send(res, 429, { error: 'Prea multe încercări. Reîncercați mai târziu.' });
      const body = await readJson(req);
      const given = crypto.createHash('sha256').update(String(body.password || '')).digest();
      if (!crypto.timingSafeEqual(given, passwordHash)) return send(res, 401, { error: 'Parolă incorectă.' });
      const token = crypto.randomBytes(32).toString('base64url');
      sessions.set(token, { created: Date.now(), expires: Date.now() + cfg.SESSION_HOURS * 3600 * 1000 });
      const secure = cfg.COOKIE_SECURE === '1' || (cfg.COOKIE_SECURE === 'auto' && isHttps(req));
      return send(res, 200, { ok: true }, {
        'Set-Cookie': `mob_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${cfg.SESSION_HOURS * 3600}${secure ? '; Secure' : ''}`
      });
    }
    if (p === '/api/admin/logout' && req.method === 'POST') {
      const token = parseCookies(req).mob_admin;
      if (token) sessions.delete(token);
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'mob_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' });
    }

    if (p.startsWith('/api/admin/')) {
      if (!requireAdmin(req, res)) return;
      const actor = 'coordonator';

      if (p === '/api/admin/meta') {
        return send(res, 200, {
          config: publicConfig(),
          domain: { modes: Domain.MODES, purposes: Domain.PURPOSES, repeat_types: Domain.REPEAT_TYPES, car_roles: Domain.CAR_ROLES },
          flags: Object.entries(trips.FLAG_LABELS).map(([code, label]) => ({ code, label, severity: trips.FLAG_SEVERITY[code] || 'INFO' })),
          periods: cfg.PERIODS,
          units: GeoCore.listUnits(geo).map((u) => ({ unit_id: u.unit_id, unit_name: u.unit_name, unit_type: u.unit_type, uat_siruta: u.uat_siruta, uat_name: u.uat_name })),
          uats: geo.uats.map((u) => ({ siruta: u.siruta, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, 'ro')),
          geo: geoStatus(geo)
        });
      }
      if (p === '/api/admin/summary') return send(res, 200, stats.summary(db, q));
      if (p === '/api/admin/trips' && req.method === 'GET') {
        const w = stats.buildWhere(q);
        const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 50));
        const offset = Math.max(0, parseInt(q.offset, 10) || 0);
        const total = db.prepare(`SELECT COUNT(*) AS n FROM trips_analysis ${w.sql}`).get(...w.params).n;
        const rows = db.prepare(`SELECT * FROM trips_analysis ${w.sql} ORDER BY submitted_at DESC, trip_id LIMIT ? OFFSET ?`).all(...w.params, limit, offset);
        return send(res, 200, { total, limit, offset, rows });
      }
      let m = p.match(/^\/api\/admin\/trips\/([0-9a-f-]{36})$/);
      if (m && req.method === 'GET') {
        const row = trips.getTrip(db, m[1]);
        if (!row) return send(res, 404, { error: 'Deplasare inexistentă.' });
        const raw = db.prepare('SELECT * FROM trips_raw WHERE trip_id = ?').get(m[1]);
        const audit = db.prepare('SELECT * FROM audit_log WHERE trip_id = ? ORDER BY id DESC').all(m[1]);
        const participantTrips = db.prepare('SELECT COUNT(*) AS n FROM trips_analysis WHERE participant_id = ?').get(row.participant_id).n;
        return send(res, 200, { row, raw: { ...raw, payload: JSON.parse(raw.payload_json) }, audit, participant_trips: participantTrips });
      }
      m = p.match(/^\/api\/admin\/trips\/([0-9a-f-]{36})\/status$/);
      if (m && req.method === 'POST') {
        const body = await readJson(req);
        const status = body.status === 'AUTO' ? null : body.status;
        return send(res, 200, trips.setStatus(db, m[1], status, body.note, actor));
      }
      if (p === '/api/admin/od') return send(res, 200, stats.odAggregate(db, q));
      if (p === '/api/admin/coverage') return send(res, 200, stats.coverage(db, geo, q));
      if (p === '/api/admin/audit') {
        const limit = Math.min(1000, Math.max(1, parseInt(q.limit, 10) || 200));
        return send(res, 200, { rows: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) });
      }
      if (p === '/api/admin/reload-geo' && req.method === 'POST') {
        geo = loadGeo(cfg.DATA_DIR);
        db.prepare('INSERT INTO audit_log (at, actor, action, note) VALUES (?,?,?,?)')
          .run(new Date().toISOString(), actor, 'RELOAD_GEO', `geometrie ${cfg.GEOMETRY_VERSION}`);
        return send(res, 200, geoStatus(geo));
      }
      if (p === '/api/admin/reprocess' && req.method === 'POST') {
        return send(res, 200, trips.reprocessAll(db, geo, cfg, actor));
      }

      // --- exporturi ---
      m = p.match(/^\/api\/admin\/export\/([a-z_]+)\.(csv|geojson|jsonl)$/);
      if (m) {
        const excelRo = q.format === 'excel_ro';
        const csvType = 'text/csv; charset=utf-8';
        const suffix = excelRo ? '_excel' : '';
        const [, name, ext] = m;
        if (name === 'trips' && ext === 'csv') {
          const w = stats.buildWhere(q);
          const rows = db.prepare(`SELECT * FROM trips_analysis ${w.sql} ORDER BY trip_date, departure_time`).all(...w.params);
          return exportResponse(res, `trips_analysis_${stamp()}${suffix}.csv`, csvType, stats.toCsv(rows, trips.ANALYSIS_COLUMNS, { excelRo }));
        }
        if (name === 'od' && ext === 'csv') {
          const od = stats.odAggregate(db, q);
          const cols = od.rows.length ? Object.keys(od.rows[0]) : ['origin_id', 'destination_id', 'n_trips'];
          return exportResponse(res, `od_aggregated_${od.level}_${stamp()}${suffix}.csv`, csvType, stats.toCsv(od.rows, cols, { excelRo }));
        }
        if (name === 'od' && ext === 'geojson') {
          return exportResponse(res, `od_flows_${stamp()}.geojson`, 'application/geo+json; charset=utf-8', JSON.stringify(stats.odGeoJson(db, geo, q)));
        }
        if (name === 'coverage' && ext === 'csv') {
          const c = stats.coverage(db, geo, q);
          return exportResponse(res, `coverage_${stamp()}${suffix}.csv`, csvType,
            stats.toCsv(c.rows, ['unit_id', 'unit_name', 'unit_type', 'uat_name', 'as_origin', 'as_destination', 'total', 'undercovered'], { excelRo }));
        }
        if (name === 'audit' && ext === 'csv') {
          const rows = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
          return exportResponse(res, `audit_log_${stamp()}${suffix}.csv`, csvType,
            stats.toCsv(rows, ['id', 'at', 'actor', 'action', 'trip_id', 'old_status', 'new_status', 'note'], { excelRo }));
        }
        if (name === 'raw' && ext === 'jsonl') {
          const rows = db.prepare('SELECT trip_id, participant_id, received_at, app_version, payload_json FROM trips_raw ORDER BY received_at').all();
          const body = rows.map((r) => JSON.stringify({ trip_id: r.trip_id, participant_id: r.participant_id, received_at: r.received_at, app_version: r.app_version, payload: JSON.parse(r.payload_json) })).join('\n') + '\n';
          return exportResponse(res, `trips_raw_${stamp()}.jsonl`, 'application/x-ndjson; charset=utf-8', body);
        }
      }
      return send(res, 404, { error: 'Resursă inexistentă.' });
    }
    return send(res, 404, { error: 'Resursă inexistentă.' });
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
          if (fs.existsSync(file + '.html')) {
            res.writeHead(301, { Location: url.pathname + '.html' });
            return res.end();
          }
          if (fs.existsSync(path.join(file, 'index.html'))) {
            res.writeHead(301, { Location: url.pathname + '/' });
            return res.end();
          }
        }
        return send(res, 404, 'Pagina nu există.');
      }
      const ext = path.extname(file).toLowerCase();
      const isHtml = ext === '.html';
      const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
      res.writeHead(200, {
        ...headers,
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        ETag: etag,
        'Cache-Control': isHtml || rel.startsWith('/data/') ? 'no-cache' : 'public, max-age=3600'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return send(res, 400, 'Cerere invalidă'); }
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Metodă nepermisă');
      return serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'Eroare internă.' : e.message, field: e.field });
    }
  });

  return { server, db, getGeo: () => geo };
}

if (require.main === module) {
  const { server, getGeo } = createApp();
  const g = geoStatus(getGeo());
  server.listen(config.PORT, config.HOST, () => {
    console.log(`Mobilitate Iași v${config.APP_VERSION} – http://${config.HOST}:${config.PORT}`);
    console.log(`Date geografice: ${g.counts.zones_with_geometry}/17 zone, ${g.counts.uats} UAT, ${g.counts.localities} localități, ${g.counts.pois} repere`);
    if (g.warnings.length) console.log(`Avertismente geo (${g.warnings.length}):\n - ` + g.warnings.slice(0, 10).join('\n - '));
    if (!config.ADMIN_PASSWORD) console.log('ADMIN_PASSWORD nu este setat – dashboardul /admin/ este dezactivat.');
  });
}

module.exports = { createApp };
