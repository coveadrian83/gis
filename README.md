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

## Harta „15 minute pe două roți” – micromobilitate în Iași (`/micromobilitate/`)

Aceeași logică precum harta pietonală, pentru **bicicletă, bicicletă electrică (pedelec), trotinetă electrică și
Segway cu ghidon**: ce facilități, parcări și puncte de închiriere pentru biciclete și stații de transport public se
ating în 5–30 de minute **respectând Codul rutier** (OUG 195/2002, Regulamentul HG 1391/2006 / HG 1075/2021), comparat
cu aceeași deplasare **fără restricții** și cu mersul pe jos.

- **Reguli**: pistele pentru biciclete sunt permise tuturor; bicicleta circulă pe carosabil, trotineta doar pe
  străzile cu limita ≤ 50 km/h (sau cu pistă / bandă); trotuarele, zonele pietonale și contrasensul se parcurg pe jos,
  cu vehiculul de mână; autostrăzile sunt excluse; Segway-ul nu urcă scări.
- **Viteza**: ecuație de putere (masă, rulare, aer, motor 250 / 350 / 600 W) pe panta Copernicus GLO-30, piatră cubică și
  neasfaltat mai lente.
- **Date**: `public/micromobilitate/data/iasi/` (graph.bin + micro.bin cu clasele, pistele, limita de viteză, sensul
  unic) se generează cu `scripts/export_micro15.py` și `scripts/elevatie_15min.py --dir …`, automat în GitHub Actions:
  **Actions → Export date micromobilitate (Iași) → Run workflow**.
- **Indicatori pentru bicicletă**: rețeaua „confortabilă” (doar piste și străzi liniștite), parcarea la destinație
  (facilitățile cu `amenity=bicycle_parking` la ≤ 100 m), bicicletă + transport public (park & ride, orarul GTFS CTP prin
  `scripts/transit_micro15.py`, fără transbordare) și **lipsurile din rețea** (segmentele pe care o pistă / un contrasens ar
  scurta cele mai multe deplasări; tabel și CSV).
- **Chestionarul velo al Masterplanului** (2022–2023, 1.413 chestionare): străzile parcurse și dorite, potrivite cu rețeaua OSM
  (strat pe hartă și pondere în prioritizarea lipsurilor), bicicliștii pe zone de domiciliu și indicatorii de opinie –
  doar agregate, prin `scripts/chestionar_velo.py` (răspunsurile brute stau local în `data/chestionar_velo/`, ignorat de git).
- **Linia de comandă**: `node scripts/analiza-micro15.js [--vehicle scooter --kmh 18 --min 15 --ref free --out var/zone.csv]`.
- Metodologia și **cadrul legal** (definiții, reguli, RCA din 16.11.2025, proiecte în curs): `public/micromobilitate/metodologie.html`.

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
  = (locuitori + locuri de muncă) / ha; distanța **pe rețeaua pietonală** a hărții 15 minute (`graph.bin`) până la cea
  mai apropiată stație (oricare / tramvai sau tren) și izocrona de 10 minute (800 m); distanța în linie dreaptă e
  raportată alături, ca limită superioară (rețeaua OSM are goluri). Pe hartă: alegerea variantei de atracție, colorarea
  zonelor după densitate sau acces, tabelul „densitate umană și acces la transport public”, **izocrona de 10 minute
  pe jos** la trecerea cu mouse-ul peste un PUZ (cu stațiile din ea; `public/15min/core.js`) și mărimea cercurilor
  după suprafață, deplasări produse, autoturisme în ora de vârf sau deplasări atrase.
- **Teste**: `python3 -m unittest discover -s test -p 'test_puz*.py'`.

## Transport public – Iași și Zona Metropolitană (`/transport/`)

Hartă în stilul hărților de volum de pasageri (cercuri proporționale, animație lună cu lună): traseele liniilor
CTP și titlurile de călătorie vândute în comunele ZMI deservite de CTP, ianuarie 2023 – decembrie 2025.

- **Pe comune**: cercul fiecărei comune arată **călătoriile estimate** sau **titlurile vândute** în luna (sau anul)
  aleasă, pe categorii (bilete, abonamente, elevi și studenți), cu sau fără titlurile **repartizate** de CTP pe comune
  (vânzările centralizate – aplicație, puncte din Iași). Clasament cu variația față de anul anterior, grafic lunar
  pe categorii pentru ZMI sau pentru comuna aleasă, buton ▶ pentru animație, export CSV.
- **Trasee și stații**: liniile de tramvai și autobuz, cu liniile cele mai utilizate (20, 36, 30, 46; tramvai 1 și 9)
  îngroșate și stațiile cele mai aglomerate (Târgu Cucu, Piața Unirii, Podu Roș, Gara, Țesătura, Palatul Culturii,
  Piața Independenței, Tudor Vladimirescu) marcate – după datele CTP pentru PMI (Masterplan). Pozițiile stațiilor
  aglomerate (`public/data/transport/statii_aglomerate.json`) sunt nodurile de transfer (ex. Târgu Cucu – rondul de la
  vest de Parcul Woodrow Wilson; Țesătura – intersecția Calea Chișinăului – Bd. Tutora) și se folosesc ca atare. Orice fișier GeoJSON / KML se poate
  **previzualiza** direct din pagină, fără a fi încărcat pe server.
- **Simbolizare**: tramvai (roșu), autobuz local (violet), autobuz metropolitan (magenta); liniile cele mai utilizate
  după CTP au un halou galben, iar grosimea liniilor metropolitane urmează titlurile / călătoriile din comunele pe care
  le străbat: volumul fiecărei comune se împarte în mod egal între liniile metropolitane care o deservesc (indicativ –
  CTP raportează vânzările pe comună, nu pe linie). Extinderea propusă a tramvaiului apare punctat (opțional). Fundal la alegere: întunecat sau
  OpenStreetMap standard. Apăsând pe o linie se deschide fișa ei: sensurile, lungimea, comunele străbătute, relația OSM.
- **Trasee actuale** (`data/transport/linii/`): `rute_autobuz_local.*` – cele 18 linii de autobuz locale CTP (35 de
  relații OSM, ambele sensuri, Stereo 70); `metropolitan_amtpi/*.kmz` – cele 28 de trasee metropolitane AMTPI (KMZ din
  aprilie 2025, cu stațiile fiecărui traseu: numărul liniei din numele documentului, capetele din descriere);
  `metropolitan_amtpi_osm.geojson` – liniile AMTPI fără KMZ preluate din OSM (23); `rute_tramvai_osm.geojson` –
  tramvaiul pe linii (1, 3, 5, 6, 7, 8, 9, 11, 13, din OSM); `retea_tramvai.geojson` – rețeaua de tramvai existentă
  (34,5 km de cale) și extinderea propusă (13 km), din `Infrastructura_Mobilitate.gpkg`; `statii_autobuz_local.*` –
  273 de stații de autobuz (OSM); `statii_tramvai.*` – 111 stații de tramvai (extrase din OSM pentru Masterplanul
  metropolitan Iași); `statii_derivate.gpkg` – stațiile aglomerate CTP, capetele de linie și stațiile de transfer.
  Versiunile anterioare ale rețelei metropolitane (`trasee_transport_public_metropolitan.gpkg`,
  `statii_TP_ZMI_analiza_2D`) sunt păstrate în `data/transport/arhiva/` și nu mai sunt folosite.
- **Iași Live** (`/live/`, `public/live/`): aplicația pentru telefon (instalabilă, PWA) – harta vectorială fluidă
  (MapLibre GL 6.11.2, `public/vendor/maplibre-gl/`, fundal OpenFreeMap); vehiculele înaintează lin pe traseu între
  pozițiile GPS (cu viteza lor, corectate lin la fiecare poziție nouă); fișa stației (toate peroanele cu același nume)
  cu sosirile estimate din GPS și plecările din orar; fișa liniei și a vehiculului; căutare, stațiile favorite și
  „lângă mine”; legături directe (`#s=<stație>`, `#l=<linie>`, `#l=T<tramvai>`). Datele:
  `public/data/transport/live/forme.json` (traseele pe sens, cu stațiile și distanța de la plecare, viteza comercială
  din orar) și `live/plecari/<stație>.json` (plecările din orar), generate de `scripts/transport_gtfs.py`.
- **Vehiculele în timp real** (stratul „Vehiculele în timp real”, oprit implicit): pozițiile GPS ale vehiculelor CTP
  din API-ul de date deschise Tranzy (https://tranzy.ai/opendata/), actualizate la 30 s, cu numărul liniei, destinația
  (din orarul GTFS) și direcția de mers. Pagina le cere de la funcția Netlify `/live/vehicule`
  (`netlify/functions/vehicule.mjs`), care ține cheia API pe server și păstrează răspunsul 30 s (cota cheii Tranzy: 5.000 de cereri pe zi; de aici cel mult 2.880, plus 1.440 ale colectării GPS). **Setare necesară:**
  variabila de mediu `TRANZY_API_KEY` în Netlify (Site configuration → Environment variables); fără ea, stratul
  afișează că pozițiile nu sunt configurate.
- **Orarul GTFS** (`data/transport/gtfs/IASI_GTFS.zip`, CTP Iași publicat de Tranzy – https://tranzy.ai/opendata/;
  `python scripts/transport_gtfs.py`): `public/data/transport/gtfs_servicii.json` – pe linie, cursele pe zi lucrătoare /
  de weekend, prima și ultima plecare, intervalul mediu la vârf (7–9); pe stație, liniile exacte din orar și plecările
  pe zi; `data/transport/linii/rute_gtfs.geojson` – formele traseelor (formele tramvaielor sunt aliniate pe șinele din
  OSM – `data/transport/osm/sine.json` și relațiile de tramvai –, fără abaterile și „cârligele” până la stații din GTFS). **Orarul GTFS (datele CTP) este sursa
  principală** a traseelor și a stațiilor: înlocuiește traseele aceleiași linii din AMTPI / OSM (52 de linii); sursele
  alternative rămân doar pentru liniile fără orar (201, 204, 602, 603 – KMZ AMTPI, cu stațiile lor) și pentru liniile în
  proiect. Pe hartă: grosimea liniilor după curse pe zi (zi lucrătoare / weekend),
  stațiile din orar dimensionate după plecări și clasamentul stațiilor după plecări (Tg. Cucu, Gară, Moara 1 Mai, CUG I,
  Țesătura…). În raport: coloanele „Orar GTFS” și „Traseu = GTFS %” ale inventarului.
- **Lista oficială AMTPI** (`python scripts/transport_amtpi.py` → `data/transport/amtpi_trasee.json`, din
  https://www.amtpi.ro/trasee-2/): liniile „în proiect” (402, 504, 506, 507, 508) apar pe hartă ca propuneri, punctat,
  împreună cu stațiile deservite doar de ele; fișa liniei arată statutul AMTPI și legătura la pagina traseului; liniile
  din date absente din listă sunt marcate „nelistat”. Corecturile manuale ale statutului (ex. 205 – planificată,
  neoperațională) sunt în `data/transport/linii_corecturi.json`. Liniile stațiilor metropolitane = traseele AMTPI din care
  fac parte + liniile locale care trec la ≤ 30 m. Rețeaua se
  citește din numele fișierului („…_local”, „…_metropolitan”) sau din câmpul `network`; altfel traseele cu peste 25 %
  din lungime în afara municipiului sunt considerate metropolitane. La exporturile OSM, numărul din numele relației
  („Bus 36: Breazu => Rond Dacia”) are prioritate față de un `ref` care îl contrazice (ex. `6B`).
- **Trasee – încărcare**: fișierele KML / KMZ / GeoPackage / Shapefile se încarcă în GitHub în `data/transport/linii/`
  (**Add file → Upload files**); acțiunea **Trasee transport public** le convertește automat în
  `public/data/transport/linii.geojson` și `statii.geojson`. Local: `pip install pyshp pyproj shapely`, apoi
  `python scripts/transport_linii.py data/transport/linii [--tramvai 1,3,6,7,8,9,11,13]`.
- **Titluri de călătorie**: `pip install openpyxl`, apoi
  `python scripts/transport_titluri.py <centralizator 2023>.xlsx <2024>.xlsx <2025>.xlsx` →
  `public/data/transport/titluri_zm.json` și `.csv`. Fișierele Excel ale CTP nu se publică (conțin și foi contabile;
  `data/transport/*.xlsx` este ignorat de git) – doar agregatele pe comună, lună și categorie. Călătoriile se estimează
  cu numărul de călătorii pe titlu folosit de CTP (bilet = 1, bilet 2 călătorii = 2, abonament 30 de zile = 60,
  ZM + Iași = 135, 6 luni = 360 / 810, 12 luni = 1620, abonament studenți = 120); rândurile în lei, suprataxele și
  dublurile contabile („(-)”, „Primărie”) nu se numără. Centralizatorul municipiului Iași există doar pentru 2023
  (secțiunea „Municipiul Iași, 2023”); Țuțora lipsește din centralizatorul 2025, iar Valea Lupului apare din martie 2024.
- **Comparația cu OpenStreetMap** (`/transport/comparatie.html`): acțiunea **Date OSM transport public**
  (`scripts/transport_osm.py`, Overpass – rulează în GitHub Actions, Overpass nu e accesibil din mediul cloud)
  descarcă rutele și stațiile din OSM în `data/transport/osm/`; `python scripts/transport_compara_osm.py` compară
  liniile (prezență, suprapunerea traseelor la ≤ 30 m, porțiunile diferite > 100 m) și stațiile (concordant / nume
  diferit / decalat / lipsă / doar în OSM) și listează problemele de etichetare din OSM (ref ≠ nume, trasee
  discontinue, rețea greșită, stații fără nume) → `public/data/transport/comparatie_osm.*` (JSON, GeoJSON, CSV).
  Raportul are și **inventarul liniilor** din toate sursele (hartă, OSM, AMTPI, inventarul Moovit din
  `data/transport/moovit_inventar_2026.csv` – doar numere și descrieri, ca referință) → `inventar_linii.csv`.
  Aceeași acțiune extrage din OSM traseele tramvaiului pe linii (`data/transport/linii/rute_tramvai_osm.geojson`:
  liniile 1, 3, 5, 6, 7, 8, 9, 11, 13) și regenerează traseele hărții și comparația.
- **Teste**: `python3 -m unittest discover -s test -p 'test_transport*.py'`.
- **Limite**: indicatorii sunt extrași automat din text – verificați hotărârea înainte de a-i cita; un PUZ aprobat nu
  înseamnă o construcție autorizată sau realizată; apartamentele și parcările sunt cunoscute doar pentru o parte din PUZ-uri.

## Sănătatea transportului public – Iași, în timp real (`/transport/sanatate/`)

Pozițiile GPS ale vehiculelor CTP (Tranzy, la 30 s) comparate cu orarul GTFS: pe fiecare linie și sens, **câte
vehicule sunt pe stradă față de câte cere orarul**, **cât de repede avansează** față de viteza din orar, **cât de
regulat** sunt distanțate (plutoane = două vehicule lipite, goluri = peste dublul intervalului) și **cine stă pe loc**
în afara capetelor de linie. Din ele: un scor 0–100 pe linie și pe rețea, alertele momentului (inclusiv „mai multe
tramvaie oprite pe aceeași porțiune – posibilă blocare”) și harta vitezei reale pe tronsoane de 250 m, în ultima
jumătate de oră. Metoda completă e în pagină („Cum se calculează”); calculele sunt în `public/transport/sanatate/core.js`.

- **Planul de referință**: `python scripts/transport_sanatate.py` → `public/data/transport/sanatate_plan.json` (formele
  traseelor din `rute_gtfs.geojson`, simplificate, și cursele din orar pe tip de zi). Rulează automat în acțiunea
  **Trasee transport public**, după `transport_gtfs.py`.
- **Colectarea GPS** (`netlify/functions/gps-colectare.mjs`): funcție programată Netlify, **la fiecare minut**, salvează
  pozițiile în Netlify Blobs (store-ul `gps`): o citire pe minut (~10 KB), adunate apoi într-un fișier pe oră.
  Rulează doar pe publicarea de producție și doar cu `TRANZY_API_KEY` setată. Din aceste date vor ieși harta vitezei pe
  ore, minutele pierdute pe tronsoane și fiabilitatea lunară a liniilor.
- **Istoricul** (`/live/istoric`): fără parametri – orele colectate (verificarea colectării); `?min=30` – ultima
  jumătate de oră (o folosește harta la deschidere); `?ora=2026-10-15T06` – citirile unei ore (UTC), pentru descărcare.
- **Limite**: linia și sensul vin din sursa GPS – o parte din vehicule nu au linia atribuită, iar la unele linii apar
  mult mai multe vehicule decât în orar (atribuire probabil greșită; marcate „de verificat”, fără scor). Scorul unei
  linii cu un singur vehicul e sensibil la o singură oprire.
- **Teste**: `node --test test/sanatate-core.test.js test/gps.test.js` și `test/test_transport_sanatate.py`.

### Raportul zilnic – „Transportul public, zi de zi” (`/transport/raport/`)

Din arhiva GPS, fiecare zi se rezumă pentru analize de mobilitate urbană (`public/transport/raport/agregare.js` – aceleași
calcule ca harta în timp real, rulate peste toate citirile zilei):
- **cronologia rețelei** la 5 minute (scor, serviciu, viteză, plutoane, opriri), comparabilă între zile;
- **zilele** – scorul mediu (06–22), scorul la vârful de dimineață, viteza, durata curselor față de orar; zile
  lucrătoare față de weekend;
- **liniile oră cu oră** (scor, serviciu, viteză) și **cursele reconstituite** capăt–capăt: ora plecării, durata reală,
  durata din orar;
- **cartierele** (zonele MVA–MVI) pe ore: scorul liniilor care trec, viteza, timpul oprit și în pluton;
- **tronsoanele de 250 m** pe intervale orare: viteza medie de spațiu și **minutele-vehicul pierdute** față de viteza de
  referință a tronsonului (percentila 85 din zi); **punctele negre** – unde vehiculele stau pe loc pe traseu;
- **exporturi CSV** (cronologie, linii, cartiere, curse, tronsoane cu coordonate, puncte negre) și JSON.

Rapoartele le calculează funcția programată `netlify/functions/raport-zilnic.mjs`, din oră în oră (ziua de azi până
acum; ziua de ieri, finalizată după miezul nopții), în Netlify Blobs (store-ul `gps`, cheile `raport/zi/<zi>` și
`raport/index`), serviți la `/live/raport` (lista zilelor) și `/live/raport?zi=AAAA-LL-ZZ`. Pagina poate calcula și
ziua de azi direct din arhiva pe minut („Calculează azi, până acum”). Teste: `node --test test/raport.test.js`.

## Accesibilitatea la transportul public – Iași și ZMI (`/accesibilitate/`)

- Distanța pe jos, pe rețeaua de străzi și drumuri, de la fiecare celulă de 100 m locuită (WorldPop 2020) până la cea mai
  apropiată stație, calculată cu **Madina** (MIT City Form Lab, Urban Network Analysis), și clasificarea celor 17 cartiere
  și 18 comune din ZMI după metodologia **Covăsnianu (2025)**, adaptată, cu pragurile din **Legea nr. 155/2023**.
- Două hărți (**situația existentă** și **situația propusă** prin Masterplanul Metropolitan de Transport: tren metropolitan
  V1/V2, trasee noi, inelele R1 și R2, puncte intermodale) și două scări (caroiaj de 100 m · cartiere și UAT-uri).
  Rază de captare: 500 m pentru autobuz și tramvai, 800 m pentru tren (TOD).
- **Frecvența** (art. 21 lit. d, complet): din GTFS-ul CTP, câți locuitori au la ≤ 500 m o linie cu interval de cel mult
  20 de minute (vârf 07–09 și 10–14, zile lucrătoare), pe hartă și pe UAT-uri. Situația propusă are în plus harta
  golurilor rămase după măsurile MPM și bazinele de captare ale stațiilor de tren și punctelor intermodale (locuitori la
  500 / 800 m, liniile CTP pentru transfer). `python3 scripts/accesibilitate/frecventa.py` (doar numpy) →
  `data/frecventa.json`; se rulează din nou când se actualizează `data/transport/gtfs/IASI_GTFS.zip`.
- Pagină statică, fără bibliotecă externă (canvas): `public/accesibilitate/` – `index.html`, `app.js`, `style.css`,
  `data/detaliu.json` (caroiaj, stații, trasee), `data/general.json` (indicatori pe unități), `data/frecventa.json`.
  Pagina se editează direct (`build_site.py` a servit doar la conversia inițială).
- **Date și calcul**: rulate în afara depozitului, pe baza de date MPM Iași (Banca Mondială), OpenStreetMap (Geofabrik) și
  WorldPop; scripturile sunt în `scripts/accesibilitate/` (Madina se instalează din GitHub și are nevoie de două
  corecturi pentru pandas 3, descrise în `prep_zmi.py`).

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
public/micromobilitate/     harta „15 minute pe două roți” (micro.js = regulile și vitezele, data/iasi = export OSM)
public/accesibilitate/      accesibilitatea la transportul public, existent vs. MPM (date: data/*.json, calcul Madina)
public/puz/                 harta PUZ-urilor votate de Consiliul Local Iași (date: public/data/puz_iasi.geojson)
public/transport/           harta transportului public (date: public/data/transport/)
public/transport/sanatate/  harta „Sănătatea transportului public” (core.js = calculul; GPS: /live/vehicule, /live/istoric)
public/transport/raport/    raportul zilnic din GPS (agregare.js = rezumatul zilei; date: /live/raport)
scripts/puz_iasi.py         colectarea PUZ-urilor (hcl.usr.ro + apix.ro), extragerea indicatorilor, localizarea
scripts/puz_parcele.py      extrasul parcelelor PUZ din parcelarul OCPI (data/puz_parcele.geojson)
scripts/puz_mobilitate.py   deplasările generate de PUZ-uri (scenariile PMUD și RPL; config/puz_mobilitate.json)
scripts/transport_titluri.py  titlurile de călătorie CTP pe comune ZMI și luni (din centralizatoarele Excel)
scripts/transport_linii.py  traseele și stațiile din KML / GeoPackage / Shapefile (data/transport/linii/)
scripts/transport_sanatate.py  planul de referință al hărții de sănătate (orar GTFS + forme → sanatate_plan.json)
data/puz_iasi_completari.csv  corecturi și completări manuale pentru PUZ-uri
scripts/export_15min.py     exportul rețelei pietonale și al facilităților din OSM (osmnx)
scripts/elevatie_15min.py   panta: elevația Copernicus GLO-30 pe fiecare segment (elev.bin)
scripts/export_micro15.py   rețeaua pentru micromobilitate: piste, limite de viteză, sens unic (osmnx)
scripts/transit_micro15.py  orarul CTP (GTFS) compact pentru varianta bicicletă + transport public
scripts/chestionar_velo.py  agregatele chestionarului velo (străzi, zone, opinii) pentru harta micromobilității
scripts/analiza-micro15.js  analiza micromobilității pe puncte și pe zone din linia de comandă
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

## Licență

© 2026 Moldova Vrea Infrastructură și Moldova Vrea Autostradă. Toate drepturile rezervate. Detalii și excepții (componente terțe) în [LICENSE](LICENSE).
