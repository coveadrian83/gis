#!/usr/bin/env python3
"""Extrage din parcelarul OCPI / eTerra doar parcelele menționate în hotărârile PUZ.

Intrare: un export de imobile eTerra (Shapefile sau GeoPackage) cu numărul cadastral în câmpul
NATIONAL_C (sau NATIONAL_CADASTRAL_REFERENCE / NR_CAD / IE), în Stereo 70 – de exemplu exportul
„Imobile” al OCPI Iași. Parcelarul complet nu se publică: scriptul păstrează numai parcelele ale căror
numere cadastrale apar în public/data/puz_iasi.geojson (sau în cache-ul hotărârilor) și le scrie, în
WGS84 și simplificate la ~0,5 m, în data/puz_parcele.geojson, pe care îl citește scripts/puz_iasi.py.

Necesită: pip install pyshp pyproj shapely
Rulare:   python scripts/puz_parcele.py cale/Imobile.shp [--constructii cale/Constructii.shp]
Cu --constructii (stratul de construcții eTerra, câmpul NATIONAL_C de forma „131603-C1”), fiecare parcelă
primește numărul și amprenta la sol a construcțiilor înscrise la data exportului – indiciu că PUZ-ul era deja
(parțial) construit.
"""
import argparse
import datetime as dt
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "puz_parcele.geojson"
CAD_FIELDS = ("NATIONAL_C", "NATIONAL_CADASTRAL_REFERENCE", "NR_CAD", "NRCAD", "IE", "CAD_NO")


def wanted_cadastral():
    """Numerele cadastrale din hotărârile PUZ (din datele publicate)."""
    data = json.loads((ROOT / "public" / "data" / "puz_iasi.geojson").read_text(encoding="utf-8"))
    out = set()
    for f in data["features"]:
        out.update(c for c in (f["properties"].get("cadastral") or "").split(", ") if c)
    return out


def read_shapefile(path):
    import shapefile
    from shapely.geometry import shape
    r = shapefile.Reader(str(path), encoding="utf-8")
    names = [f[0] for f in r.fields[1:]]
    field = next((f for f in CAD_FIELDS if f in names), None)
    if not field:
        sys.exit(f"Nu găsesc câmpul cu numărul cadastral (unul din {CAD_FIELDS}); câmpuri: {names}")
    prj = Path(str(path)[:-4] + ".prj") if str(path).lower().endswith(".shp") else Path(str(path) + ".prj")
    crs = prj.read_text() if prj.exists() else "EPSG:3844"
    for sr in r.iterShapeRecords(fields=[field]):
        yield str(sr.record[field]).strip(), shape(sr.shape.__geo_interface__), crs


def read_geopackage(path):
    from shapely import wkb
    c = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    for table, srs_id in c.execute("select table_name, srs_id from gpkg_contents where data_type='features'"):
        cols = [x[1] for x in c.execute(f'pragma table_info("{table}")')]
        field = next((f for f in CAD_FIELDS if f in cols), None)
        geom = c.execute("select column_name from gpkg_geometry_columns where table_name=?", (table,)).fetchone()[0]
        if not field:
            continue
        row = c.execute("select definition from gpkg_spatial_ref_sys where srs_id=?", (srs_id,)).fetchone()
        crs = row[0] if row and row[0] and row[0] != "undefined" else "EPSG:3844"
        for cad, blob in c.execute(f'select "{field}", "{geom}" from "{table}"'):
            if blob is None:
                continue
            env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(blob[3] >> 1) & 7]
            yield str(cad).strip(), wkb.loads(bytes(blob[8 + env:])), crs
        return
    sys.exit("GeoPackage-ul nu are un strat cu numărul cadastral")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("parcelar", help="Imobile.shp sau .gpkg (export eTerra / OCPI)")
    ap.add_argument("--sursa", default="", help="descrierea sursei (ex. „OCPI Iași, export eTerra 18.05.2023”)")
    ap.add_argument("--constructii", help="stratul de construcții eTerra (Shapefile), opțional")
    args = ap.parse_args()
    from pyproj import Transformer
    from shapely import transform as shp_transform

    want = wanted_cadastral()
    built = {}
    if args.constructii:
        import shapefile
        r = shapefile.Reader(args.constructii, encoding="utf-8")
        for rec in r.iterRecords(fields=["NATIONAL_C", "AREA_VALUE", "BEGIN_LIFE"]):
            cad = str(rec["NATIONAL_C"] or "").split("-C")[0].strip()
            if cad in want:
                year = str(rec["BEGIN_LIFE"].year) if rec["BEGIN_LIFE"] else "?"
                by_year = built.setdefault(cad, {})
                by_year[year] = round(by_year.get(year, 0.0) + float(rec["AREA_VALUE"] or 0), 1)
    path = Path(args.parcelar)
    reader = read_geopackage if path.suffix.lower() == ".gpkg" else read_shapefile
    feats, total, tr = [], 0, None
    for cad, geom, crs in reader(path):
        total += 1
        if cad not in want:
            continue
        if tr is None:
            tr = Transformer.from_crs(crs, 4326, always_xy=True)
        area = round(geom.area, 1)
        g = shp_transform(geom.simplify(0.5, preserve_topology=True),
                          lambda xy: __import__("numpy").column_stack(tr.transform(xy[:, 0], xy[:, 1])))
        pt = g.representative_point()
        gj = json.loads(json.dumps(g.__geo_interface__),
                        parse_float=lambda s: round(float(s), 6))
        feats.append({"type": "Feature", "geometry": gj,
                      "properties": {"cad": cad, "arie_mp": area, "lon": round(pt.x, 6), "lat": round(pt.y, 6),
                                     **({"constructii_mp_pe_an": built.get(cad, {})} if args.constructii else {})}})
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "type": "FeatureCollection",
        "metadata": {"autor": "Prelucrarea și integrarea datelor: dr. geogr. Adrian Covăsnianu",
                     "sursa": args.sursa or path.name, "extras": dt.date.today().isoformat(),
                     "parcele_in_sursa": total, "parcele_pastrate": len(feats),
                     **({"constructii": "amprenta la sol a construcțiilor eTerra, pe anul înscrierii (BEGIN_LIFE), la data exportului"} if args.constructii else {}),
                     "nota": "doar parcelele menționate în hotărârile PUZ; parcelarul complet nu se publică"},
        "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(feats)} parcele păstrate din {total} (numere cadastrale căutate: {len(want)}) → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
