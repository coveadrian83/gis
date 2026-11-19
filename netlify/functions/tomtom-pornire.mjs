// Pornește la oră fixă acțiunea GitHub „Trafic TomTom (vârf)” (.github/workflows/tomtom-trafic.yml): marți, miercuri
// și joi, la 07:29 și 17:29 ora României. Rulările „schedule” ale GitHub întârzie ore întregi, așa că o pornim de aici,
// printr-un singur apel workflow_dispatch; colectarea propriu-zisă (cheia TomTom, salvarea pe branch-ul date/tomtom)
// rămâne în GitHub. Netlify programează în UTC, iar România e UTC+2 iarna și UTC+3 vara: funcția rulează la ambele
// ore UTC și pornește acțiunea doar când ora locală e 07 sau 17. Fără GITHUB_ACTIONS_TOKEN (token GitHub cu dreptul
// „Actions: read and write” pe depozit) nu face nimic. Se oprește după 30 aprilie 2027, odată cu studiul.
const REPO = 'coveadrian83/gis';
const WORKFLOW = 'tomtom-trafic.yml';
const SFARSIT = '2027-04-30';

export function oraRomaniei(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, ora: +p.hour, zi: p.weekday };
}

// true dacă acum e momentul unei porniri (marți–joi, ora locală 07 sau 17, până la sfârșitul colectării)
export function trebuiePornit(d = new Date()) {
  const o = oraRomaniei(d);
  return o.data <= SFARSIT && ['Tue', 'Wed', 'Thu'].includes(o.zi) && (o.ora === 7 || o.ora === 17);
}

export async function porneste(token, fetchImpl = fetch) {
  const r = await fetchImpl(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mobilitate-iasi' },
    body: JSON.stringify({ ref: 'main' }),
  });
  return { ok: r.status === 204, status: r.status };
}

export default async function handler() {
  if (!trebuiePornit()) return new Response(JSON.stringify({ ok: true, pornit: false }), { status: 200 });
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) return new Response('lipsește GITHUB_ACTIONS_TOKEN', { status: 200 });
  const res = await porneste(token);
  if (!res.ok) console.warn('pornire TomTom: GitHub a răspuns', res.status);
  return new Response(JSON.stringify(res), { status: 200 });
}

export const config = { schedule: '29 5,6,15,16 * * 2,3,4' };
