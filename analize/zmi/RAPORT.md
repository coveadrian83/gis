# Prima centură a Iașului – bugete, execuție și investiții 2020–2026

*Situație la 25 noiembrie 2026. Datele de execuție pentru 2026 acoperă ianuarie–iulie.*

Fișiere însoțitoare:
- `zmi_ani.csv` – un rând pe comună și an: bugetul aprobat final, veniturile, plățile, rata de execuție, investițiile,
  finanțarea externă, împrumuturile și valorile pe locuitor;
- `zmi_investitii_domenii.csv` – investițiile pe comună, an și domeniu;
- `scripts/zmi_transparenta.py` – scriptul care regenerează cele două fișiere.

## Ce comune și ce surse

**Comunele.** „Prima centură” cuprinde aici cele 10 comune incluse în transportul public metropolitan al CTP Iași:
Aroneanu, Bârnova, Ciurea, Holboca, Miroslava, Popricani, Rediu, Tomești, Țuțora și Valea Lupului (lista din studiul
de oportunitate aprobat de comune în 2022, de exemplu HCL Bârnova 148/2022). Zona Metropolitană Iași are mai mulți
membri (Lețcani, Schitu Duca, Ungheni, Victoria etc.). Aceștia se pot adăuga ușor: scriptul ia comunele dintr-o listă.

**Sursa cifrelor.** Execuția bugetară raportată de primării în sistemul Forexebug al Ministerului Finanțelor, publicată
de [transparenta.eu](https://transparenta.eu). Pentru Bârnova, aceste date coincid la leu cu conturile de execuție
aprobate prin HCL în 2021–2024 (vezi `analize/barnova`). Din aceeași sursă provine bugetul aprobat final (credite
bugetare, din raportările de angajamente): pentru Bârnova 2026 dă 34,09 mil. lei, iar HCL 59/2026 dă 34,088 mil. lei.

**Definiții**
- **Buget aprobat** = creditele bugetare finale ale anului, după rectificări. Nu e bugetul inițial votat în ianuarie–mai.
- **Execuție** = plăți / buget aprobat final.
- **Investiții** = plăți pe titlurile 71 (active nefinanciare), 56, 58, 60 și 61 (proiecte cu fonduri UE, PNRR și
  cadrul 2021–2027). Titlurile 56–61 pot cuprinde și cheltuieli curente ale proiectelor (de exemplu proiecte sociale POCU).
- **Finanțare externă a investițiilor** = veniturile din Anghel Saligny (42.87), PNDL (42.65), PNRR (42.88, granturi;
  42.89, componenta de împrumut), AFIR/AFM/Fondul pentru modernizare (43.31, 43.44, 43.47, 43.50), consolidare seismică
  și locuințe (42.10, 42.55) și fonduri UE (45, 48).
- **Împrumuturi** = sume trase din credite interne (41.02).
- **Investiții din resurse locale** = investiții − finanțare externă − împrumuturi. E o estimare: banii pot intra
  într-un an și pot fi cheltuiți în altul, așa că estimarea e mai sigură pe toată perioada decât pe un singur an.
- **Pe locuitor** = împărțit la populația de la recensământul din 2021. Comunele care au crescut repede de atunci
  (Miroslava, Valea Lupului, Bârnova, Rediu) au, în realitate, valori pe locuitor mai mici decât cele de aici.

---

## 1. Bugetele aprobate (buget final, milioane lei)

| Comună | Pop. 2021 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 | 2026 pe locuitor |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Miroslava | 28.534 | 80,9 | 87,6 | 75,7 | 124,6 | 210,0 | 251,0 | **295,1** | 10.345 lei |
| Tomești | 12.169 | 29,9 | 31,6 | 33,1 | 113,1 | 155,2 | 174,8 | 173,5 | 14.264 lei |
| Ciurea | 17.254 | 70,8 | 75,4 | 64,9 | 69,4 | 108,8 | 139,4 | 132,7 | 7.693 lei |
| Valea Lupului | 14.510 | 19,6 | 27,8 | 33,5 | 61,1 | 129,1 | 127,0 | 121,5 | 8.375 lei |
| Rediu | 8.295 | 14,6 | 19,7 | 20,1 | 20,0 | 40,8 | 91,3 | 90,8 | 10.954 lei |
| Aroneanu | 4.338 | 13,3 | 13,1 | 12,4 | 29,7 | 40,8 | 80,6 | 85,2 | **19.647 lei** |
| Holboca | 13.697 | 36,4 | 35,2 | 39,7 | 49,9 | 110,0 | 74,4 | 71,6 | 5.232 lei |
| Bârnova | 7.913 | 13,9 | 13,2 | 18,4 | 23,5 | 39,4 | 36,0 | 34,0 | **4.308 lei** |
| Popricani | 7.236 | 24,1 | 28,0 | 25,9 | 26,5 | 48,6 | 38,7 | 27,7 | 3.840 lei |
| Țuțora | 2.063 | 4,0 | 7,2 | 10,3 | 9,8 | 37,2 | 31,2 | 10,9 | 5.286 lei |
| **Total** | 116.009 | **308** | **339** | **335** | **528** | **921** | **1.045** | **1.044** | 9.000 lei |

Bugetele aprobate s-au mai mult decât triplat între 2020 și 2025. Saltul vine din 2023–2024, odată cu Anghel Saligny
și PNRR. Bârnova e la coada clasamentului pe locuitor, cu 4.308 lei în 2026. Doar Popricani are mai puțin.

## 2. Execuția: cât s-a plătit din bugetul aprobat

| Comună | Plăți 2020–2025 (mil. lei) | Plăți pe locuitor, medie anuală | Execuție medie 2020–2025 | Execuție 2025 | Plăți ian.–iul. 2026 (mil. lei) |
|---|---:|---:|---:|---:|---:|
| Miroslava | 610,3 | 3.565 lei | 74 % | 70 % | 129,6 |
| Ciurea | 353,3 | 3.413 lei | 67 % | 72 % | 39,4 |
| Tomești | 265,2 | 3.632 lei | **49 %** | 44 % | 36,6 |
| Holboca | 264,1 | 3.213 lei | 76 % | 79 % | 35,6 |
| Valea Lupului | 198,1 | 2.276 lei | 50 % | 53 % | 57,2 |
| Popricani | 156,1 | 3.595 lei | 81 % | 105 % ¹ | 11,5 |
| Aroneanu | 117,5 | 4.514 lei | 62 % | 56 % | 25,5 |
| Bârnova | 103,8 | 2.186 lei | 72 % | 69 % | 9,5 |
| Rediu | 99,8 | **2.006 lei** | **48 %** | 38 % | 21,3 |
| Țuțora | 87,9 | **7.101 lei** | **88 %** | 86 % | 6,2 |

¹ Plățile depășesc creditele din raportarea de angajamente. Cele două raportări nu acoperă exact aceleași cheltuieli,
deci procentul de peste 100 % trebuie citit cu rezervă.

Ce se vede:
- **Bugete umflate față de ce se poate plăti.** Tomești, Rediu și Valea Lupului au plătit doar în jur de jumătate din
  bugetul aprobat. Tomești a avut buget de 113–175 mil. lei pe an între 2023 și 2026, dar a plătit 37–76 mil. lei.
  Explicația obișnuită: în buget se înscrie întreaga valoare a proiectelor cu finanțare externă, iar plățile urmează
  ritmul șantierelor și al decontărilor.
- **Țuțora** are cea mai mare execuție (88 %). Are și cea mai mare cheltuială pe locuitor, datorită unui proiect mare
  de locuințe (27,4 mil. lei pe capitolul „Locuințe”) la o populație de doar 2.063 de locuitori.
- **Bârnova și Rediu** cheltuiesc cel mai puțin pe locuitor (2.000–2.200 lei pe an).

## 3. Investițiile

| Comună | Investiții 2020–iul. 2026 (mil. lei) | pe locuitor | Finanțare externă | Împrumuturi | Din resurse locale (estimat) | Partea locală |
|---|---:|---:|---:|---:|---:|---:|
| Miroslava | 359,9 | 12.612 lei | 172,8 | **109,0** | 78,1 | 22 % |
| Ciurea | 189,8 | 11.001 lei | 143,3 | 8,7 | 37,8 | 20 % |
| Tomești | 150,2 | 12.343 lei | 100,1 | 15,5 | 34,7 | 23 % |
| Holboca | 148,5 | 10.841 lei | 104,4 | 4,9 | 39,1 | 26 % |
| Valea Lupului | 122,9 | 8.468 lei | 52,0 | 19,2 | 51,7 | **42 %** |
| Popricani | 81,0 | 11.197 lei | 54,3 | 7,0 | 19,7 | 24 % |
| Aroneanu | 78,7 | **18.152 lei** | 54,9 | 18,8 | 5,1 | 6 % |
| Țuțora | 58,1 | **28.167 lei** | 44,9 | 0,0 | 13,2 | 23 % |
| Rediu | 34,4 | 4.148 lei | 12,2 | 0,0 | 22,2 | **65 %** |
| Bârnova | 28,4 | **3.589 lei** | 15,6 | 0,1 | 12,7 | 45 % |
| **Total** | **1.251,9** | 10.792 lei | 754,5 | 183,2 | 314,3 | 25 % |

Investițiile pe ani, toate cele 10 comune (mil. lei): 92 (2020), 111 (2021), 105 (2022), 109 (2023), **275 (2024)**,
**364 (2025)** și 196 (ianuarie–iulie 2026).

Concluzii:
- **Trei sferturi din investiții au venit din bani externi sau din împrumuturi.** Anghel Saligny, PNRR, PNDL, AFM și
  fondurile UE au acoperit circa 60 %, iar împrumuturile încă 15 %. Doar circa un sfert (314 mil. lei) pare plătit
  din resursele proprii ale comunelor.
- **Miroslava s-a împrumutat masiv:** 109 mil. lei trase din credite, cât toate celelalte nouă comune la un loc.
  În 2024 a plătit 21,6 mil. lei rambursări, din care o parte e refinanțare.
- **Bârnova a investit cel mai puțin pe locuitor din toată centura:** 3.589 lei, de 3 ori sub media de 10.792 lei.
  Rediu e pe penultimul loc. Aroneanu și Țuțora, comune mici, au valori mari pe locuitor datorită câtorva proiecte
  finanțate extern.
- **Valea Lupului și Rediu au finanțat din resurse proprii cea mai mare parte a investițiilor**, dar cu sume totale
  foarte diferite.

## 4. Ce s-a investit, pe domenii (2020 – iulie 2026)

Domeniile vin din clasificația funcțională a plăților de investiții.

| Domeniu | Total 10 comune (mil. lei) | Pondere |
|---|---:|---:|
| Dezvoltare comunală – nedetaliat (70.50) ² | 301,0 | 24 % |
| **Educație** (grădinițe, școli, inclusiv „școli verzi”) | 277,8 | 22 % |
| **Drumuri și transport** | 263,2 | 21 % |
| **Apă, canalizare, gaz, salubritate** | 205,2 | 16 % |
| Locuințe | 58,2 | 5 % |
| **Social și sănătate** (centre de zi, asistență vârstnici) | 44,8 | 4 % |
| Administrație și siguranță (primării, poliție locală, ISU/SVSU) | 34,2 | 3 % |
| Iluminat public | 25,2 | 2 % |
| **Sport și tineret** | 22,5 | 2 % |
| **Cultură, parcuri, recreere** (cămine culturale, parcuri, locuri de joacă) | 19,7 | 2 % |

² Capitolul 70.50 („alte servicii în domeniile locuințelor și dezvoltării comunale”) e un capitol-sac. Comunele trec
acolo proiecte foarte diferite: rețele, drumuri, parcuri, parcuri fotovoltaice, sisteme de supraveghere. Nu se poate
împărți fără listele de investiții ale fiecărei comune.

Pe comune (mil. lei):

| Comună | Educație | Drumuri | Apă, canal, gaz | Dezv. comunală 70.50 | Locuințe | Social | Sport | Cultură, parcuri | Iluminat | Admin. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Miroslava | **89,4** | **74,5** | 5,6 | **132,9** | 0 | **22,1** | **13,3** | 5,7 | 7,0 | 9,4 |
| Ciurea | 34,4 | 9,6 | 28,0 | 68,4 | **29,1** | 13,5 | 1,9 | 0,2 | 0,5 | 4,2 |
| Holboca | 40,7 | 34,7 | 32,4 | 28,7 | 0 | 0,2 | 2,6 | 4,9 | 3,1 | 1,1 |
| Tomești | 18,4 | 20,1 | 32,0 | 55,7 | 0 | 5,1 | 0 | 7,4 | 5,1 | 6,5 |
| Valea Lupului | **69,0** | 37,2 | 1,4 | 0 | 1,7 | 0 | 2,1 | 0,1 | 3,1 | 8,1 |
| Popricani | 5,2 | 18,0 | **49,0** | 2,9 | 0 | 1,7 | 0,8 | 0,1 | 1,9 | 1,1 |
| Aroneanu | 7,4 | 24,5 | **35,4** | 3,0 | 0 | 2,2 | 1,0 | 0,7 | 3,1 | 1,5 |
| Țuțora | 1,8 | 11,8 | 15,0 | 0,2 | **27,4** | 0 | 0 | 0,4 | 1,0 | 0,7 |
| Rediu | 9,4 | 18,1 | 3,0 | 1,6 | 0 | 0 | 0,8 | 0 | 0,1 | 1,4 |
| Bârnova | 2,1 | 14,7 | 3,3 | 7,8 | 0 | 0 | 0 | 0 | 0,3 | 0,2 |

Profilul comunelor:
- **Miroslava** investește în toate domeniile și are cele mai mari sume pentru educație, sport și social.
- **Valea Lupului** a pus accentul pe educație: 56 % din investiții (școală nouă, grădiniță).
- **Popricani și Aroneanu** au investit mai ales în apă, canalizare și gaz.
- **Țuțora și Ciurea** au proiecte de locuințe.
- **Bârnova** a investit aproape doar în drumuri (52 %). Pentru educație a plătit 2,1 mil. lei, iar pentru sport,
  social sau cultură practic nimic.

## 5. Proiecte semnalate în presă (de verificat cu SEAP și HCL)

Sumele din presă sunt de obicei valori de contract sau de proiect, nu plăți. Unele articole dau sume cu TVA, altele fără.

- **Miroslava:** „Școala verde” din Valea Adâncă, 21 de săli, PNRR, circa 32,9 mil. lei, cu deschidere anunțată pentru
  septembrie 2026 ([BZI](https://www.bzi.ro/lucrarile-de-la-scoala-verde-din-miroslava-se-apropie-de-final-noua-unitate-de-invatamant-isi-va-deschide-portile-in-septembrie-2026-5489600));
  grădinița din Valea Ursului, circa 12,4 mil. lei ([BZI](https://www.bzi.ro/investitie-de-peste-12-milioane-de-lei-in-comuna-miroslava-primaria-va-construi-o-gradinita-in-satul-valea-ursului-5557520));
  centru multifuncțional sportiv și cultural de peste 25 mil. lei ([BZI](https://www.bzi.ro/primaria-miroslava-pregateste-o-noua-investitie-de-peste-25-de-milioane-de-lei-va-fi-construit-un-centru-multifunctional-cu-dotari-sportive-si-culturale-pentru-copii-5451293));
  acord-cadru pentru drumuri locale, de peste 4,7 mil. euro ([BZI](https://www.bzi.ro/o-noua-investitie-este-anuntata-in-comuna-miroslava-primaria-pregateste-un-proiect-de-peste-47-milioane-de-euro-pentru-modernizarea-infrastructurii-rutiere-5431049)).
- **Valea Lupului:** școală nouă, contract de circa 9,4 mil. euro atribuit unui consorțiu de 13 firme ([BZI](https://www.bzi.ro/primaria-valea-lupului-investitie-de-peste-94-milioane-de-euro-in-invatamant-o-noua-scoala-va-fi-construita-contractul-va-fi-realizat-de-un-consortiu-format-din-13-firme-5253398));
  grădiniță cu program prelungit pentru circa 250 de copii, deschisă în 2025 ([BZI](https://www.bzi.ro/gradinita-cu-program-prelungit-noua-la-valea-lupului-de-luni-cei-250-de-copii-pasesc-in-clase-moderne-5390014));
  21–22 de drumuri prin Anghel Saligny, circa 15,8 mil. lei ([BZI](https://www.bzi.ro/drumurile-din-comuna-valea-lupului-vor-fi-modernizate-valoarea-proiectului-depaseste-15-milioane-de-lei-foto-4744887));
  supraveghere video (237 de camere) și stații de încărcare, 21 mil. lei ([BZI](https://www.bzi.ro/proiect-in-valoare-de-21-milioane-de-lei-implementat-in-comuna-valea-lupului-au-fost-instalate-237-de-camere-de-supraveghere-si-2-statii-de-incarcare-5571132)).
- **Tomești:** 11 proiecte în execuție, de circa 15,7 mil. euro (2024) ([BZI](https://www.bzi.ro/comuna-tomesti-are-in-executie-proiecte-in-valoare-de-15-728-894-de-euro-iata-cand-vor-fi-finalizate-lucrarile-5035011));
  bază sportivă pentru copii, peste 7 mil. lei ([BZI](https://www.bzi.ro/in-comuna-tomesti-va-fi-construita-o-baza-sportiva-pentru-copii-primaria-cauta-firme-pentru-realizarea-proiectului-care-valoreaza-peste-7-000-000-de-lei-5071664));
  creșă, peste 7 mil. lei ([BZI](https://www.bzi.ro/o-cresa-moderna-cu-panouri-fotovoltaice-si-spatii-de-joaca-pentru-40-de-copii-va-fi-construita-la-tomesti-investitia-depaseste-7-milioane-de-lei-5531362));
  parc fotovoltaic, peste 16 mil. lei ([BZI](https://www.bzi.ro/trei-firme-vor-sa-semneze-contractul-de-peste-16-milioane-de-lei-din-comuna-tomesti-proiectul-prevede-infiintarea-unui-parc-fotovoltaic-5276814)).
- **Holboca:** liceu reconstruit, peste 17 mil. lei ([BZI](https://www.bzi.ro/patru-firme-vor-sa-construiasca-un-liceu-in-comuna-holboca-lucrarile-au-o-valoare-de-peste-17-milioane-de-lei-5517968));
  extinderea iluminatului stradal ([BZI](https://www.bzi.ro/incep-lucrarile-de-extindere-a-iluminatului-stradal-din-holboca-neculai-pamfil-avem-licitatia-adjudecata-si-contractul-de-executie-semnat-5514165));
  parc fotovoltaic de peste 25 mil. lei ([BZI](https://www.bzi.ro/o-comuna-din-iasi-va-deveni-independenta-energetic-primaria-cheltuie-peste-25-milioane-de-lei-pentru-realizarea-proiectului-5363581)).
- **Ciurea:** extinderea canalizării în Curături, Lunca Cetățuii și Hlincea, circa 23,4 mil. lei fără TVA ([BZI](https://www.bzi.ro/intr-o-comuna-de-langa-iasi-va-fi-extinsa-reteaua-de-canalizare-primaria-plateste-peste-4-milioane-de-euro-pentru-realizarea-proiectului-5514161));
  asfaltarea unei străzi, 1,74 mil. lei fără TVA ([BZI](https://www.bzi.ro/trei-firme-de-constructii-vor-contractul-de-asfaltare-a-unei-strazi-din-comuna-ciurea-proiectul-depaseste-1-700-000-de-lei-5061222)).
- **Rediu:** „Școală verde”, licitație de peste 3,9 mil. euro ([BZI](https://www.bzi.ro/licitatie-de-peste-39-milioane-de-euro-intr-o-comuna-din-iasi-primaria-cauta-firme-pentru-construirea-unei-scoli-verzi-5184378));
  acord-cadru pentru trotuare, circa 16 km ([BZI](https://www.bzi.ro/primaria-amenajeaza-noi-trotuare-in-comuna-rediu-din-judetul-iasi-proiectul-depaseste-18-milioane-de-euro-5327853));
  extinderea canalizării, peste 4 mil. lei ([BZI](https://www.bzi.ro/zece-firme-se-intrec-in-oferte-pentru-un-contract-banos-in-comuna-rediu-proiectul-prevede-extinderea-retelei-de-canalizare-si-depaseste-4-milioane-de-lei-5271771)).
- **Popricani:** canalizare prin Anghel Saligny, circa 3 mil. euro ([BZI](https://www.bzi.ro/o-comuna-de-langa-municipiului-iasi-va-avea-retea-de-canalizare-investitia-este-de-3-milioane-de-euro-foto-4752196));
  extinderea sistemului de apă și canal cu ApaVital, peste 56 mil. lei ([BZI](https://www.bzi.ro/contract-de-peste-56-milioane-de-lei-in-comuna-popricani-apavital-isi-va-extinde-sistemul-de-apa-si-canalizare-in-localitate-4427977)).
- **Aroneanu:** modernizare de drumuri, peste 6 mil. lei ([BZI](https://www.bzi.ro/primaria-aroneanu-cheltuie-peste-6-milioane-de-lei-pentru-modernizarea-drumurilor-din-localitate-procedura-de-licitatie-a-fost-lansata-pe-seap-5095331));
  rețeaua de gaze Transgaz ([BZI](https://www.bzi.ro/transgaz-lanseaza-licitatia-pentru-infiintarea-retelei-de-gaze-naturale-in-aroneanu-cand-vor-avea-locuitorii-gaz-metan-4552721)).
- **Țuțora:** drumuri prin Compania Națională de Investiții, circa 0,4 mil. euro ([BZI](https://www.bzi.ro/drumurile-distruse-din-comuna-tutora-vor-fi-reabilitate-cu-fonduri-de-la-compania-nationala-de-investitii-contractul-are-o-valoare-de-400-000-de-euro-4133547)).
  Proiectul de locuințe (27,4 mil. lei plătiți) nu apare în presa găsită: de verificat.

Presa găsită vine aproape toată de la un singur ziar local (BZI). Nu am găsit comparații de bugete pe locuitor între
comune publicate în presă: cifrele din această analiză sunt calculate aici.

## Limite și pași următori

1. **Populația.** Recensământul din 2021 subestimează populația actuală a comunelor care cresc repede. Pentru valori pe
   locuitor mai corecte e nevoie de populația după domiciliu pe ani (INS, TEMPO POP107D), pe care n-am putut-o descărca aici.
2. **Investiții, nu proiecte finalizate.** Cifrele sunt plăți pe investiții. Un proiect plătit nu înseamnă neapărat
   recepționat. Pentru „ce s-a materializat” concret e nevoie de listele de investiții anexate bugetelor și de
   recepțiile din fiecare comună.
3. **Capitolul 70.50** (un sfert din investiții) trebuie desfăcut pe proiecte din listele de investiții ale comunelor.
4. **Bugetul aprobat** e cel final, nu cel inițial. Pentru bugetele inițiale trebuie citite HCL-urile fiecărei comune,
   cum am făcut pentru Bârnova.
