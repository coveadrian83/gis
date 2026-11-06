// Rapoartele zilnice ale transportului public (netlify/lib/raport.mjs), din oră în oră: ziua de azi până acum și ziua
// de ieri, finalizată. Orarul și cartierele: fișierele împachetate cu funcția (included_files în netlify.toml); doar dacă
// lipsesc, de pe site – fără 48 de descărcări pe zi din traficul site-ului.
import '../lib/require-shim.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStore } from '@netlify/blobs';
import { run } from '../lib/raport.mjs';
import { PAUZA } from '../lib/pauza.mjs';

async function load(p) {
  try {
    return JSON.parse(await readFile(join(process.cwd(), 'public', p), 'utf8'));
  } catch {
    const r = await fetch(new URL(p, process.env.URL || 'https://mobilitate-iasi.netlify.app'));
    if (!r.ok) throw new Error(p + ': ' + r.status);
    return r.json();
  }
}

export default async function handler() {
  if (PAUZA) return new Response('pauză', { status: 200 });
  try {
    const [plan, zones] = await Promise.all([load('/data/transport/sanatate_plan.json'), load('/data/iasi_17_zone_mva_mvi.geojson')]);
    const zile = await run(getStore({ name: 'gps', consistency: 'strong' }), plan, zones, Math.round(Date.now() / 1000));
    return new Response(JSON.stringify({ ok: true, zile }), { status: 200 });
  } catch (e) {
    console.warn('raport zilnic:', e.message);
    return new Response(JSON.stringify({ ok: false, eroare: e.message }), { status: 200 });
  }
}

// PAUZĂ (netlify/lib/pauza.mjs): fără program. Repornire: export const config = { schedule: '7 * * * *' };
export const config = {};
