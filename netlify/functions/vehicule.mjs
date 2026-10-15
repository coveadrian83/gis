// Pozițiile vehiculelor CTP Iași în timp real, pentru harta /transport/ (stratul „Vehicule în timp real”) și harta
// „Sănătatea transportului public” (/transport/sanatate/). Sursa și cheia: netlify/lib/tranzy.mjs. Răspunsul se
// păstrează 30 s (în funcție și în CDN-ul Netlify), ca vizitatorii să nu consume cota cheii: 5.000 de cereri pe zi.
// Bugetul zilnic: cel mult 2.880 de cereri de aici (una la 30 s) + 1.440 ale colectării GPS (una pe minut) = 4.320.
import { apiKey, fetchVehicles } from '../lib/tranzy.mjs';

export { simplify } from '../lib/tranzy.mjs';

const TTL_MS = 30 * 1000;
let cache = null; // { at, body }

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
  const key = apiKey();
  if (!key) return json(503, { eroare: 'Pozițiile în timp real nu sunt configurate (lipsește TRANZY_API_KEY).' });
  if (cache && Date.now() - cache.at < TTL_MS) return json(200, cache.body, TTL_MS / 1000);
  const r = await fetchVehicles(key, fetchImpl);
  if (!r.ok) return json(r.status, { eroare: r.eroare });
  const body = { sursa: 'Tranzy – CTP Iași', actualizat: Math.round(Date.now() / 1000), vehicule: r.vehicule };
  cache = { at: Date.now(), body };
  return json(200, body, TTL_MS / 1000);
}

export const config = { path: '/live/vehicule' };
