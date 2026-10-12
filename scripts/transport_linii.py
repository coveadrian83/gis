#!/usr/bin/env python3
"""Traseele liniilor de transport public (și stațiile) din fișiere KML / KMZ, GeoPackage sau Shapefile.

Intrare: unul sau mai multe fișiere sau directoare (se caută în ele *.kml, *.kmz, *.gpkg, *.shp), de exemplu
data/transport/linii/ – unde se pot încărca direct din GitHub (Add file → Upload files). Fiecare obiect
liniar devine un traseu, fiecare punct o stație; poligoanele sunt ignorate. Sistemul de coordonate se citește
din fișier (.prj, gpkg_spatial_ref_sys; KML este mereu WGS84); fără informație se presupune Stereo 70 (EPSG:3844).

Numărul liniei se caută în câmpurile linie / line / ref / traseu / route / nr / numar / name / nume / denumire
(primul care conține un număr, ex. „Traseul 20”, „Linia 9”, „1 - Copou – Tg. Cucu”, „L36”) sau, la KML,
în numele directorului (Folder) din care face parte traseul. Tipul (tramvai / autobuz / microbuz / troleibuz)
se caută în câmpurile tip / mod / mode / vehicul / route_type și în nume; dacă lipsește, liniile 1–15 sunt
considerate tramvai (numerotarea CTP Iași), restul autobuz – se poate corecta cu --tramvai 1,3,6,7,8,9,11,13.

Ieșire (WGS84, coordonate cu 5 zecimale, trasee simplificate la ~2 m):
  public/data/transport/linii.geojson   – {linie, tip, nume, sursa} pentru fiecare traseu
  public/data/transport/statii.geojson  – {nume, linii, sursa} pentru fiecare stație (dacă există puncte)

Necesită: pip install pyshp pyproj shapely  (KML/KMZ se citesc doar cu biblioteca standard)
Rulare:   python scripts/transport_linii.py data/transport/linii [alt_fisier.kml …] [--tramvai 1,3,6]
"""
import argparse
import datetime as dt
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
               "name", "nume", "denumire", "den", "descriere", "description")
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


def records(paths):
    for p in paths:
        p = Path(p)
        files = sorted(x for x in p.rglob("*") if x.is_file()) if p.is_dir() else [p]
        for f in files:
            ext = f.suffix.lower()
            reader = {".kml": kml_records, ".kmz": kml_records, ".shp": shp_records, ".gpkg": gpkg_records}.get(ext)
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


def line_ref(props):
    """Numărul liniei (ex. „20”, „1”, „42b”) din câmpurile cunoscute, apoi din numele directorului KML."""
    cands = list(field(props, LINE_FIELDS)) + ([props["_folder"]] if props.get("_folder") else [])
    for v in cands:
        m = re.search(r"(?:linia|linie|traseul?|tramvai(?:ul)?|autobuz(?:ul)?|microbuz|line|route|\bl)\s*[:#nr.]*\s*"
                      r"(\d{1,3}[a-z]?)\b", v, re.I) or re.match(r"\s*(\d{1,3}[a-z]?)\b", v, re.I)
        if m:
            return m.group(1).lower()
    return None


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
            return "tramvai" if ref in trams or str(n) in trams else "autobuz"
        return "tramvai" if n <= 15 else "autobuz"
    return "autobuz"


def simplify(g):
    from shapely.geometry import shape, mapping
    s = shape(g).simplify(SIMPLIFY_DEG, preserve_topology=False)
    return json.loads(json.dumps(mapping(s)))


def rnd(c):
    if isinstance(c[0], (int, float)):
        return [round(c[0], 5), round(c[1], 5)]
    return [rnd(x) for x in c]


def main():
    a = parse_args()
    trams = {t.strip().lower() for t in a.tramvai.split(",") if t.strip()}
    lines, stops, unnamed = [], [], 0
    for src, props, g in records(a.inputs):
        if not g:
            continue
        t = g["type"]
        if t in ("LineString", "MultiLineString"):
            ref = line_ref(props)
            if not ref:
                unnamed += 1
            name = next(field(props, ("name", "nume", "denumire", "den", "traseu", "descriere")), None) or props.get("_folder")
            try:
                g = simplify(g)
            except Exception:
                pass
            lines.append({"type": "Feature", "properties": {
                "linie": ref, "tip": line_mode(props, ref, trams), "nume": name, "sursa": src},
                "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}})
        elif t in ("Point", "MultiPoint"):
            c = g["coordinates"] if t == "Point" else g["coordinates"][0]
            name = next(field(props, STOP_FIELDS), None)
            lr = next(field(props, ("linii", "lines", "routes", "trasee")), None)
            stops.append({"type": "Feature", "properties": {"nume": name, "linii": lr, "sursa": src},
                          "geometry": {"type": "Point", "coordinates": rnd(c)}})
    if not lines and not stops:
        sys.exit("Nu am găsit trasee sau stații în fișierele date.")
    od = Path(a.out)
    od.mkdir(parents=True, exist_ok=True)
    meta = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    if lines:
        lines.sort(key=lambda f: (f["properties"]["tip"] != "tramvai", int(re.match(r"\d+", f["properties"]["linie"]).group())
                                  if f["properties"]["linie"] else 999, f["properties"]["linie"] or ""))
        (od / "linii.geojson").write_text(json.dumps({"type": "FeatureCollection", "meta": meta, "features": lines},
                                                     ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if stops:
        (od / "statii.geojson").write_text(json.dumps({"type": "FeatureCollection", "meta": meta, "features": stops},
                                                      ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    refs = sorted({f["properties"]["linie"] for f in lines if f["properties"]["linie"]},
                  key=lambda r: (int(re.match(r"\d+", r).group()), r))
    print(f"{len(lines)} trasee ({len(refs)} linii: {', '.join(refs)}), {len(stops)} stații → {od}")
    if unnamed:
        print(f"atenție: {unnamed} trasee fără număr de linie recunoscut (vezi câmpurile acceptate în descrierea scriptului)",
              file=sys.stderr)


if __name__ == "__main__":
    main()
