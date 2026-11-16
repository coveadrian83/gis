#!/usr/bin/env python3
"""Rețeaua școlară (unitățile de învățământ din ZMI, cu numărul de elevi) agregată pe cele 17 zone MVA–MVI, pentru
indicele de locuibilitate (/livabilitate/). Rulează local, o dată, cu stratul scoli_ZMI (shapefile, Stereo 70; surse:
ISJ Iași, site-urile școlilor, ANCPI, OSM, prelucrări GIS – Covăsnianu 2025); în depozit intră doar rezultatul agregat,
public/livabilitate/data/scoli.json.

    pip install pyshp shapely pyproj numpy
    python scripts/livabilitate_scoli.py <cale>/scoli_ZMI.shp

Câmpuri folosite: grades (nivelul: 1 educație timpurie, 2 primar, 3 gimnazial, 4 liceal, 5 profesional și tehnic,
6 terțiar nonuniversitar, 7 superior) și pop_scolar (elevi / studenți). Unitățile fără număr de elevi primesc mediana
nivelului lor. Învățământul superior (7) nu intră: nu e un serviciu de cartier.
"""
import json
import statistics
import sys
from collections import defaultdict
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
OUT = ROOT / "public/livabilitate/data/scoli.json"
SCHOOL = {"2", "3", "4", "5", "6"}
KINDER = {"1"}
_TO_M = Transformer.from_crs(4326, 3844, always_xy=True).transform


def to_m(g):
    return shapely.transform(g, lambda c: np.column_stack(_TO_M(c[:, 0], c[:, 1])))


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    zones = json.loads(ZONES.read_text())["features"]
    zg = [to_m(shape(f["geometry"])) for f in zones]
    tree = STRtree(zg)
    r = shapefile.Reader(sys.argv[1], encoding="utf-8", encodingErrors="replace")
    rows = [(str(rec["grades"]).strip(), rec["pop_scolar"] or 0, shapely.Point(s.points[0]))
            for s, rec in zip(r.iterShapes(), r.iterRecords())]
    med = {g: statistics.median([p for gg, p, _ in rows if gg == g and p > 0] or [0]) for g in {x[0] for x in rows}}

    n = len(zones)
    z = [dict(scoli_n=0, scoli_loc=0, scoli_est=0, grad_n=0, grad_loc=0, grad_est=0) for _ in range(n)]
    per_level = defaultdict(int)
    for g, p, pt in rows:
        if g not in SCHOOL | KINDER:
            continue
        zi = next((int(i) for i in tree.query(pt) if zg[i].covers(pt)), None)
        if zi is None:
            continue
        k = "scoli" if g in SCHOOL else "grad"
        est = p <= 0
        z[zi][k + "_n"] += 1
        z[zi][k + "_loc"] += round(med[g]) if est else p
        z[zi][k + "_est"] += int(est)
        per_level[g] += 1
    out = dict(generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
               source="Rețeaua școlară a municipiului Iași (ISJ Iași, site-urile școlilor, ANCPI, OSM; Covăsnianu 2025)",
               median={g: med[g] for g in sorted(med)},
               zones=[dict(id=f["properties"]["zone_id"], **z[i]) for i, f in enumerate(zones)])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"Scris {OUT}; unități în cele 17 zone pe nivel: {dict(sorted(per_level.items()))}; mediane {out['median']}",
          file=sys.stderr)
    for f, q in zip(zones, z):
        print(f"  {f['properties']['zone_name'][:28]:<28} școli {q['scoli_n']:>3} ({q['scoli_loc']:>6} elevi, "
              f"{q['scoli_est']} estimate)  grădinițe {q['grad_n']:>3} ({q['grad_loc']:>5} copii)", file=sys.stderr)


if __name__ == "__main__":
    main()
