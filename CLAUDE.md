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
- Cota cheii Tranzy: 5.000 de cereri pe zi (colectarea GPS 1.440 + `/live/vehicule` cel mult 2.880; acțiunea
  „Rute Tranzy” – o cerere pe săptămână).

## Harta sănătății – referințe
- Câte vehicule trebuie pe stradă: `data/transport/ctp_planificare.json` (planificarea S.C.T.P. din 8 sept. 2025),
  nu orarul GTFS (care cere ~170 de vehicule toată ziua). Intervalele de ranforsare sunt o ipoteză (06:30–09:00, 15:00–18:30).
- Codurile de rută din GPS pot lipsi din orarul GTFS: `scripts/transport_tranzy.py` (secretul GitHub `TRANZY_API_KEY`)
  descarcă rutele curente, iar `transport_sanatate.py` face corespondența (`alias_rute`).
