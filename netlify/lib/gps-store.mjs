// Arhiva pozițiilor GPS ale vehiculelor CTP Iași, în Netlify Blobs (store-ul „gps”), pentru harta „Sănătatea
// transportului public” (/transport/sanatate/) și pentru analizele ulterioare (viteza reală pe tronsoane și ore,
// fiabilitatea liniilor).
//
// Chei:
//   min/<minutul Unix>   – o citire pe minut: { t, v: [[id, ruta, sens, lat×1e5, lng×1e5, ts, viteză, tip, nr], …] }
//                          (tip 0 = tramvai, 1 = autobuz; sens 0 / 1 sau null) – ~10 KB
//   ora/<AAAA-LL-ZZTHH>  – citirile unei ore (UTC), adunate după ce ora s-a încheiat: { ora, citiri: [ … ] }
// Citirile pe minut se păstrează cât e nevoie pentru istoricul recent (KEEP_MIN), apoi se mută în fișierul orei.

export const KEEP_MIN = 45;     // minute păstrate ca citiri separate (istoricul recent cere cel mult 35)
const pad = (n) => String(n).padStart(10, '0');

export function pack(vehicule, t) {
  return {
    t,
    v: vehicule.map((x) => [x.id, x.ruta, x.sens == null ? null : +x.sens, Math.round(x.lat * 1e5), Math.round(x.lng * 1e5),
      x.ts, x.v, x.tip === 'tramvai' ? 0 : 1, x.nr]),
  };
}

export const hourId = (unixSec) => new Date(unixSec * 1000).toISOString().slice(0, 13);

/* Salvează citirea curentă (now în secunde). */
export async function save(store, vehicule, now) {
  const minute = Math.floor(now / 60);
  await store.setJSON('min/' + pad(minute), pack(vehicule, now));
  return minute;
}

/* Mută în ora/<oră> citirile pe minut ale orelor încheiate de cel puțin KEEP_MIN minute. Idempotent: dacă o rulare se
 * întrerupe, următoarea completează fișierul orei fără dubluri. */
export async function bundle(store, now) {
  const limit = Math.floor(now / 60) - KEEP_MIN;
  const byHour = {};
  for (const { key: k } of (await store.list({ prefix: 'min/' })).blobs) {
    const m = +k.slice(4), h = hourId(m * 60);
    if (Math.floor(m / 60) * 60 + 60 <= limit) (byHour[h] = byHour[h] || []).push(k);   // ora întreagă e mai veche de KEEP_MIN
  }
  for (const [h, ks] of Object.entries(byHour)) {
    const old = (await store.get('ora/' + h, { type: 'json' })) || { ora: h, citiri: [] };
    const seen = new Set(old.citiri.map((c) => Math.floor(c.t / 60)));
    for (const k of ks.sort()) {
      if (seen.has(+k.slice(4))) continue;
      const rec = await store.get(k, { type: 'json' });
      if (rec) old.citiri.push(rec);
    }
    old.citiri.sort((a, b) => a.t - b.t);
    await store.setJSON('ora/' + h, old);
    for (const k of ks) await store.delete(k);
  }
  return Object.keys(byHour);
}

/* Citirile din ultimele `minutes` minute. */
export async function recent(store, now, minutes) {
  const from = Math.floor(now / 60) - minutes;
  const keys = (await store.list({ prefix: 'min/' })).blobs.map((b) => b.key).filter((k) => +k.slice(4) >= from).sort();
  const out = await Promise.all(keys.map((k) => store.get(k, { type: 'json' })));
  return out.filter(Boolean);
}

/* Citirile unei ore (AAAA-LL-ZZTHH, UTC): din fișierul orei și din citirile pe minut încă nemutate. */
export async function hour(store, h) {
  const rec = (await store.get('ora/' + h, { type: 'json' })) || { ora: h, citiri: [] };
  const seen = new Set(rec.citiri.map((c) => Math.floor(c.t / 60)));
  const keys = (await store.list({ prefix: 'min/' })).blobs.map((b) => b.key)
    .filter((k) => hourId(+k.slice(4) * 60) === h && !seen.has(+k.slice(4))).sort();
  for (const k of keys) { const r = await store.get(k, { type: 'json' }); if (r) rec.citiri.push(r); }
  rec.citiri.sort((a, b) => a.t - b.t);
  return rec;
}

/* Orele arhivate și numărul de citiri pe minut încă separate. */
export async function inventory(store) {
  const ore = (await store.list({ prefix: 'ora/' })).blobs.map((b) => b.key.slice(4)).sort();
  const minute = (await store.list({ prefix: 'min/' })).blobs.length;
  return { ore, minute };
}
