# Traseele liniilor de transport public

Încărcați aici (în GitHub: **Add file → Upload files**) fișierele cu traseele și, opțional, stațiile:
KML / KMZ (Google Earth, Google My Maps), GeoPackage (`.gpkg`) sau Shapefile – pentru Shapefile încărcați
împreună `.shp`, `.shx`, `.dbf` și `.prj`.

La fiecare încărcare, acțiunea **Trasee transport public** le convertește în `public/data/transport/linii.geojson`
și `statii.geojson`, pe care le afișează harta `/transport/`. Numărul liniei este citit din câmpurile
`linie` / `ref` / `traseu` / `name` / `nume` (ex. „Traseul 20”, „Linia 9”) sau din numele directorului KML;
tipul (tramvai / autobuz) din câmpurile `tip` / `mod` sau din nume – altfel liniile 1–15 sunt considerate tramvai.
Detalii: `scripts/transport_linii.py`.
