# Metodologia aplicației Mobilitate Iași – MVA × MVI
## Prototip v0.4.5

### 1. Rolul prototipului
Versiunea v0.4.5 este un prototip funcțional pentru testarea fluxului de raportare a unei deplasări Origine–Destinație în Municipiul Iași și Zona Metropolitană Iași. Scopul său este validarea experienței de utilizare, a logicii geografice, a căutării și a structurii minime de date înainte de implementarea backendului central și a dashboardului de administrare.

În această versiune datele introduse de utilizator se păstrează numai în browserul local, prin localStorage. Nu există încă bază de date centrală și prototipul nu trebuie utilizat pentru colectarea publică oficială a studiului.

### 2. Unitatea de observație
Unitatea de observație este deplasarea efectiv realizată între o origine și o destinație principală.

O persoană poate raporta mai multe deplasări. Repetarea aceleiași relații în zile diferite este utilă pentru analiza variabilității timpilor și nu reprezintă duplicare.

### 3. Fluxul utilizatorului
Aplicația este împărțită în 3 pași:
1. Origine și destinație;
2. Data, ora plecării și ora sosirii;
3. Mod de transport, scop și caracter recurent/ocazional.

Bara de progres arată permanent Pasul 1/3, 2/3 sau 3/3.

Butonul „CONTINUĂ LA PASUL 2” rămâne dezactivat până când atât originea, cât și destinația sunt selectate.

### 4. Harta
Harta utilizează Leaflet 1.9.4 și OpenStreetMap ca hartă de bază.

Navigarea permite:
- zoom + / -;
- zoom cu rotița mouse-ului;
- dublu-click;
- pinch pe telefon;
- Pan;
- „Încadrează ZMI”;
- „Centrează pe Iași”.

Straturile analitice sunt separate de harta de bază, pentru ca proiectul să poată fi extins ulterior.

### 5. Modelul geografic
Sunt utilizate două niveluri principale:
- 28 UAT-uri ale Zonei Metropolitane Iași, selectate din stratul ANCPI;
- 17 zone de analiză MVA–MVI în Municipiul Iași.

Pentru UAT sunt păstrate codurile SIRUTA.

Cele 17 zone urbane sunt:
- IAS-Z01 Bularga – Zona Industrială
- IAS-Z02 Aviației
- IAS-Z03 Moara de Vânt
- IAS-Z04 Țicău – Sărărie
- IAS-Z05 Copou
- IAS-Z06 Dacia
- IAS-Z07 Păcurari
- IAS-Z08 Galata – Mircea
- IAS-Z09 CUG
- IAS-Z10 Bucium
- IAS-Z11 Nicolina
- IAS-Z12 Frumoasa
- IAS-Z13 Alexandru cel Bun
- IAS-Z14 Cantemir – Socola
- IAS-Z15 Centru
- IAS-Z16 Studențesc
- IAS-Z17 Tătărași

Poligoanele UNNAMED din stratul sursă au fost armonizate astfel:
- UNNAMED_2 → Aviației
- UNNAMED_4 → Moara de Vânt
- UNNAMED_7 → Copou
- UNNAMED_8 → Dacia
- UNNAMED_13 → Frumoasa

Stratul sursă nu este modificat; armonizarea este un nivel analitic.

### 6. Localitățile SIRUTA
Aplicația conține un nomenclator SIRUTA 2025 pentru localitățile componente ale UAT-urilor ZMI.

Exemple:
- Vișan → UAT Bârnova;
- Păun → UAT Bârnova;
- Dancu → UAT Holboca;
- Valea Adâncă → UAT Miroslava;
- Breazu → UAT Rediu.

Căutarea este tolerantă la lipsa diacriticelor.

Important: arhiva ANCPI utilizată conține limite UAT, nu poligoane de localitate/sat. Din acest motiv, identitatea SIRUTA este sigură atunci când utilizatorul alege localitatea din listă, dar markerul poate avea nevoie de geocodare externă pentru poziționarea exactă.

### 7. Regula v0.4.5 pentru localități
Începând cu v0.4.5, alegerea unei localități din nomenclator o validează imediat.

Exemplu:
Păun, Bârnova – SIRUTA 95113

devine imediat origine/destinație validă în aplicație.

OpenStreetMap/Nominatim este folosit numai pentru rafinarea poziției markerului. Dacă geocodarea nu răspunde, aplicația plasează provizoriu markerul la centrul UAT-ului, dar identitatea analitică rămâne localitatea SIRUTA selectată.

Acest fallback este vizual și nu modifică identitatea statistică a observației.

### 8. Repere
Versiunea v0.4.5 conține local o listă minimă de repere frecvente:
- Gara Iași;
- Palas Iași;
- Universitatea „Alexandru Ioan Cuza” din Iași;
- Universitatea Tehnică „Gheorghe Asachi” din Iași.

Reperele sunt ajutoare de căutare și nu constituie zone statistice distincte. După selectare, punctul este clasificat geografic în UAT și/sau zonă MVA–MVI.

În producție, nomenclatorul de repere trebuie extins.

### 9. Ordinea căutării
Ordinea logică a căutării este:
1. repere locale MVA–MVI;
2. localități SIRUTA;
3. cele 17 zone de analiză din Municipiul Iași;
4. fallback OpenStreetMap/Nominatim pentru străzi și alte repere.

Această ordine reduce dependența de servicii externe pentru căutările uzuale.

### 10. Selecția pe hartă
Utilizatorul poate selecta direct un punct pe hartă.

La click:
- se determină UAT-ul prin point-in-polygon;
- dacă punctul este în Municipiul Iași, se determină și zona MVA–MVI;
- punctele din afara ZMI sunt acceptate și marcate ca exterior ZMI.

Butoanele „Schimbă originea pe hartă”, „Schimbă destinația pe hartă”, „Șterge” și „Reia O/D” permit corectarea selecțiilor.

### 11. Câmpurile colectate în prototip
Câmpurile principale sunt:
- trip_id;
- participant_id pseudonim;
- trip_date;
- departure_time;
- arrival_time;
- duration_min;
- origin;
- destination;
- mode;
- purpose;
- repeat_type;
- submitted_at;
- geometry_version;
- validation_status.

Pentru autoturism sunt prevăzute rolul șofer/pasager și gradul de ocupare.
Pentru transport public este prevăzută linia utilizată, opțional.

### 12. Participant pseudonim
La prima utilizare browserul generează un identificator aleator persistent în localStorage.

Acest ID permite diferențierea între numărul de deplasări și numărul de contributori fără solicitarea numelui, e-mailului sau telefonului.

În versiunea de producție, acest mecanism trebuie analizat împreună cu politica de confidențialitate și retenție.

### 13. Stocarea în v0.4.5
Versiunea actuală nu are backend.

Datele sunt salvate local în browser folosind localStorage, cu rol exclusiv demonstrativ.

Prin urmare:
- datele nu ajung la MVI/MVA;
- deschiderea aplicației pe alt dispozitiv nu afișează datele anterioare;
- ștergerea datelor browserului poate elimina înregistrările;
- prototipul nu trebuie încă folosit ca instrument oficial de colectare publică.

### 14. Reguli de validare
În prototip există un status inițial VALID, însă sistemul complet VALID/CHECK/EXCLUDE este prevăzut pentru backend.

Metodologia finală va utiliza:
- VALID – observație coerentă;
- CHECK – observație posibilă, dar neobișnuită;
- EXCLUDE – duplicat cert sau eroare evidentă.

Valorile extreme nu trebuie eliminate automat doar pentru că sunt extreme.

### 15. Indicatorii finali prevăzuți
Pentru fiecare relație O–D se vor calcula, unde volumul permite:
- N deplasări;
- N participanți;
- N zile;
- mediană;
- medie;
- P25;
- P75;
- P90;
- P90 – mediană;
- distribuția pe intervale de plecare;
- moduri de transport;
- scopuri;
- recurent/ocazional;
- ocupare auto;
- linii de transport public raportate.

### 16. Eșantionarea
Studiul folosește un eșantion deschis, voluntar și autoselectat.

Rezultatele nu vor fi prezentate ca reprezentative statistic pentru întreaga populație a Zonei Metropolitane Iași.

Datele descriu deplasările raportate și trebuie interpretate în funcție de N deplasări, N participanți și N zile.

### 17. Perioada studiului
Perioada propusă:
1 octombrie 2026 – 30 aprilie 2027.

Sunt prevăzute analize separate pentru perioade speciale, inclusiv Sărbătorile Iașului.

### 18. Protecția datelor
Principiile stabilite pentru versiunea finală sunt:
- minimizarea datelor;
- fără nume, e-mail sau telefon în formularul principal;
- publicare numai agregată;
- separarea datelor brute de datele de analiză;
- coordonatele precise trebuie păstrate numai dacă sunt metodologic necesare;
- politica de retenție și informarea GDPR trebuie finalizate înainte de lansarea publică.

### 19. Limitările v0.4.5
Versiunea v0.4.5 este de test.

Nu sunt încă implementate:
- backend central;
- bază de date PostgreSQL/PostGIS;
- autentificare administrator;
- dashboard;
- validare CHECK/EXCLUDE;
- export centralizat;
- limite poligonale pentru fiecare sat/localitate;
- politica finală GDPR;
- serviciu de geocodare de producție.

### 20. Scopul testării pe site
Testarea pe un server HTTP/HTTPS trebuie să verifice:
- încărcarea OpenStreetMap;
- încărcarea Leaflet;
- navigarea pe hartă;
- căutarea fără diacritice;
- selecția unei localități SIRUTA;
- selecția unui reper;
- activarea butonului de continuare;
- trecerea prin cei 3 pași;
- calculul duratei;
- comportamentul pe telefon;
- comportamentul în Chrome, Edge, Firefox și Safari, dacă este posibil.

Versiunea v0.4.5 trebuie privită ca staging funcțional, nu ca versiune de producție.
