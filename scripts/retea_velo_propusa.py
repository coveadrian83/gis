#!/usr/bin/env python3
"""Rețeaua velo propusă (Masterplan Piste Velo Iași – „Ierarhizare rețea velo propusă”, DXF) → GeoJSON pentru harta
„15 minute pe două roți” (public/micromobilitate/data/retea_propusa.geojson).

DXF-ul este în Stereo 70 (EPSG:3844); liniile se transformă în WGS84 și se simplifică (Douglas–Peucker, 2 m).
Straturile folosite (restul – cadrul de pagină, cartierele, limitele – se ignoră):

    Retea_velo_expres           → expres        Retea velo expres CF_draft → expres_cf (draft, de-a lungul căii ferate)
    Retea velo primara          → primara       Retea_velo_secundara       → secundara
    Retea_velo_tertiara         → tertiara      Retea_velo_locala          → locala
    Trasee agrement_bikepark    → agrement
    DL-rasteluri biciclete propuse de primarie (blocuri) → punct „rastel”
    DL-centre de inchiere (cercuri)                       → punct „inchiriere”

Rulare (ezdxf, pyproj):
    python scripts/retea_velo_propusa.py data/masterplan/Ierarhizare_retea_velo_propusa_Iasi_v9.1.dxf
"""
import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "micromobilitate" / "data" / "retea_propusa.geojson"
LINES = {
    "Retea_velo_expres": "expres", "Retea velo expres CF_draft": "expres_cf", "Retea velo primara": "primara",
    "Retea_velo_secundara": "secundara", "Retea_velo_tertiara": "tertiara", "Retea_velo_locala": "locala",
    "Trasee agrement_bikepark": "agrement",
}
POINTS = {"DL-rasteluri biciclete propuse de primarie": "rastel", "DL-centre de inchiere": "inchiriere"}
LABEL = {"expres": "Rețea velo expres", "expres_cf": "Rețea velo expres CF (draft)", "primara": "Rețea velo primară",
         "secundara": "Rețea velo secundară", "tertiara": "Rețea velo terțiară", "locala": "Rețea velo locală",
         "agrement": "Trasee de agrement / bike park"}


def simplify(pts, tol):
    """Douglas–Peucker în coordonatele plane ale DXF-ului (metri)."""
    if len(pts) < 3:
        return pts
    keep = [0]

    def rec(i, j):
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        k, best = -1, -1.0
        for t in range(i + 1, j):
            d = abs(dy * (pts[t][0] - x1) - dx * (pts[t][1] - y1)) / L
            if d > best:
                best, k = d, t
        if best > tol:
            rec(i, k)
            rec(k, j)
        else:
            keep.append(j)
    rec(0, len(pts) - 1)
    return [pts[i] for i in keep]


def main():
    ap = argparse.ArgumentParser(description="Rețeaua velo propusă (DXF, Stereo 70) → GeoJSON.")
    ap.add_argument("dxf")
    ap.add_argument("--epsg", type=int, default=3844)
    args = ap.parse_args()
    import ezdxf
    from pyproj import Transformer

    T = Transformer.from_crs(args.epsg, 4326, always_xy=True)
    doc = ezdxf.readfile(args.dxf)
    feats, km = [], {}
    for e in doc.modelspace():
        layer = e.dxf.layer
        if layer in LINES and e.dxftype() in ("LWPOLYLINE", "POLYLINE", "LINE"):
            if e.dxftype() == "LWPOLYLINE":
                pts = [(p[0], p[1]) for p in e.get_points()]
                if e.closed and pts:
                    pts.append(pts[0])
            elif e.dxftype() == "LINE":
                pts = [(e.dxf.start.x, e.dxf.start.y), (e.dxf.end.x, e.dxf.end.y)]
            else:
                pts = [(v.dxf.location.x, v.dxf.location.y) for v in e.vertices]
            if len(pts) < 2:
                continue
            length = sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))
            cat = LINES[layer]
            km[cat] = km.get(cat, 0) + length / 1000
            coords = [[round(c, 6) for c in T.transform(x, y)] for x, y in simplify(pts, 2.0)]
            feats.append({"type": "Feature", "properties": {"cat": cat, "nume": LABEL[cat], "lungime_m": round(length)},
                          "geometry": {"type": "LineString", "coordinates": coords}})
        elif layer in POINTS and e.dxftype() in ("INSERT", "CIRCLE", "POINT"):
            p = e.dxf.insert if e.dxftype() == "INSERT" else (e.dxf.center if e.dxftype() == "CIRCLE" else e.dxf.location)
            lon, lat = T.transform(p.x, p.y)
            feats.append({"type": "Feature", "properties": {"cat": POINTS[layer]},
                          "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})
    out = {"type": "FeatureCollection",
           "sursa": "Masterplan Piste Velo Iași – Ierarhizare rețea velo propusă (DXF, Stereo 70)",
           "km": {k: round(v, 1) for k, v in sorted(km.items())}, "features": feats}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pts = sum(1 for f in feats if f["geometry"]["type"] == "Point")
    print("Linii: %d, puncte: %d; km pe categorii: %s; %s (%.0f kB)" % (len(feats) - pts, pts, out["km"], OUT, OUT.stat().st_size / 1e3))


if __name__ == "__main__":
    main()
