"""Rețeaua velo propusă prin Masterplanul Metropolitan 2026 (include Masterplanul de piste velo 2023) pentru /accesibilitate/.

Straturi (shapefile, folderul „2026” din Drive-ul MPM): R0_velo, R1_velo, R2_velo (inele), Radiale,
„Conexiuni si Alternative_velo” („(1)” e inclus integral în acesta și nu se folosește).

Pistele existente: din datele hărții de micromobilitate (OSM, highway=cycleway / bicycle=designated și străzile cu
cycleway=lane|track), public/micromobilitate/data/iasi/ – rază de 12 km în jurul Iașului; în afara ei (comunele
exterioare) nu există piste în OSM.

Calculează, pe cartiere și comune:
  - km de pistă propusă în unitate, pe categorii;
  - I6 „Acces velo” = procentul de locuitori la ≤ 300 m pe jos de o pistă (linia dreaptă × factorul de ocol al
    celulei, ca în frecventa.py): pistele existente (situația existentă) și existente + propuse (situația propusă).
    Pagina recalculează cu el indicele și clasa.

Pistele existente declarate neconforme de IPJ Iași (piste_ciclabile_Iasi.shp, 62 de căi OSM, 43 km): coordonatele sunt
Stereo 70 calculate direct din WGS84, fără transformarea de datum (decalaj de ~110 m față de EPSG:3844), așa că se
citesc cu elipsoidul Krasovski și datum WGS84. Situația existentă = piste OSM ∪ lista IPJ; se raportează separat
locuitorii la ≤ 300 m de o pistă neconformă și de una conformă (OSM, la peste 20 m de cele neconforme).

Rulare: python3 scripts/accesibilitate/velo.py <folderul cu shapefile-urile MPM> [<piste_ciclabile_Iasi.shp>]
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
MICRO = os.path.join(ROOT, "public/micromobilitate/data/iasi")
CLS_CYCLEWAY, F_LANE = 0, 1   # ca în scripts/export_micro15.py


def existing_cycleways():
    """Segmentele cu pistă din graph.bin + micro.bin (harta de micromobilitate), în EPSG:3844."""
    from shapely.geometry import LineString
    b = open(os.path.join(MICRO, "graph.bin"), "rb").read()
    _, nN, nE, nS = np.frombuffer(b, "<u4", 4)
    o = 16
    ll = np.frombuffer(b, "<i4", 2 * nN, o).reshape(-1, 2) / 1e5; o += 8 * nN
    eu = np.frombuffer(b, "<u4", nE, o); o += 4 * nE
    ev = np.frombuffer(b, "<u4", nE, o); o += 8 * nE          # sare peste lungimi
    ss = np.frombuffer(b, "<u4", nE + 1, o); o += 4 * (nE + 1)
    sp = np.frombuffer(b, "<i4", 2 * nS, o).reshape(-1, 2) / 1e5
    m = open(os.path.join(MICRO, "micro.bin"), "rb").read()
    cls = np.frombuffer(m, "u1", nE, 8); fl = np.frombuffer(m, "u1", nE, 8 + nE)
    sel = np.flatnonzero((cls == CLS_CYCLEWAY) | (fl & F_LANE > 0))
    geoms = [LineString([ll[eu[i]], *sp[ss[i]:ss[i + 1]], ll[ev[i]]]) for i in sel]
    g = gpd.GeoDataFrame(geometry=geoms, crs=4326).to_crs(3844)
    return g[g.length > 1].drop_duplicates("geometry")


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
E = existing_cycleways()
print("piste existente (OSM):", round(float(E.length.sum() / 1000), 1), "km")
STEREO_FARA_DATUM = "+proj=sterea +lat_0=46 +lon_0=25 +k=0.99975 +x_0=500000 +y_0=500000 +ellps=krass +towgs84=0,0,0,0,0,0,0 +units=m"
N = gpd.read_file(sys.argv[2]).set_crs(STEREO_FARA_DATUM, allow_override=True).to_crs(3844) if len(sys.argv) > 2 else E.iloc[:0]
N["geometry"] = shapely.force_2d(N.geometry)
C = E[E.distance(N.union_all()) > 20] if len(N) else E   # piste OSM care nu sunt pe lista IPJ
print("neconforme (IPJ):", round(float(N.length.sum() / 1000), 1), "km; conforme rămase:", round(float(C.length.sum() / 1000), 1), "km")
dist = lambda g: cells.sjoin_nearest(g[["geometry"]], distance_col="d").groupby(level=0).d.min().values if len(g) else np.full(len(cells), np.inf)
eu_prop, eu_n, eu_c = dist(L), dist(N), dist(C)
near_n = eu_n * detour <= 300
near_c = eu_c * detour <= 300
near_e = near_n | near_c
near = near_e | (eu_prop * detour <= 300)
near_pc = near_c | (eu_prop * detour <= 300)   # propus, fără pistele neconforme
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
    out_u[u.n] = {"km": round(sum(km.values()), 2), "kc": km, "pe": pct(near_e), "pc": pct(near_c), "pn": pct(near_n),
                  "p300": pct(near), "ppc": pct(near_pc)}
zmi = B[:, 8] > 0
zp = lambda m: round(float(pop[zmi & m].sum() / pop[zmi].sum() * 100), 1)
print("ZMI: locuitori la ≤ 300 m de o pistă: existent", zp(near_e), "% (conformă", zp(near_c), "%, neconformă", zp(near_n),
      "%), cu rețeaua propusă", zp(near), "%")

L4 = L.copy()
L4["geometry"] = L4.simplify(5)
L4 = L4.to_crs(4326)
routes = [[r.cat, [[round(x, 5), round(y, 5)] for x, y in r.geometry.coords]] for r in L4.itertuples() if r.geometry.geom_type == "LineString"]
E4 = E.copy(); E4["geometry"] = E4.simplify(5); E4 = E4.to_crs(4326)
ex_routes = [[[round(x, 5), round(y, 5)] for x, y in g.coords] for g in E4.geometry if g.geom_type == "LineString"]
N4 = N.explode(index_parts=False); N4["geometry"] = N4.simplify(3); N4 = N4.to_crs(4326)
nc_routes = [[[round(x, 5), round(y, 5)] for x, y in g.coords] for g in N4.geometry if g.geom_type == "LineString"]
json.dump({"km": {k: round(float(L[L.cat == k].length.sum() / 1000), 1) for k in LAYERS},
           "km_ex": round(float(E.length.sum() / 1000), 1), "km_n": round(float(N.length.sum() / 1000), 1),
           "km_c": round(float(C.length.sum() / 1000), 1), "pe_zmi": zp(near_e), "pc_zmi": zp(near_c), "pn_zmi": zp(near_n),
           "p300_zmi": zp(near), "ppc_zmi": zp(near_pc), "u": out_u, "r": routes, "re": ex_routes, "rn": nc_routes},
          open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(OUT, os.path.getsize(OUT) // 1000, "KB")
for n, v in sorted(out_u.items(), key=lambda x: -x[1]["km"]):
    print(f"{n:28s} {v['km']:6.2f} km  existent={v['pe']:5.1f}% (conf. {v['pc']:5.1f}%, neconf. {v['pn']:5.1f}%)  propus={v['p300']:5.1f}%")
