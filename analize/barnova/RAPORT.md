# Comuna Bârnova – analiza hotărârilor Consiliului Local, 2020 – 2026

*Situație la 5 noiembrie 2026. Sursa principală: Monitorul Oficial Local, [emol.ro/barnova-is](https://emol.ro/barnova-is/registru-hcl/)
(1.014 hotărâri: 157 în 2020, 116 în 2021, 156 în 2022, 133 în 2023, 162 în 2024, 172 în 2025, 118 în 2026 până la HCL 118/28.10.2026).*

Fișiere însoțitoare:
- `hcl_2020_2026.csv` – toate hotărârile, cu categorie, sat (detectat automat) și link către hotărâre;
- `bugete_2020_2026.csv` – bugetul aprobat și cel executat, pe ani;
- `scripts/barnova_hcl.py` – scriptul care regenerează lista din registrul eMOL.

**Ce surse am folosit și unde sunt limite**
- Textele hotărârilor sunt descărcate din eMOL (PDF generat de platformă). Anexele nu sunt publicate pe eMOL:
  lipsesc listele de străzi din proiectele Anghel Saligny, devizele și planșele PUZ.
- Bugetul **2020** (HCL 17/2020) și bugetul **2026** (anexa la HCL 59/2026) nu au text pe eMOL. Le-am luat din PDF-urile
  scanate de pe [primariabarnova.ro/…/buget](https://primariabarnova.ro/primaria-comunei-birnova/buget/) și le-am citit prin OCR.
  Totalurile se verifică între ele (venituri + excedent = cheltuieli).
- **Contul de execuție pe 2025 nu a fost adoptat sau nu e publicat** pe eMOL (în 2026 apar doar indicatorii T4 2025,
  HCL 28/2026, și situațiile financiare, HCL 29/2026, fără anexe). Pentru 2025 și pentru 2026 până în iulie am folosit
  datele de execuție din Forexebug, preluate de [transparenta.eu](https://transparenta.eu) (CUI 4540690). Pentru 2021–2024
  aceste date coincid la leu cu conturile de execuție aprobate prin HCL, deci sursa e sigură.
- „Satul” unui PUZ apare doar dacă hotărârea îl scrie. Multe hotărâri dau doar numărul cadastral.

---

## 1. Bugetele aprobate (bugetul inițial, mii lei)

| An | HCL | Venituri | Excedent folosit | **Total cheltuieli** | Funcționare | Investiții (dezvoltare) | Cap. 84.02 Drumuri |
|---|---|---:|---:|---:|---:|---:|---:|
| 2020 | 17 / 19.02.2020 | 11.959,10 | 616,40 | **12.575,50** | 9.090,05 | 3.485,45 | 2.029,70 |
| 2021 | 36 / 21.04.2021 | 11.735,90 | 240,80 | **11.976,70** | 10.569,03 | 1.407,67 | 2.022,17 |
| 2022 | 23 / 11.02.2022 ¹ | 14.061,57 | 2.435,80 | **16.497,37** | 12.147,40 | 4.349,97 | 4.389,97 |
| 2023 | 15 / 02.02.2023 | 19.335,01 | 2.792,00 | **22.127,01** | 14.242,01 | 7.885,00 | 3.051,00 |
| 2024 | 11 / 12.02.2024 | 31.592,00 | 5.006,00 | **36.598,00** | 15.898,00 | 20.700,00 | 15.949,00 |
| 2025 | 30 / 21.03.2025 | 26.235,00 | 6.120,58 | **32.355,58** | 18.106,18 | 14.249,40 | 7.852,00 |
| 2026 | 59 / 08.05.2026 | 29.265,18 | 4.823,00 | **34.088,18** | 18.525,18 | 15.563,00 | 9.771,00 |

¹ Completat prin HCL 37/31.03.2022 (anexă suplimentară: +269 mii lei din cote TVA pentru învățământ).

Observații:
- Bugetul inițial aproape s-a triplat (de la 12,6 la 34,1 milioane lei). Creșterea vine mai ales din investițiile cu
  finanțare externă (Anghel Saligny, PNRR, AFM). Fondurile nerambursabile prevăzute au fost 4,3 milioane lei în 2023,
  15,1 milioane în 2024, 8,4–8,7 milioane în 2025 și 6,7 milioane în 2026.
- Bugetul s-a aprobat târziu în 2021 (aprilie), 2025 (martie) și 2026 (mai). Până atunci comuna a funcționat pe bugetul
  previzionat (HCL 144/2020, 112/2021, 146/2022, 116/2023).
- Rectificări de buget (modificări sau suplimentări aprobate prin HCL): circa 10 în 2020, 9 în 2021, 9 în 2022,
  8 în 2023, 9 în 2024, 6 în 2025 și 4 în 2026 până acum. Lista e în CSV, categoria `buget_rectificare`.
- La bugetul 2026 s-au votat amendamente: +200.000 lei pentru drumuri (etapa 2, inclusiv str. Gutuiului), mutați
  din etapa 3; 500.000 lei mutați de la ACOR la grădinița din Vișan; 50.000 lei pentru căminul cultural-bibliotecă.
  Votul a fost 13 pentru și 2 împotrivă.

## 2. Bugetele executate la final de an

| An | Sursa | Venituri încasate (lei) | Cheltuieli plătite (lei) | din care investiții | Excedent / deficit al anului | Execuție cheltuieli față de bugetul inițial | Execuție investiții față de plan |
|---|---|---:|---:|---:|---:|---:|---:|
| 2020 | HCL 51/2021 | 12.617.782 ² | 12.376.945 | 3.850.874 | +240.837 | 98 % | 110 % |
| 2021 | HCL 71/2022 | 12.605.288 | 10.410.317 | 734.119 | +2.194.971 ³ | 87 % | 52 % |
| 2022 | HCL 42/2023 | 14.824.499 | 14.468.126 | 974.560 | +356.373 | 88 % | 22 % |
| 2023 | HCL 26/2024 | 17.195.205 | 14.981.278 | 2.693.636 | +2.213.926 | 68 % | 34 % |
| 2024 | HCL 36/2025 | 27.669.430 | 26.554.957 | 11.554.734 | +1.114.473 | 73 % | 56 % |
| 2025 | Forexebug ⁴ | 23.552.535 | 24.850.010 | 7.213.621 | −1.297.475 | 77 % | 51 % |
| 2026 (ian.–iul.) | Forexebug ⁴ | 18.680.031 | 9.524.856 | 417.445 | – | 28 % după 7 luni | 3 % după 7 luni |

² Include 616.400 lei din excedentul anului 2019. Forexebug dă pentru 2020 valori ușor diferite (12,14 milioane lei
încasări și 12,51 milioane plăți), probabil din cauza modului în care e tratat excedentul.
³ Excedentul cumulat raportat la închiderea anului 2021 este de 2.435.808 lei.
⁴ Contul de execuție pe 2025 nu e publicat pe eMOL. Cifra se verifică totuși: excedentul cumulat de 6.120.581 lei,
minus deficitul de 1.297.475 lei din 2025, dă 4.823 mii lei. Exact atât e înscris ca excedent în bugetul 2026.

Ce se vede:
- **Investițiile se realizează sistematic sub plan.** Între 2021 și 2025 s-a plătit în medie cam jumătate din lista de
  investiții aprobată: 22 % în 2022, 34 % în 2023, 51–56 % în 2024–2025. De aici excedentele mari reportate:
  2,4 milioane lei (2021), 2,8 milioane (2022), 5,0 milioane (2023), 6,1 milioane (2024).
- Procentele compară execuția cu **bugetul inițial**, nu cu cel rectificat. Nu am găsit public bugetul final (definitiv)
  pentru fiecare an. Comparația cu bugetul rectificat ar fi mai corectă.
- Anul 2024 e un vârf: s-au plătit 11,6 milioane lei pentru investiții, din care 7,0 milioane lei pentru drumurile din
  programul Anghel Saligny. În 2025 comuna a cheltuit mai mult decât a încasat și a acoperit diferența din excedent.
- Veniturile proprii cresc constant. Impozitele pe proprietate au urcat de la 0,71 milioane lei (2020) la 1,49 milioane (2024).
  Taxa de salubritate și taxele locale au urcat de la 1,31 la 3,45 milioane lei. Cotele defalcate din impozitul pe venit
  au urcat de la 3,0 la 5,6–6,3 milioane lei. Totul reflectă creșterea rapidă a populației (taxa de gunoi e calculată
  pentru 6.450 de persoane în 2021 și pentru 8.479 în 2026).

## 3. Urbanism – PUG, regulament și PUZ-uri (pe localități)

### Documentații generale
| HCL | Ce s-a aprobat |
|---|---|
| **111 / 28.08.2020** | **Actualizarea PUG și a RLU** (proiect 10/2017, SC CAD ON SRL și SC Arhitectis Trust SRL). Teritoriul administrativ are 4.122 ha: 1.784 ha intravilan propus (43 %) și 2.338 ha extravilan. |
| 33 / 31.03.2021 | Completare RLU: locurile de parcare pot fi amplasate în afara incintei, la cel mult 200 m, pe teren propriu sau concesionat. |
| 13 / 28.01.2026 | Modificarea și completarea RLU aferent PUG (anexa nu e publicată). |
| **66 / 08.05.2026** | În PUG/RLU se **interzic locuințele colective** lângă sau în zonele de locuințe individuale. Locuințele colective trebuie să fie la cel puțin 50 m de casele individuale și cer acordul vecinilor. Nu se mai admit derogări prin PUZ/PUD. Se aplică din 2027. |
| 67 / 08.05.2026 | Norme de parcare în RLU: 1 loc pentru apartamentele ≤ 50 mp, 2 locuri peste 50 mp sau la 2+ camere, 5 locuri pentru spațiile comerciale. Autorizația de construire e condiționată de parcarea pe teren propriu. Drumurile și rețelele construite în regim privat trec în domeniul public. |

### PUZ-uri (aviz → aprobare), aproape toate pentru introducere în intravilan
| Sat | Aviz CL | Aprobare CL | Suprafață | Funcțiune / beneficiar |
|---|---|---|---:|---|
| **Vișan** | 10/2021 | **6/2022** | 20.229 mp | locuințe individuale – Toma Călin-Florin |
| **Vișan** | 32/2021 | **32/2022** | 53.274 mp | locuințe individuale – Dăscălescu Șerban, Andronic Ruxandra |
| **Vișan** | 71/2023 | **133/2023** | 23.283 mp | locuințe individuale P+1E **și colective P+3E** – Toma, Paraschiv, Ramadan, Cîrstea, Mihai |
| **Vișan** | 118/2022, 46/2023 | – (doar avizat) | 9.932 mp | locuințe individuale P+E+M – Atomoaie Daniel |
| probabil Vișan ⁵ | 147/2020 | **33/2022** | 64.930 mp | locuințe individuale **și colective** – Soficu Paul, Olărescu |
| nespecificat | – | **5/2020** | 1.548 mp | locuințe **colective** – Pleșca Marian-Dinu |
| nespecificat | – | **6/2020** | 1.719 mp | locuințe individuale – Tărăboanță, Popa |
| nespecificat | – | **19/2020** | 10.000 mp | locuințe – Popescu Strohlen Christian |
| nespecificat | 37/2020 | **94/2020** | 3.979 mp | locuințe individuale – SC Symmoryent SRL |
| nespecificat | 35/2020 | – | 2.525 mp | locuințe – Sturza |
| nespecificat | 36/2020 | – | 577 mp | locuință – SC Stone Real Estate SRL |
| nespecificat | 88/2020 | – | 2.250 mp | sală de evenimente – Vornicu, Băisan |
| nespecificat | – | **34/2021** | 2.205 mp | construcții individuale – Nistor |
| nespecificat (extravilan) | 122/2024 | **19/2025** | 2.475 mp | locuințe duplex – Tamaș |
| nespecificat | 20/2025 | **40/2025** | 5.017 mp | locuințe individuale – Nechifor Vasile |
| nespecificat | 3/2026 | **65/2026** | 6.900 mp | așezământ monahal – Mănăstirea „Sf. Ap. Petru și Pavel” Bărboi |
| nespecificat | 46/2026 | **81/2026** | 2.330 mp | locuințe individuale – Timofte-Zorilă |
| nespecificat | 47/2026 | **57/2026** | 1.000 mp | structuri de primire turistică – Teișanu Andrei |
| nespecificat | 80/2026 | **88/2026** | 28.416 mp | locuințe individuale – SC Symmoryent SRL (nr. cad. 64839) |
| *teritoriul mun. Iași* ⁶ | – | **87/2023** | 5.390 mp | locuințe individuale – Diac, Bădruș, Diaconu, Balașca, Arva |
| *teritoriul mun. Iași* ⁶ | – | **27/2024** | 1.000 mp | 2 locuințe – Ene |

⁵ Hotărârea nu numește satul. Deducția vine din HCL 72/2022: str. Luminii din Vișan e definită „din str. Sf. Ilie spre
proprietatea dlui Soficu Paul”.
⁶ PUZ-uri pentru terenuri „extravilan Municipiul Iași”, aprobate de CL Bârnova. Merită verificat de ce a fost competent
Bârnova (teren la limita UAT-urilor sau o eroare în titlu).

**Pe scurt:** între 2020 și 2026 s-au **aprobat 15 PUZ-uri pe teritoriul comunei, cu circa 22,7 ha introduse în intravilan**:
1,7 ha în 2020, 0,2 ha în 2021, 13,8 ha în 2022, 2,3 ha în 2023, 0,7 ha în 2025 și 3,9 ha în 2026.
- **Vișan concentrează cel puțin 9,7 ha** (aprobate și localizate sigur), plus probabil încă 6,5 ha (PUZ-ul Soficu/Olărescu).
  E satul spre Iași/Ciurea, cu cea mai mare presiune de construire. Tot aici sunt și cele mai multe investiții în trotuare
  și străzi (secțiunea 4).
- **Pentru Bârnova, Cercu, Pietrăria, Păun și Todirel, hotărârile nu localizează niciun PUZ.** Pentru o hartă pe sate
  ar trebui identificate numerele cadastrale în eTerra/ANCPI (geoportal.ancpi.ro nu a fost accesibil din mediul de lucru)
  sau consultate planșele de la primărie.
- Trei PUZ-uri au permis **locuințe colective**: 5/2020, 33/2022 și 133/2023 (P+3E). HCL 66/2026 interzice pe viitor
  astfel de derogări.

## 4. Investiții în infrastructura de transport (drumuri, accese)

### 4.1. Bani pentru drumuri (cap. 84.02 „Transporturi – drumuri și poduri”)
| An | Aprobat inițial (mii lei) | Executat (lei) | din care investiții (lei) | Ce s-a plătit, principal |
|---|---:|---:|---:|---|
| 2020 | 2.029,70 | 2.132.691 | 1.080.872 | finalizarea „Modernizare drumuri sătești – Măsura 7.2” (949.972 lei); asfaltări de întreținere 523.124 lei |
| 2021 | 2.022,17 | 1.287.265 | 176.700 | pietruiri 382.120 lei; plombări/asfalt 449.702 lei; studii pentru drumurile afectate de viituri |
| 2022 | 4.389,97 | 3.434.528 | 620.649 | **asfaltări de întreținere 2.080.953 lei**; asfaltare în Pietrăria 496.250 lei; rigole în Vișan 99.999 lei |
| 2023 | 3.051,00 | 1.707.529 | 998.690 | trotuare în Vișan 301.354 lei; proiectul tehnic Anghel Saligny 233.828 lei; tranșa 1 de asfaltare 463.509 lei |
| 2024 | 15.949,00 | **9.682.288** | **8.348.880** | **Anghel Saligny – 6.973.443 lei**; asfaltare 5.000–6.000 mp 833.434 lei |
| 2025 | 7.852,00 | 4.318.737 | 3.153.775 | restul contractului Anghel Saligny și asfaltări din bugetul local (detaliu pe articole în Forexebug) |
| 2026 | 9.771,00 | 529.374 (ian.–iul.) | 313.742 | în curs |

În total, 2020–2025: **circa 22,6 milioane lei plătite pentru drumuri**, din care circa 14,4 milioane lei investiții.
Ca și la restul bugetului, plățile pentru drumuri au fost în 2021–2025 de doar **55–78 % din suma aprobată inițial**.

### 4.2. Proiecte de drumuri, pe localități
| Localitate | Proiect / hotărâre | Ce conține |
|---|---|---|
| mai multe sate | **„Modernizare drumuri locale în comuna Bârnova” – AFIR, Măsura 7.2** (recepție 27.07.2020; HCL 93/2020, 26/2021) | 11 străzi, **6.097 m asfaltați**, 4.675.287 lei cu TVA: Barnovschi Vodă 647 m, Calea Codrului 1.095 m, Capela Inculeț 736 m, Castelul Grecilor 69 m, Elena Farago 698 m, Grigore Ghica Vodă al II-lea 558 m, Matei Basarab 848 m, Nechita Stănescu 333 m, Nicolae Titulescu 203 m, Regina Maria 458 m, Valea Viilor 452 m |
| toată comuna | **PNI „Anghel Saligny” – „Modernizare drumuri de interes local, cca 7 km”** (cerere HCL 91/2021; DALI HCL 7/2023, RIVA Systems, cofinanțare locală 1.590.525 lei; indicatori actualizați HCL 31/2024, cofinanțare 584.999 lei) | contract de 11.557 mii lei. S-au plătit 6,97 milioane lei în 2024. Rest de executat: 5.450 mii lei în bugetul 2025 și **2.870 mii lei încă în bugetul 2026**, deci lucrarea nu era finalizată la mijlocul lui 2026. Lista străzilor e în anexe nepublicate. |
| toată comuna | PNI „Anghel Saligny” – „Modernizarea infrastructurii rutiere”, cca 2 km (HCL 94/2021) | cerere de finanțare; 270 mii lei cofinanțare prevăzută în 2022 |
| toată comuna | „Reabilitarea infrastructurii rutiere afectate de viituri” – CNI (HCL 102/2023) | 6.640.063 lei cu TVA, cofinanțare locală 148.750 lei. În execuție apar până acum doar studii (130.900 lei în 2020 și 152.900 lei în 2021). |
| toată comuna | **„Modernizare drumuri locale prin asfaltare”, 3.187 m** (HCL 97/2026) | 4.025.289 lei din bugetul local, eșalonat: 1,24 milioane (2026), 1,39 milioane (2027), 1,39 milioane (2028). În bugetul 2026 apare ca etapele 1–3 (1.500 + 811 + 150 mii lei; etapa 3 = str. Stejarului și G. E. Palade, etapa 2 include str. Gutuiului). |
| **Pietrăria** | reabilitare și asfaltare str. Doamna Elena Cuza 299 m, Garofiței 120 m, Mărului 80 m, Grigore Ghica Vodă al II-lea 160 m (SF HCL 95/2021) | 659 m; plătit 496.250 lei în 2022 |
| **Pietrăria** | declasificarea DJ 248D km 8+110 – 8+510 (str. Sf. Ap. Petru – Prof. Grigore Cobălcescu) în drum local (HCL 51/2023) | |
| **Pietrăria / Bârnova / Cercu** | **tronsoane cedate Județului pentru „Centura ușoară de ocolire a Iașului”**: str. Traian Vuia 1,245 km și 2 tronsoane din str. Sf. Ap. Petru 0,887 km (HCL 107/2022, corectată prin 111/2023); tronsonul DJ 248D (str. Dafina Doamna) – Cercu – DJ 247A, 1,650 km (HCL 88/2023) | 3,78 km de drum comunal trec la Consiliul Județean |
| **Păun** | asfaltare str. Lalelelor și Cezar Petrescu (DALI HCL 18/2023, Road Vision) | cca 800 m; 835 mii lei rest de executat în bugetul 2024 |
| **Vișan** | rigole, traversarea drumului și parcare pe str. Sf. Ilie (HCL 80/2021) | 99.999 lei plătiți în 2022 |
| **Vișan** | trotuare cu pavele (DALI HCL 19/2023, Conproiect Aky); 1.200 m pe str. Sf. Ilie în bugetele 2022–2023 | 301.354 lei plătiți în 2023 |
| **Vișan** | marcaje pentru traversarea pietonilor și indicatoare pe str. Sf. Ilie (HCL 112/2023); trotuar de cca 60 m la nr. 86 (HCL 168/2025) | |
| **Vișan** | în bugetul 2026: **lărgirea str. Sf. Ilie** 1.090 mii lei; proiectare trotuare în zona Mega Image 50 mii lei | |
| **Bârnova (centru)** | în bugetul 2026: reabilitarea și modernizarea căii de acces și a podului Centru mediu (proiectare) 220 mii lei | |
| toată comuna | în bugetul 2026: trotuare asfaltate 1.090 mii lei; pietruiri 1.300 mii lei; comisie pentru inventarierea drumurilor de pietruit (HCL 40/2026) | |
| Zona Metropolitană | „Dezvoltarea rețelei de drumuri locale din ZMI pentru decongestionarea traficului” (HCL 19/2022); **piste de biciclete ZMI** (HCL 132/2022, 46/2025, 25/2026 – terenurile puse la dispoziție) | proiecte conduse de ADI ZMI |

### 4.3. Drumuri noi preluate în domeniul public (accese)
Comuna a „înființat drumuri publice” pe teren donat sau preluat, mai ales pe ulițele noilor zone de case:
- **Păun**: HCL 13/2021 (104 mp), 86/2023 (602 mp, 115 m, str. Trelea spre islaz), 92/2023 (964 mp, 108 m), 143/2024 (620 mp, uliță din str. Ferdinand I);
- **Bârnova**: HCL 28/2021 (412 mp), 69/2024 (1.970 mp, 440 m, din str. Dafina Doamna), 30/2026 (920 mp, 220 m, din str. Barnovschi Vodă);
- **Vișan**: HCL 39/2023 (88 mp), 118/2024 (370 mp, 94 m);
- **Cercu**: HCL 15/2024 (130 mp, 60 m, din str. Alexandru Bădărău);
- **Pietrăria**: HCL 143/2024 (511 mp), 18/2025 (1.560 mp, uliță din str. Sf. Ap. Petru);
- nelocalizate: HCL 45/2025 (581 mp), 37/2026 (4.150 mp, 820 m, din str. Rareș Vodă), 103 și 104/2026 (1.955 mp și 615 mp, donate de SC Symmoryent SRL);
- **drumurile SC Agroindustriala Bucium SA** (HCL 140/2020 și 141/2024): 11 parcele cu folosință de drum, circa 43.000 mp;
  în 2026 s-a aprobat un avocat pentru **exproprierea unor drumuri** de utilitate publică (HCL 84/2026, max. 40.000 lei).

### 4.4. Transport public (context)
- Bârnova e membru fondator al Asociației Metropolitane de Transport Public Iași (HCL 122/2020). AMTPI a fost mandatată
  pentru transportul local (HCL 119/2022), iar gestiunea a fost delegată către CTP Iași (HCL 148/2022 și 162/2024).
  Facilități de transport în comun: HCL 32/2024.
- Microbuz electric și stații de încărcare din PNRR (HCL 59/2022, 115/2022, 62/2024). Trasee locale și tarife aprobate
  prin HCL 68/2025: Păun – Pietrăria – Bârnova lunea, Cercu – Vișan – Ciurea marțea, Bârnova – Todirel – Cercu joia.
- Microbuz școlar prin PJDES (HCL 131/2025); proiectul Interreg RuralMob Connect pentru mobilitate rurală
  (HCL 112/2026, buget Bârnova 638.201 EUR, cofinanțare 10 %).

---

## Ce ar mai trebui făcut
1. De cerut de la primărie (Legea 544/2001): **contul de execuție 2025**, anexele HCL 7/2023 și 31/2024 (lista
   străzilor Anghel Saligny), anexa la HCL 97/2026 (cei 3.187 m), bugetul rectificat final al fiecărui an și planșele PUZ.
2. De localizat cadastral PUZ-urile „nespecificat”, pentru o hartă pe sate. Se pot integra cu harta PUZ existentă în proiect.
3. De verificat cele două PUZ-uri „extravilan Municipiul Iași” aprobate de CL Bârnova (HCL 87/2023 și 27/2024).
