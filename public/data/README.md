# Date geografice (GEO_ZONES / GEO_ALIASES)

Aplicația citește din acest director următoarele fișiere (aceleași nume ca în pachetul v0.4.5):

| Fișier | Conținut | Obligatoriu |
|---|---|---|
| `iasi_17_zone_mva_mvi.geojson` | Poligoanele zonelor de analiză din Municipiul Iași (WGS84). Pot fi cele 17 zone armonizate (cu `zone_id` = `IAS-Z01`…`IAS-Z17`) sau cele 22 de poligoane sursă (`BULARGA-ZONA INDUSTRIALA`, `UNNAMED_2` …) – armonizarea UNNAMED se aplică automat. | da |
| `zmi_uat_web.geojson` | Limitele celor 28 de UAT-uri ZMI (ANCPI), cu cod SIRUTA (`siruta`, `natcode`/`natCode` …) și denumire (`name`/`uat_name` …). | da |
| `zmi_localitati_siruta_2025.json` (sau `.csv`) | Nomenclatorul SIRUTA al localităților componente: `siruta`, `name`/`denumire`, `uat_siruta`/`sirsup`, `uat_name`; opțional `lat`, `lng`. | da |
| `mvi_poi_aliases.json` | Repere de căutare: `id`, `name`, `aliases[]`, `lat`, `lng`. | nu |

Denumirile câmpurilor sunt detectate automat (vezi `public/shared/geo-core.js`).
După copierea fișierelor rulați `npm run check-geo` pentru verificare
(sau `npm run check-geo -- https://site-ul-tau.netlify.app` pentru fișierele deja publicate).

**Atenție:** `mvi_poi_aliases.json` din depozit conține doar câteva repere implicite cu
coordonate aproximative (`"verificat": false`). Înlocuiți-l cu fișierul MVI validat.

La orice modificare a geometriilor sau nomenclatoarelor:
1. creșteți `GEOMETRY_VERSION` (variabilă de mediu, ex. `ZMI-2025.2`);
2. publicați din nou site-ul (pe Netlify se face automat la încărcarea fișierelor în GitHub);
3. din dashboard: „Reîncarcă datele geografice”. Toate deplasările sunt reclasificate automat cu noile geometrii.
