// Pozițiile vehiculelor CTP Iași din API-ul de date deschise Tranzy (https://tranzy.ai/opendata/), agenția 1 = CTP
// Iași – aceeași sursă ca orarul GTFS din data/transport/gtfs/. Folosit de /live/vehicule (harta /transport/) și de
// colectarea GPS la fiecare minut (gps-colectare.mjs, pentru harta „Sănătatea transportului public”).
// Cheia API stă în variabila de mediu TRANZY_API_KEY (Netlify → Site configuration → Environment variables).
export const SOURCE = 'https://api.tranzy.ai/v1/opendata/vehicles';
export const AGENCY = '1';
export const MAX_AGE_MS = 10 * 60 * 1000; // vehiculele fără semnal de peste 10 minute (garate, GPS oprit) nu se păstrează

// fără spațiile, liniile noi sau ghilimelele copiate odată cu cheia în setările Netlify
export function apiKey() {
  return (process.env.TRANZY_API_KEY || '').trim().replace(/^["']+|["']+$/g, '').trim();
}

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

/* Citește pozițiile: { ok: true, vehicule } sau { ok: false, status, eroare }. */
export async function fetchVehicles(key, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(SOURCE, { headers: { 'X-API-KEY': key, 'X-Agency-Id': AGENCY, Accept: 'application/json' } });
    if (!r.ok) {
      const msg = r.status === 403 ? ' – cheia TRANZY_API_KEY nu este acceptată (verificați valoarea în Netlify)' : '';
      return { ok: false, status: 502, eroare: `Sursa Tranzy a răspuns ${r.status}${msg}.` };
    }
    return { ok: true, vehicule: simplify(await r.json()) };
  } catch (e) {
    return { ok: false, status: 502, eroare: 'Sursa Tranzy nu răspunde.' };
  }
}
