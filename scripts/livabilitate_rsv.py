#!/usr/bin/env python3
"""Spațiile verzi și arborii din Registrul Spațiilor Verzi al municipiului Iași, agregate pe cele 17 zone MVA–MVI,
pentru indicele de locuibilitate (/livabilitate/). Rulează local, o dată, cu fișierele registrului (shapefile,
Stereo 70); în depozit intră doar rezultatul agregat, public/livabilitate/data/rsv.json.

    pip install pyshp shapely pyproj numpy
    python scripts/livabilitate_rsv.py <director cu RSVImobil.shp, RSVParcela_.shp, RSVArbori_.shp>

Registrul are trei straturi folosite aici:
  - RSVImobil   – unitățile registrului (parc, scuar, spațiul verde dintre blocuri, curtea unei școli…), cu denumire;
  - RSVParcela_ – parcelele din fiecare imobil, cu categoria de folosință (d_ID_N_Cat): SV spațiu verde, PD pădure,
                  DR drumuri și alei, CO construcții, CI cimitir, HB lac, CS teren de sport, CSJ loc de joacă …;
  - RSVArbori_  – arborii inventariați, cu specia.
Suprafața verde = parcelele cu vegetație (VEG de mai jos), tăiate exact pe limita zonei; pădurea (PD, practic Pădurea
Ciric) e raportată separat și nu intră în spațiul verde public amenajat. Accesul public nu e un câmp
în registru: se deduce din denumirea imobilului (RESTR = școli, spitale, biserici, cimitire, Grădina Botanică …).
"""
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapefile
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
ZONES = ROOT / "public/data/iasi_17_zone_mva_mvi.geojson"
OUT = ROOT / "public/livabilitate/data/rsv.json"

# categoriile de folosință cu vegetație (spațiu verde, pădure, aliniamente/arbuști, gard viu)
VEG = {"SV", "PD", "AF", "GN"}
# imobile cu acces restricționat sau folosință specializată (Legea 24/2007): nu sunt spații verzi publice cu acces
# nelimitat, chiar dacă sunt verzi
RESTR = re.compile(r"gradinit|cresa|scoal|liceu|colegi|grup scolar|seminar|universit|facultat|campus|camin|institut|"
                   r"academi|spital|clinic|maternit|dispensar|policlinic|centrul medical|sanatori|biseric|manastir|"
                   r"mitropoli|catedral|parohi|schit|capela|cimitir|muze|casa memorial|politi|jandarm|militar|"
                   r"inspectorat|tribunal|judecator|prefectur|apa vital|teren administrare|teren liber|teren viran|"
                   r"stadion|baza sportiv|club|sala sport|complex sportiv|strand|plaja|gradina botanica|gara|depou|"
                   r"fabric|uzin|statia de|centrala|penitenciar|azil|camin de batrani|centrul de plasament", re.I)

_TO_M = Transformer.from_crs(4326, 3844, always_xy=True).transform


def to_m(g):
    return shapely.transform(g, lambda c: np.column_stack(_TO_M(c[:, 0], c[:, 1])))


def plain(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    zones = json.loads(ZONES.read_text())["features"]
    zg = [to_m(shape(f["geometry"])) for f in zones]
    ztree = STRtree(zg)
    n = len(zones)

    im = shapefile.Reader(str(src / "RSVImobil"), encoding="utf-8")
    ig = [shape(s.__geo_interface__) for s in im.shapes()]
    names = [r["Denumire"] or "" for r in im.records()]
    restr = [bool(RESTR.search(plain(x))) for x in names]
    last = max(r["last_edi_1"] for r in im.records() if r["last_edi_1"])
    itree = STRtree(ig)

    pub = [0.0] * n      # vegetație amenajată (fără pădure) în imobile cu acces public
    forest = [0.0] * n   # pădure (PD) – Pădurea Ciric, raportată separat
    tot = [0.0] * n      # vegetație în toate imobilele
    big = [set() for _ in range(n)]  # imobile publice cu ≥ 0,5 ha de vegetație care ating zona
    veg_im = [0.0] * len(ig)
    pr = shapefile.Reader(str(src / "RSVParcela_"), encoding="utf-8")
    parts = []
    for s, r in zip(pr.iterShapes(), pr.iterRecords()):
        if r["d_ID_N_Cat"] not in VEG:
            continue
        g = shape(s.__geo_interface__)
        if not g.is_valid:
            g = g.buffer(0)
        p = g.representative_point()
        owner = next((int(i) for i in itree.query(p) if ig[i].covers(p)), None)
        if owner is not None:
            veg_im[owner] += g.area
        parts.append((g, owner, r["d_ID_N_Cat"]))
    for g, owner, cat in parts:
        for z in ztree.query(g):
            a = g.intersection(zg[z]).area if not zg[z].contains(g) else g.area
            if a <= 0:
                continue
            tot[z] += a
            if cat == "PD":
                forest[z] += a
            elif owner is not None and not restr[owner]:
                pub[z] += a
                if veg_im[owner] >= 5000:
                    big[z].add(owner)

    ar = shapefile.Reader(str(src / "RSVArbori_"), encoding="utf-8")
    trees = [0] * n
    for s in ar.iterShapes():
        p = shapely.Point(s.points[0])
        for z in ztree.query(p):
            if zg[z].covers(p):
                trees[z] += 1
                break

    out = dict(
        generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        source="Registrul Spațiilor Verzi al municipiului Iași (Primăria Municipiului Iași), ultima editare "
               + last.isoformat(),
        updated=last.isoformat(),
        zones=[dict(id=f["properties"]["zone_id"], sv_pub=round(pub[i]), sv_tot=round(tot[i]), padure=round(forest[i]), arbori=trees[i],
                    mari=len(big[i])) for i, f in enumerate(zones)])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"Scris {OUT}; imobile cu acces restricționat: {sum(restr)} din {len(restr)}", file=sys.stderr)
    for f, z in zip(zones, out["zones"]):
        print(f"  {f['properties']['zone_name'][:28]:<28} public {z['sv_pub'] / 1e4:7.1f} ha  total "
              f"{z['sv_tot'] / 1e4:7.1f} ha  pădure {z['padure'] / 1e4:6.1f} ha  arbori {z['arbori']:>6}  imobile ≥0,5 ha {z['mari']}", file=sys.stderr)


if __name__ == "__main__":
    main()
