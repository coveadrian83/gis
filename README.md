# Mobilitate Iași – Studiu participativ O–D (MVA × MVI) · v0.5

Aplicație web mobile-first pentru **Studiul participativ de mobilitate Origine–Destinație – Zona Metropolitană Iași**
(perioada de colectare 1 octombrie 2026 – 30 aprilie 2027), conform documentelor din `docs/`:
specificația v1.0, metodologia v0.4.5 și ghidul de testare v0.4.5.

Față de prototipul v0.4.5 (doar `localStorage`), v0.5 adaugă etapele 3 și 6 din roadmap:
**backend central** (TRIPS_RAW / TRIPS_ANALYSIS / AUDIT_LOG), **validare VALID/CHECK/EXCLUDE**
și **dashboard administrativ** cu filtre, matrice O–D și exporturi, utilizabil fără SQL sau terminal.

## Ce conține

**Aplicația publică** (`/`) – raportare în 3 pași, ținta fiind 30–45 secunde:
1. Origine și destinație: căutare fără diacritice și tolerantă la greșeli minore, în ordinea
   repere → localități SIRUTA → cele 17 zone → OpenStreetMap/Nominatim; sau selecție pe hartă.
   Butoane: Schimbă pe hartă, Șterge, Inversează, Reia O/D, Pan, Încadrează ZMI, Centrează pe Iași, Locația mea.
   Localitatea aleasă din nomenclator este validă imediat; Nominatim doar rafinează markerul (Metodologie §7).
2. Data (implicit azi, max. 7 zile în urmă), ora plecării, ora sosirii, durata calculată imediat (inclusiv peste miezul nopții).
3. Mod, scop, recurent/ocazional; șofer/pasager și ocupare doar pentru autoturism; linia TP opțională.

Plus: rezumat la final, „Raportează drumul de întoarcere”, relații salvate local pentru raportări repetate,
„Deplasările mele”, coadă locală când nu există conexiune (retrimitere automată, idempotentă),
participant pseudonim, parametru de campanie `?source=…`, ștergerea propriilor date (dreptul la ștergere).

**Backend** (`server/`) – Node.js ≥ 22.13, **fără dependențe npm** (folosește `node:http` și `node:sqlite`):
- clasificare la server (nu se ia de bun ce trimite browserul): zonă `IAS-Z01…Z17` / localitate `LOC-<SIRUTA>` /
  `UAT-<SIRUTA>` (rest) / `OUT_ZMI`; armonizarea poligoanelor UNNAMED se aplică automat;
- câmpurile din Anexa B: `duration_min`, `departure_time_band`, `arrival_time_band`, `reporting_delay_hours`,
  `validation_status`, `validation_flags`, `geometry_version`, `campaign_source` etc., plus `day_type`, `period_tag`, `distance_km`;
- reguli automate: EXCLUDE doar pentru duplicat cert; CHECK pentru durate < 2 min sau > 180 min, viteză neplauzibilă
  pentru mod, punct identic, suprapunere în timp, > 12 deplasări/zi, ambele capete în afara ZMI etc.
  Valorile extreme **nu** se elimină automat;
- datele brute se păstrează nemodificate; TRIPS_ANALYSIS poate fi reconstruit oricând („Reprocesează”),
  păstrând deciziile manuale; fiecare decizie intră în AUDIT_LOG;
- coordonatele se stochează rotunjit (4 zecimale ≈ 11 m); IP-ul nu se salvează; limitare de rată în memorie.

**Dashboard** (`/admin/`, protejat cu parolă):
- Sumar: deplasări, participanți unici, zile, VALID/CHECK/EXCLUDE, fluxuri externe, durată mediană, distribuții;
- Deplasări: listă filtrabilă, detaliu cu date brute, flag-uri explicate, decizie VALID/CHECK/EXCLUDE cu notă;
- Relații O–D (zonă/localitate sau UAT): N deplasări / participanți / zile, mediană, medie, P25, P75, P90,
  P90 − mediană, vârf de plecare, moduri, clasa de volum (<10, 10–29, 30–49, ≥50) + hartă de fluxuri;
- Acoperire: unități subacoperite (pentru promovare adaptivă);
- Exporturi: CSV (standard sau „Excel RO” cu `;`), GeoJSON fluxuri O–D, acoperire, audit, date brute JSONL.

## Pornire rapidă

```bash
# 1. datele geografice (din pachetul v0.4.5) în public/data/ – vezi public/data/README.md
cp /cale/pachet_v0.4.5/{iasi_17_zone_mva_mvi.geojson,zmi_uat_web.geojson,zmi_localitati_siruta_2025.json,mvi_poi_aliases.json} public/data/
npm run check-geo          # verifică ce s-a detectat + căutările din ghidul de testare

# 2. pornire
ADMIN_PASSWORD='o-parola-lunga' npm start      # http://localhost:8080 , dashboard: /admin/

# teste automate
npm test

# date fictive pentru încercarea dashboardului (bază separată, var/demo.sqlite)
npm run demo-data -- --n 300
DB_PATH=var/demo.sqlite ADMIN_PASSWORD=test npm start
```

## Configurare (variabile de mediu)

| Variabilă | Implicit | Rol |
|---|---|---|
| `PORT`, `HOST` | `8080`, `0.0.0.0` | adresa serverului |
| `DB_PATH` | `var/mobilitate.sqlite` | baza de date SQLite (faceți backup la acest fișier) |
| `ADMIN_PASSWORD` | – | parola dashboardului; fără ea, `/admin/` este dezactivat |
| `GEO_DATA_DIR` | `public/data` | directorul fișierelor geografice (servit și la `/data/`) |
| `GEOMETRY_VERSION` | `ZMI-2025.1` | versiunea zonării, înregistrată la fiecare deplasare |
| `STUDY_START`, `STUDY_END` | `2026-10-01`, `2027-04-30` | perioada de colectare |
| `MAX_DAYS_BACK` | `7` | raportare retrospectivă maximă |
| `GEOCODER_URL` | Nominatim OSM | geocodare fallback; gol = dezactivat |
| `TILE_URL` | tile.openstreetmap.org | harta de bază |
| `COORD_DECIMALS` | `4` | precizia coordonatelor stocate |
| `PERIODS_FILE` | `config/periods.json` | etichete analitice (ex. Sărbătorile Iașului 8–16 oct.) |
| `TRUST_PROXY` | `1` | citește `X-Forwarded-For/Proto` (în spatele nginx/Apache) |

## Publicare

- Hosting cu Node.js ≥ 22.13 (VPS, cPanel „Setup Node.js App”, Render, Fly.io etc.), în spatele unui proxy HTTPS.
  Exemplu nginx: `location / { proxy_pass http://127.0.0.1:8080; proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto $scheme; }`
- Staging: `mobilitate-test.moldovavreainfrastructura.ro`; producție: `mobilitate.moldovavreainfrastructura.ro` (spec. §23, Anexa C).
- Doar hosting static? Directorul `public/` funcționează și singur, în **mod demonstrativ** (ca v0.4.5: datele rămân
  în browser, cu avertisment vizibil) – util pentru teste UX, nu pentru colectare.
- Backup: copiați periodic `DB_PATH` (de preferat cu `sqlite3 mobilitate.sqlite ".backup backup.sqlite"`).

## Structura

```
server/          backend (http, SQLite, clasificare, validare, agregări, exporturi)
public/          aplicația publică + dashboard (/admin/) + pagini Confidențialitate / Metodologie
public/shared/   geo-core.js (căutare + point-in-polygon) și domain.js – comune browser/server
public/data/     fișierele geografice (GEO_ZONES / GEO_ALIASES)
config/          perioade analitice
scripts/         check-geo, reprocess, purge-coords (retenție), demo-data
test/            teste automate (date geografice sintetice)
docs/            specificația v1.0, metodologia și ghidul de testare v0.4.5
```

## Înainte de lansarea publică (rămân de făcut)

- copierea fișierelor geografice validate MVI (nu sunt în depozit) și `npm run check-geo`;
- înlocuirea `mvi_poi_aliases.json` (reperele implicite au coordonate aproximative) și extinderea nomenclatorului de repere;
- finalizarea informării GDPR (`public/confidentialitate.html` este proiect), retenție, operator de date, DPIA;
- un serviciu de geocodare adecvat volumului (Nominatim public are limită de 1 cerere/s);
- test controlat cu 20–30 de utilizatori (roadmap etapa 4) pe subdomeniul de staging;
- opțional, migrare la PostgreSQL/PostGIS dacă volumul o cere (schema este portabilă).
