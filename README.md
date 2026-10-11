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

## Unde crește Iașul – harta PUZ-urilor votate de Consiliul Local Iași (`/puz/`)

Planurile urbanistice zonale (PUZ, inclusiv PUZ pentru zone construite protejate) aprobate, respinse sau modificate
de Consiliul Local Iași din 2016 până azi, pe hartă, peste cele 17 zone MVA–MVI, cu agregare pe zone, pe cartiere (OSM) și pe UAT.

**Prelucrarea și integrarea datelor:** dr. geogr. Adrian Covăsnianu.

- **Ce conține fiecare PUZ**: număr și dată HCL, statut (aprobat / respins / modificare …), adresă, identificare
  cadastrală, funcțiune (clasificată automat din obiectul hotărârii), suprafața reglementată, regimul de înălțime și
  numărul de niveluri, H max, POT/CUT, spații verzi, voturile din plen, avizele comisiilor, apartamente și locuri de
  parcare (unde sunt cunoscute), zona MVA–MVI, cartierul, UAT-ul și linkurile la PDF-ul oficial și la textul integral.
- **Surse**: textul hotărârilor din registrul [hcl.usr.ro/iasi](https://hcl.usr.ro/iasi) (oglinda hotărârilor
  primăriei; acolo unde registrul anonimizează numele străzilor, adresa se ia din PDF-ul oficial de pe
  primaria-iasi.ro); **apartamentele și locurile de parcare** apar rar în hotărâri și se completează din articolele
  [apix.ro](https://apix.ro) despre PUZ-uri (potrivite după cadastral, adresă și suprafață, cu verificarea
  plauzibilității față de suprafață și CUT; fiecare valoare are linkul articolului și mențiunea „estimare” când textul
  o indică); localizarea: **pe parcelă**, după numărul cadastral din hotărâre, din parcelarul OCPI (vezi mai jos);
  altfel numărul poștal prin Nominatim (unde OSM îl are), altfel punctul central al străzii din
  OpenStreetMap (Overpass; doar străzile din UAT Iași, ca omonimele din comunele vecine să nu încurce), altfel centrul
  zonei MVA–MVI; precizia e notată (număr / stradă / zonă). Cartierul OSM vine din geocodarea inversă Nominatim.
- **Capacitate teoretică**: pentru PUZ-urile de locuințe colective și mixte, `adc_max_mp` = suprafață × CUT și
  `apartamente_capacitate` (80% locuibil, 75 mp ADC/apartament; la mixte jumătate) – un plafon de comparație între
  zone, afișat separat și niciodată adunat cu apartamentele cunoscute.
- **Parcele OCPI**: `data/puz_parcele.geojson` conține doar parcelele menționate în hotărârile PUZ (număr cadastral,
  contur WGS84, suprafață), extrase cu `python scripts/puz_parcele.py Imobile.shp --sursa "…"` (necesită
  `pip install pyshp pyproj shapely`) dintr-un export eTerra cu numărul cadastral în `NATIONAL_C`; parcelarul complet
  nu se publică. Un PUZ e pus pe parcelă doar dacă suprafața parcelelor e între 0,3× și 3× suprafața reglementată
  (numerele cadastrale vechi, scurte, din 2016–2017 pot coincide cu alte parcele). Conturul apare pe hartă de la zoom 15
  (`public/data/puz_iasi_parcele.geojson`). La un export nou al parcelarului se rulează din nou `puz_parcele.py`.
- **Corecturi manuale**: `data/puz_iasi_completari.csv` (`hcl` = ex. `497/2025`; `apartamente`, `locuri_parcare`,
  `lat`, `lon`, `sursa`, `nota`) – au prioritate față de valorile extrase automat.
- **Generare**: `python scripts/puz_iasi.py [--ani 2024,2025] [--fara-geocodare] [--fara-apix] [--reimprospateaza]`
  (doar biblioteca standard Python; `pdftotext` opțional) → `public/data/puz_iasi.geojson`, `puz_iasi.csv` și
  `puz_iasi_de_verificat.csv` (PUZ-urile nelocalizate sau localizate doar pe zonă). Automat în GitHub Actions – lunar,
  la modificarea scriptului și manual: **Actions → Actualizare PUZ Iași → Run workflow**. Rularea din GitHub are acces
  la Nominatim și Overpass (localizare la număr / stradă și cartiere); local, fără ele, scriptul folosește rețeaua
  pietonală a hărții 15 minute, unde multe străzi centrale lipsesc (trotuarele nu au nume), deci localizează mai puțin.
- **Impact asupra mobilității** (`scripts/puz_mobilitate.py`, parametri în `config/puz_mobilitate.json`): deplasările
  produse de locuitorii noilor locuințe din PUZ-urile aprobate, în scenariul de construire realist (proiect / ~60% din
  CUT) și maxim (CUT integral), fiecare cu două scenarii de mobilitate – **PMUD** (1,61 deplasări/persoană/zi, ancheta
  PMUD Iași 2021) și **RPL** (structural: ocupați + elevi/studenți din RPL 2021) –, autoturismele pe zi și în ora de
  vârf a dimineții, plus deplasările atrase de comerț, birouri și echipamente (separat). Rezultat:
  `public/data/puz_mobilitate.json` / `.csv`; pe hartă, secțiunea „Impact asupra mobilității”; metodologia și sursele:
  `/puz/metodologie.html`. Parametrii marcați „provizoriu” (ora de vârf, ocuparea autoturismului, ponderea auto la
  periferie, ratele nerezidențiale) se înlocuiesc cu valori locale fără modificarea codului.
- **Locuri de muncă, densitate umană, acces la transport public** – după metodologia din disertația autorului
  (Covăsnianu, A., 2023, *Huburile de mobilitate…*, UAUIM „Ion Mincu”, Tabelul nr. 4,
  [ResearchGate](https://www.researchgate.net/publication/388290968_Huburile_de_mobilitate_Un_exemplu_de_dezvoltare_integrata_a_mobilitatii_De_la_concept_tipologie_cadru_ideologic_pana_la_implementarea_trenului_metropolitan_in_Zona_Metropolitana_Bucuresti)):
  locurile de muncă = ha × normă pe tip de zonă funcțională (birouri 200, retail mare 30, hipermarket 250, producție
  și logistică 40, activități tehnologice 120, comerț mic 20 / ha; tipul se deduce din obiectul hotărârii); o a doua
  variantă a deplasărilor atrase (locuri de muncă × 2 ÷ 29,4% – ponderea muncii, PMUD), lângă cea ITE; densitatea umană
  = (locuitori + locuri de muncă) / ha; distanța până la cea mai apropiată stație (oricare / tramvai sau tren, stațiile
  hărții 15 minute) și coridorul de 800 m (10 minute pe jos). Pe hartă: alegerea variantei de atracție, colorarea
  zonelor după densitate sau acces și tabelul „densitate umană și acces la transport public”.
- **Teste**: `python3 -m unittest discover -s test -p 'test_puz*.py'`.
- **Limite**: indicatorii sunt extrași automat din text – verificați hotărârea înainte de a-i cita; un PUZ aprobat nu
  înseamnă o construcție autorizată sau realizată; apartamentele și parcările sunt cunoscute doar pentru o parte din PUZ-uri.

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
public/puz/                 harta PUZ-urilor votate de Consiliul Local Iași (date: public/data/puz_iasi.geojson)
scripts/puz_iasi.py         colectarea PUZ-urilor (hcl.usr.ro + apix.ro), extragerea indicatorilor, localizarea
scripts/puz_parcele.py      extrasul parcelelor PUZ din parcelarul OCPI (data/puz_parcele.geojson)
scripts/puz_mobilitate.py   deplasările generate de PUZ-uri (scenariile PMUD și RPL; config/puz_mobilitate.json)
data/puz_iasi_completari.csv  corecturi și completări manuale pentru PUZ-uri
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
