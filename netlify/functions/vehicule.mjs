// Pozițiile vehiculelor CTP Iași în timp real, pentru harta /transport/ (stratul „Vehicule în timp real”).
// Sursa: API-ul de date deschise Tranzy (https://tranzy.ai/opendata/), agenția 1 = CTP Iași – aceeași sursă ca orarul
// GTFS din data/transport/gtfs/. Cheia API stă în variabila de mediu TRANZY_API_KEY (Netlify → Site configuration →
// Environment variables) și nu ajunge în pagină. Răspunsul se păstrează ~15 s (în funcție și în CDN-ul Netlify),
// ca vizitatorii să nu consume limita de cereri a cheii.
const SOURCE = 'https://api.tranzy.ai/v1/opendata/vehicles';
const AGENCY = '1';
const TTL_MS = 15 * 1000;
const MAX_AGE_MS = 10 * 60 * 1000; // vehiculele fără semnal de peste 10 minute (garate, GPS oprit) nu se afișează

let cache = null; // { at, body }

// Câmpurile necesare hărții, într-o formă compactă; sensul vine din trip_id („ruta_sens”, ex. „8_1”).
export function simplify(list, now = Date.now()) {
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const ts = Date.parse(v.timestamp);
    if (!Number.isFinite(v.latitude) || !Number.isFinite(v.longitude) || !Number.isFinite(ts)) continue;
    if (now - ts > MAX_AGE_MS) continue;
    const m = /_(\d+)$/.exec(v.trip_id || '');
    out.push({
      id: v.id, nr: v.label || null, lat: +v.latitude.toFixed(6), lng: +v.longitude.toFixed(6), ts: Math.round(ts / 1000),
      v: Number.isFinite(v.speed) ? v.speed : null, ruta: v.route_id == null ? null : String(v.route_id),
      sens: m ? m[1] : null, tip: v.vehicle_type === 0 ? 'tramvai' : 'autobuz',
    });
  }
  return out;
}

function json(status, data, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      ...(maxAge ? { 'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${maxAge}, stale-while-revalidate=30` } : {}),
    },
  });
}

export default async function handler(_req, _ctx, fetchImpl = fetch) {
  const key = process.env.TRANZY_API_KEY;
  if (!key) return json(503, { eroare: 'Pozițiile în timp real nu sunt configurate (lipsește TRANZY_API_KEY).' });
  if (cache && Date.now() - cache.at < TTL_MS) return json(200, cache.body, 15);
  try {
    const r = await fetchImpl(SOURCE, { headers: { 'X-API-KEY': key, 'X-Agency-Id': AGENCY, Accept: 'application/json' } });
    if (!r.ok) return json(502, { eroare: `Sursa Tranzy a răspuns ${r.status}.` });
    const body = { sursa: 'Tranzy – CTP Iași', actualizat: Math.round(Date.now() / 1000), vehicule: simplify(await r.json()) };
    cache = { at: Date.now(), body };
    return json(200, body, 15);
  } catch (e) {
    return json(502, { eroare: 'Sursa Tranzy nu răspunde.' });
  }
}

export const config = { path: '/live/vehicule' };
