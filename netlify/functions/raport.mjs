// Rapoartele zilnice (netlify/lib/raport.mjs): /live/raport – lista zilelor; /live/raport?zi=2026-10-15 – ziua.
import { getStore } from '@netlify/blobs';

function json(status, data, maxAge) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Netlify-CDN-Cache-Control': `public, durable, s-maxage=${maxAge}, stale-while-revalidate=600`,
    },
  });
}

export async function respond(store, url) {
  const zi = new URL(url).searchParams.get('zi');
  if (zi == null) return json(200, (await store.get('raport/index', { type: 'json' })) || { zile: [] }, 600);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(zi)) return json(400, { eroare: 'Ziua se scrie AAAA-LL-ZZ, ex. 2026-10-15.' }, 60);
  const D = await store.get('raport/zi/' + zi, { type: 'json' });
  if (!D) return json(404, { eroare: 'Nu există raport pentru ' + zi + '.' }, 300);
  return json(200, D, D.final ? 86400 : 600);
}

export default async (req) => respond(getStore({ name: 'gps', consistency: 'strong' }), req.url);

export const config = { path: '/live/raport' };
