# Note pentru sesiunile Claude (proiectul mobilitate-iasi)

## Priorități (octombrie–noiembrie 2026)
1. **Studiul participativ de mobilitate O–D** (`/`, `/admin/`, `server/`, `netlify/functions/api.mjs`) – colectarea
   durează până la 30 aprilie 2027; are prioritate la orice decizie (stabilitate, date, costuri).
2. **Harta „Sănătatea transportului public”** (`/transport/sanatate/`), colectarea GPS și raportul zilnic
   (`/transport/raport/`).
3. Restul (hărțile 15 minute, micromobilitate, PUZ, comparația OSM) sunt relativ statice: se modifică doar la cerere.

## Costuri Netlify (plan cu 1.000 de credite pe lună, ciclul 11 → 10)
- **Fiecare publicare în producție (push / merge pe `main`) costă 15 credite**; Deploy Previews și branch deploys
  sunt gratuite. Restul consumului (trafic, funcții, colectarea GPS) e de ordinul a 150–250 de credite pe lună,
  deci rămân ~50 de publicări pe lună (1–2 pe zi).
- Adună modificările într-un singur PR (nu câte un PR pentru fiecare corectură mică); utilizatorul unește rar.
- Acțiunile GitHub care fac commit-uri de date (PUZ, OSM, 15 minute, micromobilitate) nu rulează pe `main` la push –
  datele se generează pe branch-ul PR-ului. Nu adăuga commit-uri automate pe `main`.
- `netlify.toml` → `ignore`: publicarea se sare dacă nu se schimbă `public/`, `netlify/`, `server/`, `config/`,
  `netlify.toml` sau dependențele.
- Cota cheii Tranzy: 5.000 de cereri pe zi (colectarea GPS 1.440 + `/live/vehicule` cel mult 2.880).
