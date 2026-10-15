// Istoricul pozițiilor GPS colectate la fiecare minut (gps-colectare.mjs):
//   /live/istoric?min=30           – citirile din ultimele 30 de minute (cel mult 40), pentru harta „Sănătatea
//                                    transportului public”, ca să aibă imediat traseele parcurse și vitezele;
//   /live/istoric?ora=2026-10-15T06 – citirile unei ore (UTC), pentru descărcare și analize;
//   /live/istoric                  – orele disponibile (verificarea colectării).
// Formatul citirilor: netlify/lib/gps-store.mjs.
import { getStore } from '@netlify/blobs';
import { recent, hour, inventory } from '../lib/gps-store.mjs';

function json(status, data, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      ...(maxAge ? { 'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${maxAge}, stale-while-revalidate=60` } : {}),
    },
  });
}

export async function respond(store, url, now = Math.round(Date.now() / 1000)) {
  const p = new URL(url).searchParams;
  if (p.has('min')) {
    const m = Math.max(1, Math.min(40, parseInt(p.get('min'), 10) || 30));
    return json(200, { actualizat: now, citiri: await recent(store, now, m) }, 60);
  }
  if (p.has('ora')) {
    const h = p.get('ora');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(h)) return json(400, { eroare: 'Ora se scrie AAAA-LL-ZZTHH (UTC), ex. 2026-10-15T06.' });
    const done = new Date(h + ':00:00Z').getTime() / 1000 + 3600 < now - 3600;   // ora încheiată de mult: nu se mai schimbă
    return json(200, await hour(store, h), done ? 86400 : 60);
  }
  return json(200, await inventory(store));
}

export default async (req) => respond(getStore({ name: 'gps', consistency: 'strong' }), req.url);

export const config = { path: '/live/istoric' };
