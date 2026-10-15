// Rapoartele zilnice ale transportului public (netlify/lib/raport.mjs), din oră în oră: ziua de azi până acum și ziua
// de ieri, finalizată. Orarul și cartierele vin de pe site (fișierele publicate la /data/).
import '../lib/require-shim.mjs';
import { getStore } from '@netlify/blobs';
import { run } from '../lib/raport.mjs';

export default async function handler() {
  const base = process.env.URL || 'https://mobilitate-iasi.netlify.app';
  const get = async (p) => { const r = await fetch(new URL(p, base)); if (!r.ok) throw new Error(p + ': ' + r.status); return r.json(); };
  try {
    const [plan, zones] = await Promise.all([get('/data/transport/sanatate_plan.json'), get('/data/iasi_17_zone_mva_mvi.geojson')]);
    const zile = await run(getStore({ name: 'gps', consistency: 'strong' }), plan, zones, Math.round(Date.now() / 1000));
    return new Response(JSON.stringify({ ok: true, zile }), { status: 200 });
  } catch (e) {
    console.warn('raport zilnic:', e.message);
    return new Response(JSON.stringify({ ok: false, eroare: e.message }), { status: 200 });
  }
}

export const config = { schedule: '7 * * * *' };
