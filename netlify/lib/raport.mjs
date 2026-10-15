// Rapoartele zilnice ale transportului public (pagina /transport/raport/), din arhiva GPS (netlify/lib/gps-store.mjs),
// în același store Netlify Blobs („gps”):
//   raport/zi/<AAAA-LL-ZZ> – rezumatul zilei (public/transport/raport/agregare.js), ziua de azi actualizată din oră în
//                            oră (final: false), ziua de ieri finalizată după miezul nopții (final: true);
//   raport/index           – lista zilelor, cu cifrele lor (pentru comparații și tendințe).
import G from '../../public/transport/raport/agregare.js';
import { hour } from './gps-store.mjs';

export async function buildDay(store, zi, plan, zonesGeo, now) {
  const curHour = new Date(now * 1000).toISOString().slice(0, 13);
  const hours = G.hoursOfDay(zi).filter((h) => h <= curHour);
  const recs = [];
  for (const h of hours) recs.push(...(await hour(store, h)).citiri);
  const D = G.aggregateDay(plan, zonesGeo, recs, { zi });
  D.final = G.localDate(now) > zi;
  D.generat = now;
  await store.setJSON('raport/zi/' + zi, D);
  const idx = (await store.get('raport/index', { type: 'json' })) || { zile: [] };
  idx.zile = idx.zile.filter((z) => z.zi !== zi);
  if (D.citiri) {
    idx.zile.push({ zi, final: D.final, minute: D.minute, rezumat: D.rezumat, dow: new Date(zi + 'T12:00:00Z').getUTCDay() });
    idx.zile.sort((a, b) => (a.zi < b.zi ? -1 : 1));
  }
  idx.actualizat = now;
  await store.setJSON('raport/index', idx);
  return D;
}

/* O rulare (din oră în oră): ziua de azi, până acum, și ziua de ieri, dacă nu e încă finală. */
export async function run(store, plan, zonesGeo, now) {
  const azi = G.localDate(now), ieri = G.localDate(now - 86400);
  const done = [];
  const prev = await store.get('raport/zi/' + ieri, { type: 'json' });
  if (!prev || !prev.final) { await buildDay(store, ieri, plan, zonesGeo, now); done.push(ieri); }
  await buildDay(store, azi, plan, zonesGeo, now);
  done.push(azi);
  return done;
}
