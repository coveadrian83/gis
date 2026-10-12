# Traseele liniilor de transport public

Încărcați aici (în GitHub: **Add file → Upload files**) fișierele cu traseele și stațiile: KML / KMZ, GeoPackage
(`.gpkg`), GeoJSON sau Shapefile – pentru Shapefile încărcați împreună `.shp`, `.shx`, `.dbf`, `.prj` (și `.cpg`).
La fiecare încărcare, acțiunea **Trasee transport public** le convertește în `public/data/transport/linii.geojson`
și `statii.geojson`, pe care le afișează harta `/transport/`. Detalii: `scripts/transport_linii.py`.

Conținut actual:

| Fișier | Conținut |
|---|---|
| `rute_autobuz_local.*` | 18 linii de autobuz locale CTP, ambele sensuri (relații OpenStreetMap, © contribuitorii OSM, ODbL) |
| `trasee_transport_public_metropolitan.gpkg` | 28 de linii de autobuz metropolitane (101 … 902) |
| `retea_tramvai.geojson` | rețeaua de tramvai existentă și extinderea propusă (din `Infrastructura_Mobilitate.gpkg`) |
| `statii_autobuz_local.*` | 273 de stații de autobuz (OpenStreetMap); liniile stației se calculează din traseele aflate la ≤ 30 m |
| `statii_autobuz_metropolitan.*` | stațiile liniilor metropolitane (`statii_TP_ZMI_analiza_2D`); dublurile – aceeași stație pentru fiecare traseu – se elimină |
| `statii_derivate.gpkg` | stații aglomerate CTP, capete de linie locale / metropolitane, stații de transfer metropolitane |

Rețeaua (local / metropolitan) se citește din numele fișierului („…_local”, „…_metropolitan”) sau din câmpul
`network` / `retea`; tipul (tramvai / autobuz) din câmpurile `tip` / `mod` / `route` sau din nume; `stare = propus`
desenează traseul punctat, ca propunere.
