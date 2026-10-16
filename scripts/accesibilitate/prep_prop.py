"""Proposed scenario (Masterplan Metropolitan Iași): stop sets per measure, line geometries.
a1) tren metropolitan V1 (traseu CF existent)   a2) extindere aeroport (V2)
b)  trasee TP propuse (concept)                 c) inel periurban prioritar R1    d) inel metropolitan de perspectivă R2
Stops on b/c/d where the MPM gives none: generated every 400 m (Legea 155/2023 art. 21 lit. c), skipped within 300 m
of an existing or already proposed stop (that stop would serve the new line).
"""
import geopandas as gpd, pandas as pd, numpy as np, shapely
from shapely.ops import linemerge, unary_union

U = "/root/.claude/uploads/2660f749-2d31-5fcd-9e56-11db72dd0f16/"
IM = U + "708197cf-Infrastructura_Mobilitate.gpkg"
C = "/mnt/user-data/uploads/_World_Bank_/shp/concept/"
STEP, SKIP = 400, 300

def f2d(g):
    g = g.copy(); g["geometry"] = shapely.force_2d(g.geometry); return g

existing = gpd.read_file("/home/claude/zmi/data/stops_toate.geojson")

# a) tren metropolitan
st = f2d(gpd.read_file(IM, layer="Tren_Metropolitan_Statii"))
v1 = st[st.Layer.notna() | st.Name.isin(["Aumovio", "Trei Fantani"])][["Name", "geometry"]].rename(columns={"Name": "name"})
ae = f2d(gpd.read_file(IM, layer="Tren_Metropolitan_Extindere_Aeroport_Statii_V1"))
ae = ae[ae.geometry.notna() & ~ae.geometry.is_empty][["Name", "geometry"]].rename(columns={"Name": "name"})
ae["name"] = ae["name"].str.strip().replace("", "Aeroport Nord")
tv1 = f2d(gpd.read_file(IM, layer="Tren_Metropolitan_Traseu"))[["geometry"]]
tae = f2d(pd.concat([gpd.read_file(IM, layer="Tren_Metropolitan_Extindere_Aeroport_Traseu_V1")[["geometry"]],
                     gpd.read_file(IM, layer="Tren_Metropolitan_Extindere_Aeroport_Traseu_Subteran_V1")[["geometry"]]]))

# b) trasee propuse + stații MPM
pr = f2d(gpd.read_file(C + "trasee_TP_ZM_Iasi_propunere.shp"))[["geometry"]]
ps = f2d(gpd.read_file(C + "statii_TP_ZM_Iasi_propunere.shp"))[["denumire", "geometry"]].rename(columns={"denumire": "name"})
# c, d) inele
r1 = f2d(gpd.read_file(U + "56309079-traseu_inelar_TP_metropolitan_prioritar_R1.gpkg").to_crs(3844))[["geometry"]]
r2 = f2d(gpd.read_file(U + "b779087a-traseu_inelar_TP_metropolitan_de_perspectiva.gpkg").to_crs(3844))[["geometry"]]

def gen_stops(lines, avoid):
    avoid_u = unary_union(list(avoid.geometry)) if len(avoid) else None
    geoms = [shapely.remove_repeated_points(g, 0.01) for g in lines.explode(index_parts=False).geometry if g is not None and g.length > 1]
    merged = linemerge([g for g in geoms if g.length > 1])
    parts = list(getattr(merged, "geoms", [merged]))
    out = []
    for g in parts:
        for t in np.arange(0, g.length + 1, STEP):
            p = g.interpolate(min(t, g.length))
            if avoid_u is not None and avoid_u.distance(p) < SKIP: continue
            if out and min(q.distance(p) for q in out[-50:]) < SKIP: continue
            out.append(p)
    return gpd.GeoDataFrame({"name": [""] * len(out)}, geometry=out, crs=3844)

ps_all = pd.concat([ps, gen_stops(pr, pd.concat([existing[["geometry"]], ps[["geometry"]]]))], ignore_index=True)
ps_all = gpd.GeoDataFrame(ps_all, crs=3844)
r1s = gen_stops(r1, pd.concat([existing[["geometry"]], ps_all[["geometry"]]]))
r2s = gen_stops(r2, pd.concat([existing[["geometry"]], ps_all[["geometry"]], r1s[["geometry"]]]))

SETS = {"a1_tren_v1": (v1, "tren metropolitan V1"), "a2_tren_aero": (ae, "tren metropolitan V2 aeroport"),
        "b_trasee": (ps_all, "traseu TP propus"), "c_r1": (r1s, "inel R1"), "d_r2": (r2s, "inel R2")}
for k, (g, mode) in SETS.items():
    g = gpd.GeoDataFrame(g.assign(mode=mode).reset_index(drop=True), crs=3844)
    g["name"] = g["name"].fillna("")
    g.to_file(f"data/stops_{k}.geojson", driver="GeoJSON")
    print(k, len(g), "(MPM: %d)" % (len(ps) if k == "b_trasee" else len(g) if k.startswith("a") else 0))

# lines for maps / line counts: proposed routes split into connected components
comp = linemerge([g for g in pr.explode(index_parts=False).geometry if g.length > 1])
comp_parts = list(getattr(comp, "geoms", [comp]))
# group touching parts (within 25 m) into lines
groups = []
for g in comp_parts:
    hit = [i for i, G in enumerate(groups) if G.distance(g) < 25]
    if not hit: groups.append(g)
    else:
        merged = unary_union([groups[i] for i in hit] + [g])
        groups = [G for i, G in enumerate(groups) if i not in hit] + [merged]
L = []
for i, g in enumerate(groups): L.append(("b", f"p:{i+1}", g))
L += [("a1", "tm:V1", unary_union(list(tv1.geometry))), ("a2", "tm:AERO", unary_union(list(tae.geometry))),
      ("c", "r:R1", shapely.MultiLineString([g for g in r1.explode(index_parts=False).geometry if g.length > 1])), ("d", "r:R2", unary_union(list(r2.geometry)))]
lines = gpd.GeoDataFrame({"measure": [x[0] for x in L], "line": [x[1] for x in L]}, geometry=[x[2] for x in L], crs=3844)
lines.to_file("data/lines_prop.gpkg", driver="GPKG")
print(lines.assign(km=(lines.length / 1000).round(1)).drop(columns="geometry").to_string())
