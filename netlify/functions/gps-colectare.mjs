// Colectarea pozițiilor GPS ale vehiculelor CTP Iași, la fiecare minut (funcție programată Netlify), în Netlify
// Blobs (store-ul „gps”, netlify/lib/gps-store.mjs). Din ele, harta „Sănătatea transportului public” arată imediat
// ultima jumătate de oră, iar în timp se strâng datele pentru viteza reală pe tronsoane și fiabilitatea liniilor.
// Funcțiile programate rulează doar pe publicarea de producție a site-ului. Fără TRANZY_API_KEY nu face nimic.
import { getStore } from '@netlify/blobs';
import { apiKey, fetchVehicles } from '../lib/tranzy.mjs';
import { save, bundle } from '../lib/gps-store.mjs';

export async function collect(store, key, fetchImpl = fetch, now = Math.round(Date.now() / 1000)) {
  const r = await fetchVehicles(key, fetchImpl);
  if (!r.ok) return { ok: false, eroare: r.eroare };
  await save(store, r.vehicule, now);
  const ore = await bundle(store, now);
  return { ok: true, vehicule: r.vehicule.length, ore };
}

export default async function handler() {
  const key = apiKey();
  if (!key) return new Response('lipsește TRANZY_API_KEY', { status: 200 });
  const res = await collect(getStore({ name: 'gps', consistency: 'strong' }), key);
  if (!res.ok) console.warn('colectare GPS:', res.eroare);
  return new Response(JSON.stringify(res), { status: 200 });
}

export const config = { schedule: '* * * * *' };
