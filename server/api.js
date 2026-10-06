'use strict';

/*
 * API-ul aplicației, scris pe standardul Web (Request → Response), astfel încât același cod rulează:
 *  - ca funcție Netlify (netlify/functions/api.mjs), cu stocare Netlify Blobs;
 *  - în serverul Node propriu (server/server.js), cu stocare SQLite.
 */

const crypto = require('node:crypto');
const GeoCore = require('../public/shared/geo-core.js');
const Domain = require('../public/shared/domain.js');
const analysis = require('./analysis.js');
const stats = require('./stats.js');
const time = require('./time.js');
const { geoStatus } = require('./geo.js');
const { purgeCoords } = require('./maintenance.js');

const MAX_BODY = 16 * 1024;

function originOf(url) {
  try { return new URL(url.replace(/\{[a-z]\}/g, 'a')).origin; } catch { return ''; }
}

/** Antetele de securitate (folosite și de serverul Node pentru fișierele statice). */
function securityHeaders(cfg) {
  const tileHosts = [originOf(cfg.TILE_URL)].filter(Boolean).join(' ');
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

/** Limitare de rată simplă, în memoria instanței. */
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(key, h); }
    h.n++;
    return h.n <= limit;
  };
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * deps: { storage, getGeo(request) → Promise<model>, reloadGeo?(request) → Promise<model> }
 */
function createApi(cfg, deps) {
  const { storage } = deps;
  const headers = securityHeaders(cfg);
  const tripLimiter = rateLimiter(cfg.RATE_LIMIT_TRIPS || 40, 10 * 60 * 1000);
  const loginLimiter = rateLimiter(10, 15 * 60 * 1000);
  const sessionKey = cfg.ADMIN_PASSWORD
    ? crypto.createHash('sha256').update('mobilitate-admin:' + cfg.ADMIN_PASSWORD + ':' + (cfg.SESSION_SECRET || '')).digest()
    : null;
  const passwordHash = cfg.ADMIN_PASSWORD ? crypto.createHash('sha256').update(cfg.ADMIN_PASSWORD).digest() : null;

  // --- utilitare răspuns -------------------------------------------------------
  function json(status, body, extra = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
    });
  }

  function download(filename, contentType, body) {
    return new Response(body, {
      status: 200,
      headers: { ...headers, 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${filename}"` }
    });
  }

  async function readText(req) {
    const len = parseInt(req.headers.get('content-length') || '0', 10);
    if (len > MAX_BODY) throw new HttpError(413, 'Cerere prea mare.');
    const t = await req.text();
    if (t.length > MAX_BODY) throw new HttpError(413, 'Cerere prea mare.');
    return t;
  }

  async function readJson(req) {
    const t = await readText(req);
    try { return JSON.parse(t || '{}'); } catch { throw new HttpError(400, 'JSON invalid.'); }
  }

  // --- sesiuni administrator (fără stare pe server: token semnat HMAC) ------------
  function sign(payload) {
    return crypto.createHmac('sha256', sessionKey).update(payload).digest('base64url');
  }

  function newToken() {
    const exp = String(Date.now() + cfg.SESSION_HOURS * 3600 * 1000);
    return exp + '.' + sign(exp);
  }

  function cookies(req) {
    const out = {};
    String(req.headers.get('cookie') || '').split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
    });
    return out;
  }

  function isAdmin(req) {
    if (!sessionKey) return false;
    const t = cookies(req).mob_admin;
    if (!t || !t.includes('.')) return false;
    const [exp, sig] = t.split('.');
    if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
    const expected = Buffer.from(sign(exp));
    const given = Buffer.from(sig || '');
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  }

  function isHttps(req) {
    if (new URL(req.url).protocol === 'https:') return true;
    return cfg.TRUST_PROXY && String(req.headers.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';
  }

  function cookie(req, value, maxAge) {
    const secure = cfg.COOKIE_SECURE === '1' || (cfg.COOKIE_SECURE === 'auto' && isHttps(req));
    return `mob_admin=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  // --- date ----------------------------------------------------------------------
  async function loadAnalysis(req) {
    const [geo, raws, reviews] = await Promise.all([deps.getGeo(req), storage.listRaws(), storage.getReviews()]);
    const res = analysis.analyzeAll(raws, reviews, geo, cfg);
    return { geo, rows: res.rows, errors: res.errors, rawCount: raws.length };
  }

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

  const stamp = () => time.localDate().replace(/-/g, '');

  async function audit(e) {
    await storage.appendAudit({ at: new Date().toISOString(), actor: 'coordonator', ...e });
  }

  // --- rute ----------------------------------------------------------------------
  async function route(req, ip) {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '');
    const q = Object.fromEntries(url.searchParams);
    const method = req.method;

    if (p === '/api/health') return json(200, { ok: true, version: cfg.APP_VERSION, storage: storage.kind });
    if (p === '/api/config' && method === 'GET') return json(200, publicConfig());

    if (p === '/api/trips' && method === 'POST') {
      if (!tripLimiter(ip)) return json(429, { error: 'Prea multe trimiteri într-un interval scurt. Încearcă din nou peste câteva minute.' });
      const raw = await readText(req);
      const geo = await deps.getGeo(req);
      const { record, row } = analysis.prepareSubmission(raw, geo, cfg, Date.now());
      const existing = await storage.getRaw(record.trip_id);
      if (existing && existing.participant_id !== record.participant_id) return json(409, { error: 'Identificator de deplasare deja folosit.' });
      const r = existing ? { created: false } : await storage.putRaw(record);
      return json(r.created ? 201 : 200, {
        trip_id: row.trip_id,
        already_received: !r.created,
        origin: { unit_id: row.origin_unit_id, unit_name: row.origin_unit_name, unit_type: row.origin_unit_type, uat_name: row.origin_uat_name },
        destination: { unit_id: row.destination_unit_id, unit_name: row.destination_unit_name, unit_type: row.destination_unit_type, uat_name: row.destination_uat_name },
        duration_min: row.duration_min,
        distance_km: row.distance_km
      });
    }

    // Dreptul la ștergere: participantul își șterge toate deplasările trimise de pe dispozitiv
    if (p === '/api/participant/erase' && method === 'POST') {
      if (!tripLimiter(ip)) return json(429, { error: 'Prea multe cereri.' });
      const body = await readJson(req);
      const pid = String(body.participant_id || '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(pid)) return json(400, { error: 'Identificator invalid.' });
      const n = await storage.deleteByParticipant(pid);
      await storage.appendAudit({ at: new Date().toISOString(), actor: 'participant', action: 'PARTICIPANT_ERASURE', note: `${n} deplasări șterse la cererea participantului` });
      return json(200, { deleted: n });
    }

    // --- administrare -------------------------------------------------------------
    if (p === '/api/admin/session') return json(200, { enabled: !!sessionKey, authenticated: isAdmin(req) });
    if (p === '/api/admin/login' && method === 'POST') {
      if (!sessionKey) return json(503, { error: 'Administrarea este dezactivată: setați ADMIN_PASSWORD.' });
      if (!loginLimiter(ip)) return json(429, { error: 'Prea multe încercări. Reîncercați mai târziu.' });
      const body = await readJson(req);
      const given = crypto.createHash('sha256').update(String(body.password || '')).digest();
      if (!crypto.timingSafeEqual(given, passwordHash)) return json(401, { error: 'Parolă incorectă.' });
      return json(200, { ok: true }, { 'Set-Cookie': cookie(req, newToken(), cfg.SESSION_HOURS * 3600) });
    }
    if (p === '/api/admin/logout' && method === 'POST') {
      return json(200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    }

    if (!p.startsWith('/api/admin/')) return json(404, { error: 'Resursă inexistentă.' });
    if (!sessionKey) return json(503, { error: 'Administrarea este dezactivată: setați ADMIN_PASSWORD.' });
    if (!isAdmin(req)) return json(401, { error: 'Autentificare necesară.' });
    if (method !== 'GET' && req.headers.get('x-requested-with') !== 'mobilitate-admin') return json(403, { error: 'Cerere respinsă.' });

    if (p === '/api/admin/meta') {
      const geo = await deps.getGeo(req);
      return json(200, {
        config: publicConfig(),
        storage: storage.kind,
        domain: { modes: Domain.MODES, purposes: Domain.PURPOSES, repeat_types: Domain.REPEAT_TYPES, car_roles: Domain.CAR_ROLES },
        flags: Object.entries(analysis.FLAG_LABELS).map(([code, label]) => ({ code, label, severity: analysis.FLAG_SEVERITY[code] || 'INFO' })),
        periods: cfg.PERIODS,
        units: GeoCore.listUnits(geo).map((u) => ({ unit_id: u.unit_id, unit_name: u.unit_name, unit_type: u.unit_type, uat_siruta: u.uat_siruta, uat_name: u.uat_name })),
        uats: geo.uats.map((u) => ({ siruta: u.siruta, name: u.name })).sort((a, b) => a.name.localeCompare(b.name, 'ro')),
        geo: geoStatus(geo)
      });
    }

    if (p === '/api/admin/summary') {
      const a = await loadAnalysis(req);
      return json(200, { ...stats.summary(a.rows, q), n_raw_total: a.rawCount, n_unprocessable: a.errors.length });
    }

    if (p === '/api/admin/trips' && method === 'GET') {
      const a = await loadAnalysis(req);
      const rows = stats.filterRows(a.rows, q).sort((x, y) => (x.submitted_at < y.submitted_at ? 1 : x.submitted_at > y.submitted_at ? -1 : 0));
      const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 50));
      const offset = Math.max(0, parseInt(q.offset, 10) || 0);
      return json(200, { total: rows.length, limit, offset, rows: rows.slice(offset, offset + limit) });
    }

    let m = p.match(/^\/api\/admin\/trips\/([0-9a-f-]{36})$/);
    if (m && method === 'GET') {
      const a = await loadAnalysis(req);
      const row = a.rows.find((r) => r.trip_id === m[1]);
      if (!row) return json(404, { error: 'Deplasare inexistentă.' });
      const raw = await storage.getRaw(m[1]);
      const history = (await storage.listAudit(5000)).filter((e) => e.trip_id === m[1]);
      return json(200, {
        row,
        raw: { ...raw, payload: JSON.parse(raw.payload_json) },
        audit: history,
        participant_trips: a.rows.filter((r) => r.participant_id === row.participant_id).length
      });
    }

    m = p.match(/^\/api\/admin\/trips\/([0-9a-f-]{36})\/status$/);
    if (m && method === 'POST') {
      const body = await readJson(req);
      const status = body.status === 'AUTO' ? null : body.status;
      if (status !== null && !Domain.STATUSES.includes(status)) return json(400, { error: 'Status invalid.' });
      const a = await loadAnalysis(req);
      const row = a.rows.find((r) => r.trip_id === m[1]);
      if (!row) return json(404, { error: 'Deplasare inexistentă.' });
      const note = body.note ? String(body.note).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500) || null : null;
      const at = new Date().toISOString();
      await storage.setReview(m[1], status || note ? { manual_status: status, reviewed_at: at, review_note: note } : null);
      const newStatus = status || row.auto_status;
      await audit({ action: status ? 'SET_STATUS' : 'RESET_TO_AUTO', trip_id: m[1], old_status: row.validation_status, new_status: newStatus, note });
      return json(200, { ...row, manual_status: status, validation_status: newStatus, reviewed_at: at, review_note: note });
    }

    if (p === '/api/admin/od') return json(200, stats.odAggregate((await loadAnalysis(req)).rows, q));
    if (p === '/api/admin/coverage') {
      const a = await loadAnalysis(req);
      return json(200, stats.coverage(a.rows, a.geo, q));
    }
    if (p === '/api/admin/audit') {
      const limit = Math.min(1000, Math.max(1, parseInt(q.limit, 10) || 200));
      return json(200, { rows: await storage.listAudit(limit) });
    }

    if (p === '/api/admin/reload-geo' && method === 'POST') {
      const geo = deps.reloadGeo ? await deps.reloadGeo(req) : await deps.getGeo(req);
      const rep = await storage.repair();
      await audit({ action: 'RELOAD_GEO', note: `geometrie ${cfg.GEOMETRY_VERSION}; index verificat: ${rep.checked}, reparate: ${rep.repaired}` });
      return json(200, { ...geoStatus(geo), repair: rep });
    }

    // Politica de retenție: elimină coordonatele precise, păstrând clasificarea (instantaneu)
    if (p === '/api/admin/purge-coords' && method === 'POST') {
      const body = await readJson(req);
      const days = parseInt(body.older_than_days, 10);
      if (!Number.isFinite(days) || days < 1) return json(400, { error: 'Numărul de zile este invalid.' });
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      const a = await loadAnalysis(req);
      const n = await purgeCoords(storage, a.rows, cutoff);
      await audit({ action: 'PURGE_COORDS', note: `${n} deplasări primite înainte de ${cutoff}` });
      return json(200, { purged: n, cutoff });
    }

    // --- exporturi ---
    m = p.match(/^\/api\/admin\/export\/([a-z_]+)\.(csv|geojson|jsonl)$/);
    if (m) {
      const excelRo = q.format === 'excel_ro';
      const csvType = 'text/csv; charset=utf-8';
      const suffix = excelRo ? '_excel' : '';
      const [, name, ext] = m;
      if (name === 'trips' && ext === 'csv') {
        const rows = stats.filterRows((await loadAnalysis(req)).rows, q)
          .sort((x, y) => (x.trip_date + x.departure_time).localeCompare(y.trip_date + y.departure_time));
        return download(`trips_analysis_${stamp()}${suffix}.csv`, csvType, stats.toCsv(rows, analysis.ANALYSIS_COLUMNS, { excelRo }));
      }
      if (name === 'od' && ext === 'csv') {
        const od = stats.odAggregate((await loadAnalysis(req)).rows, q);
        const cols = od.rows.length ? Object.keys(od.rows[0]) : ['origin_id', 'destination_id', 'n_trips'];
        return download(`od_aggregated_${od.level}_${stamp()}${suffix}.csv`, csvType, stats.toCsv(od.rows, cols, { excelRo }));
      }
      if (name === 'od' && ext === 'geojson') {
        const a = await loadAnalysis(req);
        return download(`od_flows_${stamp()}.geojson`, 'application/geo+json; charset=utf-8', JSON.stringify(stats.odGeoJson(a.rows, a.geo, q)));
      }
      if (name === 'coverage' && ext === 'csv') {
        const a = await loadAnalysis(req);
        const c = stats.coverage(a.rows, a.geo, q);
        return download(`coverage_${stamp()}${suffix}.csv`, csvType,
          stats.toCsv(c.rows, ['unit_id', 'unit_name', 'unit_type', 'uat_name', 'as_origin', 'as_destination', 'total', 'undercovered'], { excelRo }));
      }
      if (name === 'audit' && ext === 'csv') {
        const rows = (await storage.listAudit(100000)).reverse();
        return download(`audit_log_${stamp()}${suffix}.csv`, csvType,
          stats.toCsv(rows, ['id', 'at', 'actor', 'action', 'trip_id', 'old_status', 'new_status', 'note'], { excelRo }));
      }
      if (name === 'raw' && ext === 'jsonl') {
        const rows = (await storage.listRaws()).sort((x, y) => x.received_at.localeCompare(y.received_at));
        const body = rows.map((r) => JSON.stringify({
          trip_id: r.trip_id, participant_id: r.participant_id, received_at: r.received_at, app_version: r.app_version,
          payload: JSON.parse(r.payload_json), ...(r.snapshot ? { snapshot: r.snapshot } : {})
        })).join('\n') + '\n';
        return download(`trips_raw_${stamp()}.jsonl`, 'application/x-ndjson; charset=utf-8', body);
      }
    }
    return json(404, { error: 'Resursă inexistentă.' });
  }

  /** Punctul de intrare: handle(request, { ip }) → Response */
  async function handle(req, ctx = {}) {
    try {
      return await route(req, ctx.ip || 'necunoscut');
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      return json(status, { error: status >= 500 ? 'Eroare internă.' : e.message, field: e.field });
    }
  }

  return { handle, headers };
}

module.exports = { createApi, securityHeaders };
