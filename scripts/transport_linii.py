#!/usr/bin/env python3
"""Traseele liniilor de transport public (și stațiile) din fișiere KML / KMZ, GeoPackage sau Shapefile.

Intrare: unul sau mai multe fișiere sau directoare (se caută în ele *.kml, *.kmz, *.gpkg, *.shp, *.geojson), de exemplu
data/transport/linii/ – unde se pot încărca direct din GitHub (Add file → Upload files). Fiecare obiect
liniar devine un traseu, fiecare punct o stație; poligoanele sunt ignorate. Sistemul de coordonate se citește
din fișier (.prj, gpkg_spatial_ref_sys; KML este mereu WGS84); fără informație se presupune Stereo 70 (EPSG:3844).

Numărul liniei se caută în câmpurile linie / line / ref / traseu / route / nr / numar / name / nume / denumire
(primul care conține un număr, ex. „Traseul 20”, „Linia 9”, „1 - Copou – Tg. Cucu”, „L36”) sau, la KML,
în numele directorului (Folder) din care face parte traseul. Tipul (tramvai / autobuz / microbuz / troleibuz)
se caută în câmpurile tip / mod / mode / vehicul / route_type și în nume; dacă lipsește, liniile 1–15 sunt
considerate tramvai (numerotarea CTP Iași), restul autobuz – se poate corecta cu --tramvai 1,3,6,7,8,9,11,13.

Rețeaua (local / metropolitan) se citește din numele fișierului sau al directorului („rute_autobuz_local”,
„trasee_metropolitane.kml”) ori din câmpul network / retea; altfel, traseele cu peste 25 % din lungime în afara
municipiului Iași sunt considerate metropolitane. Pentru fiecare traseu se calculează lungimea și comunele ZMI
străbătute (≥ 300 m), folosite de hartă pentru a lega traseele metropolitane de titlurile vândute în comune.
La exporturile din OpenStreetMap, numărul din numele relației („Bus 36: Breazu => Rond Dacia”) are prioritate
față de un câmp ref care îl contrazice.

Ieșire (WGS84, coordonate cu 5 zecimale, căile unite și simplificate la ~2 m):
  public/data/transport/linii.geojson   – {linie, tip, retea, nume, de_la, pana_la, km, uat, osm, sursa} pe traseu
  public/data/transport/statii.geojson  – {nume, linii, sursa} pentru fiecare stație (dacă există puncte)

Necesită: pip install pyshp pyproj shapely  (KML/KMZ se citesc doar cu biblioteca standard)
Rulare:   python scripts/transport_linii.py data/transport/linii [alt_fisier.kml …] [--tramvai 1,3,6]
"""
import argparse
import json
import re
import sqlite3
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "transport"
LINE_FIELDS = ("linie", "line", "ref", "traseu", "route", "route_short_name", "nr", "numar", "nr_linie", "nume_linie",
               "name", "nume", "denumire", "den", "folders", "layer", "descriere", "description")
MODE_FIELDS = ("tip", "mod", "mode", "vehicul", "tip_vehicul", "mijloc", "route_type", "categorie", "type")
STOP_FIELDS = ("nume", "name", "statie", "stație", "denumire", "den", "nume_statie", "stop_name")
MODES = (("tramvai", ("tramvai", "tram", "tramway")), ("troleibuz", ("troleibuz", "trolleybus")),
         ("microbuz", ("microbuz", "minibus")), ("autobuz", ("autobuz", "bus", "metropolitan")))
SIMPLIFY_DEG = 0.00002   # ~2 m


def parse_args():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("inputs", nargs="+", help="fișiere sau directoare cu KML / KMZ / GPKG / SHP")
    ap.add_argument("--tramvai", default="", help="numerele liniilor de tramvai, separate prin virgulă")
    ap.add_argument("--out", default=str(OUT_DIR))
    return ap.parse_args()


# ---------- citire ----------

def kml_records(path):
    """(proprietăți, geometrie GeoJSON) din KML / KMZ; proprietatea „_folder” = numele directorului KML."""
    if path.suffix.lower() == ".kmz":
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.lower().endswith(".kml"))
            root = ET.fromstring(z.read(name))
    else:
        root = ET.parse(path).getroot()

    def local(tag):
        return tag.rsplit("}", 1)[-1]

    def coords(el):
        pts = []
        for tok in (el.text or "").split():
            p = tok.split(",")
            if len(p) >= 2:
                pts.append([float(p[0]), float(p[1])])
        return pts

    def geoms(pm):
        lines, points = [], []
        for el in pm.iter():
            t = local(el.tag)
            if t == "LineString":
                c = next((x for x in el if local(x.tag) == "coordinates"), None)
                if c is not None and len(coords(c)) >= 2:
                    lines.append(coords(c))
            elif t == "Point":
                c = next((x for x in el if local(x.tag) == "coordinates"), None)
                if c is not None and coords(c):
                    points.append(coords(c)[0])
        return lines, points

    def walk(el, folder):
        for ch in el:
            t = local(ch.tag)
            if t in ("Folder", "Document"):
                nm = next((x.text for x in ch if local(x.tag) == "name"), None)
                yield from walk(ch, (nm or folder) if t == "Folder" else folder)
            elif t == "Placemark":
                props = {"_folder": folder}
                for x in ch:
                    lt = local(x.tag)
                    if lt in ("name", "description") and x.text:
                        props[lt] = x.text.strip()
                for x in ch.iter():
                    lt = local(x.tag)
                    if lt in ("Data", "SimpleData"):
                        key = x.get("name")
                        val = x.text if lt == "SimpleData" else next((v.text for v in x if local(v.tag) == "value"), None)
                        if key and val:
                            props[key] = val.strip()
                lines, points = geoms(ch)
                if lines:
                    yield props, ({"type": "LineString", "coordinates": lines[0]} if len(lines) == 1 else
                                  {"type": "MultiLineString", "coordinates": lines})
                for p in points:
                    yield props, {"type": "Point", "coordinates": p}

    yield from walk(root, None)


def transformer(crs):
    from pyproj import CRS, Transformer
    src = CRS.from_user_input(crs or "EPSG:3844")
    if src.to_epsg() == 4326:
        return None
    return Transformer.from_crs(src, "EPSG:4326", always_xy=True)


def shp_records(path):
    import shapefile
    prj = path.with_suffix(".prj")
    tr = transformer(prj.read_text() if prj.exists() else None)
    for enc in ("utf-8", "cp1250"):
        try:
            r = shapefile.Reader(str(path), encoding=enc)
            recs = [(sr.record.as_dict(), sr.shape.__geo_interface__) for sr in r.iterShapeRecords()]
            break
        except UnicodeDecodeError:
            continue
    else:
        r = shapefile.Reader(str(path), encoding="latin-1")
        recs = [(sr.record.as_dict(), sr.shape.__geo_interface__) for sr in r.iterShapeRecords()]
    for props, g in recs:
        yield props, reproject(g, tr)


def gpkg_records(path):
    from shapely import wkb
    from shapely.geometry import mapping
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    for table, srs_id in c.execute("select table_name, srs_id from gpkg_contents where data_type='features'").fetchall():
        geom_col = c.execute("select column_name from gpkg_geometry_columns where table_name=?", (table,)).fetchone()[0]
        row = c.execute("select organization, organization_coordsys_id, definition from gpkg_spatial_ref_sys "
                        "where srs_id=?", (srs_id,)).fetchone()
        crs = f"{row[0]}:{row[1]}" if row and row[0] and row[1] and row[1] > 0 else (row[2] if row else None)
        tr = transformer(crs)
        cols = [x[1] for x in c.execute(f'pragma table_info("{table}")')]
        for vals in c.execute(f'select * from "{table}"'):
            props = dict(zip(cols, vals))
            blob = props.pop(geom_col, None)
            if not blob:
                continue
            flags = blob[3]
            env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}.get((flags >> 1) & 7, 0)
            g = mapping(wkb.loads(bytes(blob[8 + env:])))
            props = {k: v for k, v in props.items() if not isinstance(v, (bytes, bytearray))}
            props["_folder"] = table
            yield props, reproject(json.loads(json.dumps(g)), tr)


def reproject(g, tr):
    if tr is None or g is None:
        return g

    def conv(c):
        if isinstance(c[0], (int, float)):
            x, y = tr.transform(c[0], c[1])
            return [x, y]
        return [conv(x) for x in c]
    return {"type": g["type"], "coordinates": conv(g["coordinates"])}


def geojson_records(path):
    """GeoJSON în WGS84 (sau cu membrul „crs” al formatului vechi); proprietatea „_folder” = numele fișierului."""
    d = json.loads(path.read_text(encoding="utf-8"))
    crs = ((d.get("crs") or {}).get("properties") or {}).get("name")
    tr = transformer(crs) if crs else None
    for f in d.get("features", []):
        props = dict(f.get("properties") or {})
        props.setdefault("_folder", path.stem)
        yield props, reproject(f.get("geometry"), tr)


def records(paths):
    for p in paths:
        p = Path(p)
        files = sorted(x for x in p.rglob("*") if x.is_file()) if p.is_dir() else [p]
        for f in files:
            ext = f.suffix.lower()
            reader = {".kml": kml_records, ".kmz": kml_records, ".shp": shp_records, ".gpkg": gpkg_records,
                      ".geojson": geojson_records}.get(ext)
            if not reader:
                continue
            n = 0
            for props, g in reader(f):
                n += 1
                yield f.name, props, g
            print(f"{f.name}: {n} obiecte", file=sys.stderr)


# ---------- interpretare ----------

def field(props, names):
    low = {str(k).lower(): v for k, v in props.items()}
    for n in names:
        v = low.get(n)
        if v not in (None, ""):
            yield str(v)


OSM_NAME = re.compile(r"^\s*(bus|tram|trolleybus|minibus|share_taxi|autobuz|tramvai|troleibuz|microbuz)\s+([0-9]{1,3}[a-z]?)\s*:", re.I)


def line_ref(props):
    """Numărul liniei (ex. „20”, „1”, „42B”) din câmpurile cunoscute, apoi din numele directorului KML."""
    cands = list(field(props, LINE_FIELDS)) + ([props["_folder"]] if props.get("_folder") else [])
    for v in cands:
        m = re.search(r"(?:linia|linie|traseul?|tramvai(?:ul)?|autobuz(?:ul)?|microbuz|line|route|\bl)\s*[:#nr.]*\s*"
                      r"(\d{1,3}[a-z]?)\b", v, re.I) or re.match(r"\s*(\d{1,3}[a-z]?)\b", v, re.I)
        if m:
            return m.group(1).upper()
    for v in cands:                       # nume de straturi / fișiere: „traseu_TP_101”, „trase_TP_202_cu_extensie”
        m = re.search(r"(?:^|[_\s-])(\d{1,3}[a-z]?)(?=[_\s.-]|$)", v, re.I)
        if m:
            return m.group(1).upper()
    return None


def osm_name_ref(props):
    """Numărul din numele unei relații OSM („Bus 36: Breazu => Rond Dacia” → „36”) sau None."""
    m = OSM_NAME.match(next(field(props, ("name", "nume")), "") or "")
    return m.group(2).upper() if m else None


def line_mode(props, ref, trams):
    text = " ".join(list(field(props, MODE_FIELDS)) + list(field(props, LINE_FIELDS)) + [props.get("_folder") or ""])
    t = text.lower()
    for mode, words in MODES:
        if any(re.search(rf"\b{w}", t) for w in words):
            return mode
    rt = next(field(props, ("route_type",)), None)            # GTFS: 0 = tramvai, 3 = autobuz, 11 = troleibuz
    if rt in ("0", "900"):
        return "tramvai"
    if rt == "11":
        return "troleibuz"
    if ref:
        n = int(re.match(r"\d+", ref).group())
        if trams:
            return "tramvai" if ref.lower() in trams or str(n) in trams else "autobuz"
        return "tramvai" if n <= 15 else "autobuz"
    return "autobuz"


def declared_network(src, props):
    """„metropolitan” / „local” după numele fișierului, directorul KML sau câmpurile rețea / network; altfel None."""
    text = " ".join([src, props.get("_folder") or ""] + list(field(props, ("retea", "rețea", "network", "network__1",
                                                                             "tip_retea", "zona"))))
    t = text.lower().replace("_", " ").replace("-", " ")
    if re.search(r"metropolit|\bzmi?\b|\bperiurban|interurban", t):
        return "metropolitan"
    if re.search(r"\blocal|\burban", t):
        return "local"
    return None


class Uats:
    """Limitele UAT-urilor ZMI (public/data/zmi_uat_web.geojson), în Stereo 70, pentru comunele străbătute."""
    def __init__(self):
        import shapely
        from pyproj import Transformer
        from shapely.geometry import shape
        tr = Transformer.from_crs("EPSG:4326", "EPSG:3844", always_xy=True)
        self.fwd = lambda g: shapely.transform(g, lambda x, y: tr.transform(x, y), interleaved=False)
        self.items, self.iasi = [], None
        path = ROOT / "public" / "data" / "zmi_uat_web.geojson"
        if not path.exists():
            return
        for f in json.loads(path.read_text(encoding="utf-8"))["features"]:
            p = f["properties"]
            g = self.fwd(shape(f["geometry"])).buffer(0)
            if p.get("zmi_role") == "municipiu_pol":
                self.iasi = g
            else:
                self.items.append((str(p.get("siruta_uat")), p.get("canonical_name") or p.get("name"), g))

    def measure(self, geom):
        """(lungimea în km, ponderea din afara municipiului Iași, [(siruta, nume)] comunele străbătute ≥ 300 m)."""
        g = self.fwd(geom)
        length = g.length or 1
        out = [(s, n) for s, n, poly in self.items if g.intersection(poly).length >= 300]
        outside = 1 - (g.intersection(self.iasi).length / length if self.iasi is not None else 1)
        return round(g.length / 1000, 2), outside, out


def clean_line(g):
    """Unește bucățile (căile OSM ale relației) și simplifică la ~2 m."""
    from shapely.geometry import shape, mapping
    from shapely.ops import linemerge
    s = shape(g)
    if s.geom_type == "MultiLineString":
        s = linemerge(s)
    s = s.simplify(SIMPLIFY_DEG, preserve_topology=False)
    return s, json.loads(json.dumps(mapping(s)))


def rnd(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 5), round(c[1], 5)]
    return [rnd(x) for x in c]


def main():
    a = parse_args()
    trams = {t.strip().lower() for t in a.tramvai.split(",") if t.strip()}
    uats = Uats()
    lines, stops, unnamed, warnings = [], [], 0, []
    for src, props, g in records(a.inputs):
        if not g:
            continue
        t = g["type"]
        if t in ("LineString", "MultiLineString"):
            ref, oref = line_ref(props), osm_name_ref(props)
            name = next(field(props, ("name", "nume", "denumire", "den", "traseu", "descriere")), None)
            if not name and src.lower().endswith((".kml", ".kmz")):     # la KML, directorul poartă numele liniei
                name = props.get("_folder")
            if oref and ref and oref != ref:     # ex. ref=6B la „Bus 36: Breazu => Rond Dacia” – eroare în OSM
                warnings.append(f"„{name}”: ref={ref} diferă de numele relației → linia {oref}")
                ref = oref
            ref = ref or oref
            if not ref:
                unnamed += 1
            shp, g = clean_line(g)
            km, outside, crossed = uats.measure(shp)
            retea = declared_network(src, props) or ("metropolitan" if outside > 0.25 else "local")
            p = {"linie": ref, "tip": line_mode(props, ref, trams), "retea": retea, "nume": name,
                 "de_la": next(field(props, ("from", "de_la", "plecare")), None),
                 "pana_la": next(field(props, ("to", "pana_la", "sosire", "destinatie")), None),
                 "km": km, "uat": [s for s, _ in crossed], "uat_nume": [n for _, n in crossed]}
            osm = next(field(props, ("full_id", "osm_id", "@id", "id")), None)
            if osm and re.match(r"^(r|relation/)?\d+$", osm) and ("osm_type" in props or osm.startswith(("r", "relation"))):
                p["osm"] = "relation/" + re.sub(r"\D", "", osm)
            op = next(field(props, ("operator", "operator_", "operat")), None)
            if op:
                p["operator"] = op
            stare = next(field(props, ("stare", "status", "state")), None)
            if stare:
                p["stare"] = stare
            p["sursa"] = src
            lines.append({"type": "Feature", "properties": p,
                          "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}})
        elif t in ("Point", "MultiPoint"):
            c = g["coordinates"] if t == "Point" else g["coordinates"][0]
            name = next(field(props, STOP_FIELDS), None)
            lr = next(field(props, ("linii", "lines", "routes", "trasee", "route_ref")), None)
            sp = {"nume": name, "linii": lr, "strat": props.get("_folder"), "sursa": src}
            nr = next(field(props, ("n_routes", "nr_linii")), None)
            if nr and re.match(r"^\d+$", nr):
                sp["n_linii"] = int(nr)
            stops.append({"type": "Feature", "properties": sp,
                          "geometry": {"type": "Point", "coordinates": rnd(c)}})
    if not lines and not stops:
        sys.exit("Nu am găsit trasee sau stații în fișierele date.")
    od = Path(a.out)
    od.mkdir(parents=True, exist_ok=True)

    def num(r):
        return (int(re.match(r"\d+", r).group()), r) if r else (999, "")
    if lines:
        order = {"tramvai": 0, "troleibuz": 1, "autobuz": 2, "microbuz": 3}
        lines.sort(key=lambda f: (order.get(f["properties"]["tip"], 4), f["properties"]["retea"] != "local",
                                  num(f["properties"]["linie"])))
        (od / "linii.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": lines},
                                                     ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if stops:
        (od / "statii.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": stops},
                                                      ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for w in warnings:
        print("atenție:", w, file=sys.stderr)
    summary = {}
    for f in lines:
        p = f["properties"]
        if p["linie"]:
            summary.setdefault(f"{p['tip']} {p['retea']}", set()).add(p["linie"])
    for k, v in sorted(summary.items()):
        print(f"{k}: {', '.join(sorted(v, key=num))}")
    print(f"{len(lines)} trasee, {len(stops)} stații → {od}")
    if unnamed:
        print(f"{unnamed} trasee fără număr de linie (afișate ca rețea, ex. infrastructura de tramvai); dacă ar trebui "
              "să aibă număr, vezi câmpurile acceptate în descrierea scriptului", file=sys.stderr)


if __name__ == "__main__":
    main()
