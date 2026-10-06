# Ghid rapid de publicare și testare – v0.4.5

## Ce trebuie încărcat
În directorul public al subdomeniului de test trebuie încărcat conținutul acestui pachet, nu folderul exterior.

Fișierele importante sunt:
- index.html
- iasi_17_zone_mva_mvi.geojson
- zmi_uat_web.geojson
- zmi_localitati_siruta_2025.csv
- zmi_localitati_siruta_2025.json
- mvi_poi_aliases.json
- README.md
- METODOLOGIE_v0.4.5.md
- GHID_TESTARE_SITE_v0.4.5.md

## Domeniu recomandat
Pentru test:
https://mobilitate-test.moldovavreainfrastructura.ro

Pentru producție, ulterior:
https://mobilitate.moldovavreainfrastructura.ro

## Cerințe minime hosting
Pentru v0.4.5 nu este necesar PHP, Node sau Python.
Este suficient hosting static HTTPS care servește HTML/CSS/JS.

Browserul trebuie să poată accesa:
- https://unpkg.com
- https://tile.openstreetmap.org
- https://nominatim.openstreetmap.org

## Test recomandat
1. Deschide site-ul pe desktop.
2. Verifică dacă vezi harta OSM.
3. Origine: caută „Paun” → selectează Păun, Bârnova.
4. Confirmă „✓ Origine selectată”.
5. Destinație: caută „Gara” → selectează Gara Iași.
6. Confirmă „✓ Destinație selectată”.
7. Verifică activarea „CONTINUĂ LA PASUL 2”.
8. Completează data și orele.
9. Verifică durata.
10. Selectează mod/scop/recurență.
11. Trimite.
12. Repetă cu „Visan → Universitate” și „Valea Adanca → Palas”.
13. Testează pe telefon.
14. Testează butoanele Schimbă / Șterge / Reia O/D / Pan / + / -.

## Important
Datele din această versiune rămân în localStorage pe dispozitiv. Nu sunt trimise către server.
Nu folosi încă v0.4.5 pentru lansarea oficială a colectării.
