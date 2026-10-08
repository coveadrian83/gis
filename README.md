# Mobilitate Iași – Studiu participativ O–D (MVA × MVI) · v0.7

Aplicație web mobile-first pentru **Studiul participativ de mobilitate Origine–Destinație – Zona Metropolitană Iași**
(perioada de colectare 1 octombrie 2026 – 30 aprilie 2027), conform documentelor din `docs/`
(specificația v1.0, metodologia și ghidul de testare v0.4.5).

- **Aplicația publică** (`/`): raportarea unei deplasări în 3 pași, 30–45 de secunde, fără cont și fără nume.
- **Dashboardul** (`/admin/`, cu parolă): validare VALID/CHECK/EXCLUDE, matrice O–D, hartă de fluxuri, acoperire, exporturi.
- Rulează **direct pe Netlify** (datele se salvează în contul Netlify, în Netlify Blobs) sau pe orice server cu Node.js.

---

## Publicare pe Netlify – pas cu pas (fără programare)

### 1. Încarcă fișierele geografice în GitHub (o singură dată)
Fișierele din pachetul v0.4.5 nu sunt încă în proiect. În GitHub, pe depozitul **coveadrian83/gis**:
1. intră în directorul **`public/data`** (pe branch-ul folosit de Netlify);
2. apasă **Add file → Upload files**;
3. trage în pagină fișierele `iasi_17_zone_mva_mvi.geojson`, `zmi_uat_web.geojson`,
   `zmi_localitati_siruta_2025.json` (sau `.csv`) și, dacă îl ai, `mvi_poi_aliases.json` (îl înlocuiește pe cel implicit);
4. apasă **Commit changes**.

### 2. Creează site-ul în Netlify
1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project** → **GitHub**;
2. alege depozitul **coveadrian83/gis** și branch-ul (`main` după unirea pull request-ului, altfel `claude/exciting-faraday-didbqc`);
3. nu modifica nimic la setările de build (sunt citite automat din `netlify.toml`) → **Deploy**.

### 3. Setează parola dashboardului
1. în site: **Site configuration → Environment variables → Add a variable**;
2. **Key:** `ADMIN_PASSWORD` · **Value:** o parolă lungă, doar a ta;
3. **Deploys → Trigger deploy → Deploy site** (ca parola să fie preluată).

### 4. Verifică
- deschide adresa site-ului (`https://….netlify.app`) și raportează o deplasare de test;
- deschide `https://….netlify.app/admin/`, intră cu parola și verifică în **Export & date** că apar
  17/17 zone, 28 de UAT-uri și localitățile; deplasarea de test apare în **Deplasări**;
- poți șterge deplasările de test din aplicație: **Deplasările mele → Șterge datele mele**.

### 5. Domeniul propriu (opțional)
**Domain management → Add a domain** → `mobilitate-test.moldovavreainfrastructura.ro` (staging) sau
`mobilitate.moldovavreainfrastructura.ro` (producție). Netlify îți arată înregistrarea DNS (CNAME) pe care
administratorul domeniului trebuie s-o adauge; certificatul HTTPS se emite automat.

### Completarea reperelor (dashboard → Repere)
Reperele ajută participanții să găsească locul: scriind **„univ”** apar toate universitățile, **„spita”** toate spitalele,
**„mall”** centrele comerciale, **„piata”** piețele ș.a.m.d. (categoriile și cuvintele-cheie sunt în `public/shared/domain.js`).
- **+ Adaugă reper**: nume, categorie, alte denumiri (ex. „Spiridon; Urgențe”), apoi „Caută” sau apasă direct pe hartă;
- **Import listă / Excel**: lipești câte un nume pe rând (toate din categoria aleasă) sau coloane copiate din Excel
  (`nume, categorie, alias-uri, lat, lng`); reperele cu același nume se actualizează, nu se dublează;
- **Localizează automat**: caută în OpenStreetMap coordonatele reperelor care nu au (câte unul pe secundă);
  rezultatele apar „neverificat” – deschide-le cu „Editează” și confirmă poziția pe hartă;
- reperele fără coordonate nu apar participanților; exportul CSV/Excel al reperelor se poate completa și reimporta.

Lista de pornire conține principalele universități, spitale, centre comerciale, piețe și noduri din Iași – doar cu
numele; coordonatele se completează cu „Localizează automat” + verificare.

### Promovare (dashboard → Promovare)
- **link și cod QR pe canal** (pagina MVI/MVA, grupuri Facebook, WhatsApp, presă, afișe…): fiecare link are
  `?source=…`, iar în Sumar → „Canal de recrutare” se vede câte deplasări a adus fiecare canal;
- **texte gata de postat** (Facebook, grupuri, WhatsApp, Instagram, presă), cu linkul canalului și numărul actual de deplasări;
- după fiecare deplasare, participantul vede butoanele **WhatsApp / Facebook / Distribuie / Copiază linkul**
  (statistici: `share_wa`, `share_fb`, `share_native`, `share_copy`);
- linkul are **imagine de previzualizare** (`public/og-image.png`, sursa în `docs/promo/og-image.html`);
- pagina de start afișează un **contor public** („Deja N de deplasări…”), păstrat 5 minute în CDN;
- postarea automată e posibilă doar pe **paginile** de Facebook, prin programare în Meta Business Suite;
  Facebook și WhatsApp nu permit postarea automată în grupuri.

### Unde sunt datele și cum le descarc
Datele stau în contul Netlify al site-ului (**Netlify Blobs**, store-ul `mobilitate`). Pentru copii de siguranță
și analiză, folosește dashboardul → **Export & date**: date brute (JSONL), deplasări (CSV / Excel), matrice O–D,
fluxuri GeoJSON, audit. Recomandare: descarcă săptămânal exportul de date brute.

> Fiecare modificare încărcată în GitHub pe branch-ul ales republică automat site-ul. Datele colectate **nu** se pierd la republicare.

---

## Ce face aplicația

**Aplicația publică**
1. Origine și destinație: căutare fără diacritice și tolerantă la greșeli minore, în ordinea
   repere → localități SIRUTA → cele 17 zone → OpenStreetMap/Nominatim; sau selecție pe hartă
   (Schimbă pe hartă, Șterge, Inversează, Reia O/D, Pan, Încadrează ZMI, Centrează pe Iași, Locația mea).
   Localitatea aleasă din nomenclator este validă imediat; Nominatim doar rafinează markerul (Metodologie §7).
2. Data (implicit azi, max. 7 zile în urmă), ora plecării, ora sosirii, durata calculată imediat (inclusiv peste miezul nopții).
3. Mod, scop, recurent/ocazional; șofer/pasager și ocupare doar pentru autoturism; linia TP opțională.

Plus: rezumat, „Raportează drumul de întoarcere”, relații salvate pentru raportări repetate, „Deplasările mele”,
coadă locală când nu există conexiune (retrimitere automată), participant pseudonim, parametru de campanie
`?source=…` (ex. pentru codul QR: `…/?source=qr_afis`), ștergerea propriilor date.

**Logica de date**
- TRIPS_RAW: fiecare trimitere se păstrează nemodificată;
- TRIPS_ANALYSIS se calculează din TRIPS_RAW la fiecare afișare: clasificare point-in-polygon în zonă
  `IAS-Z01…Z17` (cu armonizarea UNNAMED), localitate `LOC-<SIRUTA>`, `UAT-<SIRUTA>` sau `OUT_ZMI`, plus câmpurile
  din Anexa B (`duration_min`, `departure_time_band`, `reporting_delay_hours`, `validation_flags`, `geometry_version` …).
  Dacă geometriile se schimbă, toate deplasările se reclasifică automat;
- validare automată: EXCLUDE doar pentru duplicat cert; CHECK pentru durate < 2 min sau > 180 min, viteză
  neplauzibilă pentru mod, punct identic, suprapunere în timp, > 12 deplasări/zi, ambele capete în afara ZMI etc.
  Valorile extreme **nu** se elimină automat; coordonatorul decide, iar decizia intră în AUDIT_LOG;
- OD_AGGREGATED: N deplasări / participanți / zile, mediană, medie, P25, P75, P90, P90 − mediană, vârf de plecare,
  moduri, clasa de volum (<10, 10–29, 30–49, ≥50);
- confidențialitate: coordonate rotunjite (≈ 11 m), IP nesalvat, retenție (eliminarea coordonatelor vechi, din dashboard).

## Harta „15 minute. Pentru cine?” – Iași (`/15min/`)

Hartă interactivă a accesibilității pietonale, adaptată după
[martincantcode/15-minutes](https://github.com/martincantcode/15-minutes) (licență MIT): câte facilități
(alimentație, sănătate, educație, parcuri, cafenele și restaurante), bănci de odihnă și stații de transport public
(tren, tramvai, autobuz) se pot atinge pe jos în 5–30 de minute, în funcție de viteza de mers (0,8–1,8 m/s),
de evitarea scărilor și de **pantă** (Copernicus GLO-30, funcția lui Tobler, scări mai lente la urcare, pantă maximă
acceptată – ex. 8 % pentru scaun rulant/cărucior). Totul rulează în browser, pe date OpenStreetMap; nu este nevoie de server.

- **Punct**: apăsați pe hartă; comparația cu referința (1,4 m/s, cu scări) și cu 5 profiluri predefinite;
  link partajabil (`/15min/#lat=…&lng=…&min=15&spd=1.1&st=1`).
- **Zone**: analiza celor 17 zone MVA–MVI pe o grilă regulată (facilități medii, pierdere față de referință,
  proporția punctelor cu toate cele 5 categorii, stații utilizabile), hartă coroplet și export CSV.
- **Date**: `public/15min/data/iasi/` se generează cu `scripts/export_15min.py` (osmnx) și `scripts/elevatie_15min.py`
  (panta), automat în GitHub Actions
  la modificarea scriptului sau manual: **Actions → Export date 15 minute (Iași) → Run workflow** (reîmprospătare OSM).
- **Linia de comandă**: `node scripts/analiza-15min.js [--min 15 --speed 1.1 --avoid --out var/zone.csv]` –
  același calcul ca pagina (`public/15min/core.js`).
- Metodologia și limitele: `public/15min/metodologie.html`.

---

## Rulare pe un server propriu (alternativă la Netlify)

Node.js ≥ 22.13; datele se salvează în SQLite.

```bash
npm install
ADMIN_PASSWORD='o-parola-lunga' npm start      # http://localhost:8080 , dashboard: /admin/
npm test                                       # teste automate
npm run check-geo                              # verifică fișierele din public/data
npm run check-geo -- https://site.netlify.app  # verifică fișierele publicate
npm run demo-data -- --n 300                   # date fictive în var/demo.sqlite
DB_PATH=var/demo.sqlite ADMIN_PASSWORD=test npm start
```

## Configurare (variabile de mediu)

| Variabilă | Implicit | Rol |
|---|---|---|
| `ADMIN_PASSWORD` | – | parola dashboardului; fără ea, `/admin/` este dezactivat |
| `SESSION_SECRET` | – | opțional; schimbarea lui deconectează toți administratorii |
| `GEOMETRY_VERSION` | `ZMI-2025.1` | versiunea zonării, înregistrată la fiecare deplasare |
| `STUDY_START`, `STUDY_END` | `2026-10-01`, `2027-04-30` | perioada de colectare |
| `MAX_DAYS_BACK` | `7` | raportare retrospectivă maximă |
| `GEOCODER_URL` | Nominatim OSM | geocodare fallback; gol = dezactivat |
| `TILE_URL` | tile.openstreetmap.org | harta de bază (pe Netlify actualizați și CSP din `netlify.toml`) |
| `COORD_DECIMALS` | `4` | precizia coordonatelor stocate |
| `RATE_LIMIT_TRIPS` | `40` | trimiteri permise pe IP în 10 minute |
| `PORT`, `HOST`, `DB_PATH`, `GEO_DATA_DIR`, `TRUST_PROXY` | | doar pentru serverul propriu |

Etichetele analitice ale perioadelor (ex. Sărbătorile Iașului 8–16 oct.) sunt în `config/periods.json`.

## Structura

```
netlify/functions/api.mjs   API-ul pe Netlify (stocare Netlify Blobs)
server/api.js               API-ul comun (Request → Response), folosit de Netlify și de serverul propriu
server/analysis.js          validarea intrărilor, clasificarea, regulile VALID/CHECK/EXCLUDE
server/stats.js             agregări O–D, sumar, acoperire, CSV
server/storage-*.js         stocare Netlify Blobs / SQLite
server/server.js            serverul Node propriu (fișiere statice + API)
public/                     aplicația publică, dashboardul (/admin/), Confidențialitate, Metodologie
public/shared/              geo-core.js (căutare + point-in-polygon) și domain.js – comune browser/server
public/data/                fișierele geografice
public/15min/               harta „15 minute. Pentru cine?” – Iași (core.js = calculul, data/iasi = export OSM)
scripts/export_15min.py     exportul rețelei pietonale și al facilităților din OSM (osmnx)
scripts/elevatie_15min.py   panta: elevația Copernicus GLO-30 pe fiecare segment (elev.bin)
scripts/analiza-15min.js    analiza pe puncte și pe zone din linia de comandă (--scari: scările și străzile abrupte)
test/                       teste automate (date geografice sintetice)
docs/                       specificația v1.0, metodologia și ghidul de testare v0.4.5
```

## Înainte de lansarea publică

- încărcarea fișierelor geografice validate MVI și verificarea în dashboard (Export & date);
- înlocuirea `mvi_poi_aliases.json` (reperele implicite au coordonate aproximative) și extinderea reperelor;
- finalizarea informării GDPR (`public/confidentialitate.html` este proiect), retenție, operator de date, DPIA;
- un serviciu de geocodare adecvat volumului (Nominatim public: max. 1 cerere/s);
- test controlat cu 20–30 de utilizatori (roadmap etapa 4).
