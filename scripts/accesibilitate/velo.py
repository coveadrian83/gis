"""Rețeaua velo propusă prin Masterplanul Metropolitan 2026 (include Masterplanul de piste velo 2023) pentru /accesibilitate/.

Straturi (shapefile, folderul „2026” din Drive-ul MPM): R0_velo, R1_velo, R2_velo (inele), Radiale,
„Conexiuni si Alternative_velo” („(1)” e inclus integral în acesta și nu se folosește).

Pistele existente: doar cele declarate neconforme de IPJ Iași (piste_ciclabile_Iasi.shp, 62 de căi OSM, 43 km).
Coordonatele sunt Stereo 70 calculate direct din WGS84, fără transformarea de datum (decalaj de ~110 m față de
EPSG:3844), așa că se citesc cu elipsoidul Krasovski și datum WGS84.

Calculează, pe cartiere și comune:
  - km de pistă propusă în unitate, pe categorii;
  - I6 „Acces velo” = procentul de locuitori la ≤ 300 m pe jos de o pistă (linia dreaptă × factorul de ocol al
    celulei, ca în frecventa.py): pistele IPJ (situația existentă), pistele IPJ + rețeaua MPM (situația propusă)
    și doar rețeaua MPM (pagina permite excluderea pistelor neconforme). Pagina recalculează indicele și clasa.

Rulare: python3 scripts/accesibilitate/velo.py <folderul cu shapefile-urile MPM> <piste_ciclabile_Iasi.shp>
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
STEREO_FARA_DATUM = "+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=0,0,0,0,0,0,0 +units=m"
N = gpd.read_file(sys.argv[2]).set_crs(STEREO_FARA_DATUM, allow_override=True).to_crs(3844)
N["geometry"] = shapely.force_2d(N.geometry)
print("piste existente neconforme (IPJ):", round(float(N.length.sum() / 1000), 1), "km")
dist = lambda g: cells.sjoin_nearest(g[["geometry"]], distance_col="d").groupby(level=0).d.min().values
near_n = dist(N) * detour <= 300            # situația existentă
near_p = dist(L) * detour <= 300            # doar rețeaua MPM
near = near_n | near_p                      # situația propusă
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
    pct = lambda m: round(float(pop[idx][m[idx]].sum() / P * 100), 1) if P else 0.0
    out_u[u.n] = {"km": round(sum(km.values()), 2), "kc": km, "pn": pct(near_n), "p300": pct(near), "pp": pct(near_p)}
zmi = B[:, 8] > 0
zp = lambda m: round(float(pop[zmi & m].sum() / pop[zmi].sum() * 100), 1)
print("ZMI: locuitori la ≤ 300 m de o pistă: existent (IPJ)", zp(near_n), "%, propus", zp(near), "%, doar MPM", zp(near_p), "%")

L4 = L.copy()
L4["geometry"] = L4.simplify(5)
L4 = L4.to_crs(4326)
routes = [[r.cat, [[round(x, 5), round(y, 5)] for x, y in r.geometry.coords]] for r in L4.itertuples() if r.geometry.geom_type == "LineString"]
N4 = N.explode(index_parts=False); N4["geometry"] = N4.simplify(3); N4 = N4.to_crs(4326)
nc_routes = [[[round(x, 5), round(y, 5)] for x, y in g.coords] for g in N4.geometry if g.geom_type == "LineString"]
json.dump({"km": {k: round(float(L[L.cat == k].length.sum() / 1000), 1) for k in LAYERS},
           "km_n": round(float(N.length.sum() / 1000), 1), "pn_zmi": zp(near_n), "p300_zmi": zp(near), "pp_zmi": zp(near_p),
           "u": out_u, "r": routes, "rn": nc_routes},
          open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(OUT, os.path.getsize(OUT) // 1000, "KB")
for n, v in sorted(out_u.items(), key=lambda x: -x[1]["km"]):
    print(f"{n:28s} {v['km']:6.2f} km  existent={v['pn']:5.1f}%  propus={v['p300']:5.1f}%  doar MPM={v['pp']:5.1f}%")
