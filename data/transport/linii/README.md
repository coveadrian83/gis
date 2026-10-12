# Traseele liniilor de transport public

Încărcați aici (în GitHub: **Add file → Upload files**) fișierele cu traseele și stațiile: KML / KMZ, GeoPackage
(`.gpkg`), GeoJSON sau Shapefile – pentru Shapefile încărcați împreună `.shp`, `.shx`, `.dbf`, `.prj` (și `.cpg`).
La fiecare încărcare, acțiunea **Trasee transport public** le convertește în `public/data/transport/linii.geojson`
și `statii.geojson`, pe care le afișează harta `/transport/`. Detalii: `scripts/transport_linii.py`.

Conținut actual:

| Fișier | Conținut |
|---|---|
| `rute_autobuz_local.*` | 18 linii de autobuz locale CTP, ambele sensuri (relații OpenStreetMap, © contribuitorii OSM, ODbL) |
| `metropolitan_amtpi/*.kmz, *.kml` | 28 de trasee metropolitane AMTPI (101 … 902), cu stațiile fiecărui traseu; 204 – KML exportat din Google My Maps (Pietrăria – Vișan, complet) |
| `metropolitan_amtpi_osm.geojson` | liniile AMTPI fără KMZ, preluate din OSM (23) – generat de `scripts/transport_osm.py` |
| `rute_tramvai_osm.geojson` | traseele tramvaiului pe linii (1, 3, 5, 6, 7, 8, 9, 11, 13), extrase din OSM de `scripts/transport_osm.py` – nu se editează manual |
| `rute_gtfs.geojson` | formele traseelor din orarul GTFS CTP (generat de `scripts/transport_gtfs.py`) – **sursa principală**: înlocuiește celelalte surse pentru liniile din orar |
| `retea_tramvai.geojson` | rețeaua de tramvai existentă și extinderea propusă (din `Infrastructura_Mobilitate.gpkg`) |
| `statii_autobuz_local.*` | 273 de stații de autobuz (OpenStreetMap); liniile stației se calculează din traseele aflate la ≤ 30 m |
| `statii_tramvai.*` | 111 stații de tramvai (`statii_tramvai_uat_Iasi`, extrase din OpenStreetMap și folosite în Masterplanul metropolitan Iași; `railway=tram_stop`); legăturile cu autobuzul se calculează la ≤ 100 m |
| `statii_derivate.gpkg` | stații aglomerate CTP, capete de linie locale / metropolitane, stații de transfer metropolitane |

Prioritatea: `prioritate = principal` (orarul GTFS) înlocuiește traseele aceleiași linii din celelalte fișiere; din ele
rămân doar liniile fără orar și stațiile lor. Rețeaua (local / metropolitan) se citește din numele fișierului („…_local”, „…_metropolitan”) sau din câmpul
`network` / `retea`; tipul (tramvai / autobuz) din câmpurile `tip` / `mod` / `route` sau din nume; `stare = propus`
desenează traseul punctat, ca propunere.

Versiunile anterioare ale rețelei metropolitane (GeoPackage-ul `trasee_transport_public_metropolitan` și stratul
`statii_TP_ZMI_analiza_2D`) sunt în `data/transport/arhiva/`, în afara conversiei.
