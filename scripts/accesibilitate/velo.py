"""Rețeaua velo propusă prin Masterplanul Metropolitan 2026 (include Masterplanul de piste velo 2023) pentru /accesibilitate/.

Straturi (shapefile, folderul „2026” din Drive-ul MPM): R0_velo, R1_velo, R2_velo (inele), Radiale,
„Conexiuni si Alternative_velo” („(1)” e inclus integral în acesta și nu se folosește).

Calculează, pe cartiere și comune:
  - km de pistă propusă în unitate, pe categorii;
  - locuitorii la ≤ 300 m pe jos de rețea (linia dreaptă × factorul de ocol al celulei, ca în frecventa.py);
  - I6 „Acces velo” în situația propusă: 1 dacă unitatea are deja acces velo sau dacă o traversează cel puțin
    300 m de pistă propusă. Pagina recalculează cu el indicele și clasa scenariilor propuse.

Rulare: python3 scripts/accesibilitate/velo.py <folderul cu shapefile-urile>
Ieșire: public/accesibilitate/data/velo.json
"""
import json, os, sys, warnings
import numpy as np, geopandas as gpd, shapely
from shapely.geometry import Polygon, MultiPolygon

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = sys.argv[1]
DET = os.path.join(ROOT, "public/accesibilitate/data/detaliu.json")
OUT = os.path.join(ROOT, "public/accesibilitate/data/velo.json")
LAYERS = {"r0": "R0_velo", "r1": "R1_velo", "r2": "R2_velo", "rad": "Radiale", "con": "Conexiuni si Alternative_velo"}
MIN_KM = 0.3

lines = []
for k, f in LAYERS.items():
    g = gpd.read_file(os.path.join(SRC, f + ".shp")).to_crs(3844)
    g = g[g.geometry.notna() & ~g.geometry.is_empty]
    g["geometry"] = shapely.force_2d(g.geometry)
    lines.append(g.assign(cat=k)[["cat", "geometry"]].explode(index_parts=False))
L = gpd.GeoDataFrame(__import__("pandas").concat(lines, ignore_index=True), crs=3844)
L = L[L.length > 1]
print({k: round(float(L[L.cat == k].length.sum() / 1000), 1) for k in LAYERS}, "km")

D = json.load(open(DET))
B = np.array([r[:9] for r in D["b"]], dtype=float)
cells = gpd.GeoDataFrame(geometry=gpd.points_from_xy(B[:, 0], B[:, 1]), crs=4326).to_crs(3844)
stops = gpd.GeoDataFrame(geometry=gpd.points_from_xy([s[1] for s in D["s"]], [s[2] for s in D["s"]]), crs=4326).to_crs(3844)
# factorul de ocol al celulei (distanța Madina / linia dreaptă până la cea mai apropiată stație), între 1 și 2
eu_stop = cells.sjoin_nearest(stops, distance_col="d").groupby(level=0).d.min().values
net = B[:, 3]
detour = np.clip(np.where(net >= 0, net / np.maximum(eu_stop, 1), 1.3), 1, 2)
eu_velo = cells.sjoin_nearest(L[["geometry"]], distance_col="d").groupby(level=0).d.min().values
near = eu_velo * detour <= 300
pop = B[:, 2]

def poly(geo):
    rings = [Polygon(r) for r in geo]
    return MultiPolygon(rings) if len(rings) > 1 else rings[0]

units = gpd.GeoDataFrame({"n": [u["n"] for u in D["bnd"]], "t": [u["t"] for u in D["bnd"]]},
                         geometry=[poly(u["geo"]) for u in D["bnd"]], crs=4326).to_crs(3844)
units["geometry"] = units.buffer(0)
inside = cells.sjoin(units, predicate="within")
inside = inside[~inside.index.duplicated()]  # cartierele înaintea comunelor nu se suprapun; o celulă, o unitate
out_u = {}
for i, u in units.iterrows():
    clip = L.clip(u.geometry)
    km = {k: round(float(clip[clip.cat == k].length.sum() / 1000), 2) for k in LAYERS}
    idx = inside.index[inside.index_right == i]
    P = pop[idx].sum()
    out_u[u.n] = {"km": round(sum(km.values()), 2), "kc": km,
                  "p300": round(float(pop[idx][near[idx]].sum() / P * 100), 1) if P else None,
                  "nv": int(sum(km.values()) >= MIN_KM)}
zmi = B[:, 8] > 0
print("ZMI: locuitori la ≤ 300 m de rețea", round(float(pop[zmi & near].sum() / pop[zmi].sum() * 100), 1), "%")

L4 = L.copy()
L4["geometry"] = L4.simplify(5)
L4 = L4.to_crs(4326)
routes = [[r.cat, [[round(x, 5), round(y, 5)] for x, y in r.geometry.coords]] for r in L4.itertuples() if r.geometry.geom_type == "LineString"]
json.dump({"min_km": MIN_KM, "km": {k: round(float(L[L.cat == k].length.sum() / 1000), 1) for k in LAYERS},
           "p300_zmi": round(float(pop[zmi & near].sum() / pop[zmi].sum() * 100), 1), "u": out_u, "r": routes},
          open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(OUT, os.path.getsize(OUT) // 1000, "KB")
for n, v in sorted(out_u.items(), key=lambda x: -x[1]["km"]):
    print(f"{n:28s} {v['km']:6.2f} km  p300={v['p300']}  nv={v['nv']}")
