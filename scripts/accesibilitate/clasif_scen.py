"""Clasificarea cartierelor din Iași și a comunelor din ZMI după accesibilitatea la transportul public.
Adaptare a metodologiei Covăsnianu (2025, Ziarul de Iași) cu acces pietonal calculat în Madina (MIT City Form Lab, UNA)
și praguri din Legea 155/2023 privind mobilitatea urbană durabilă (art. 19, 21, 28).
"""
import geopandas as gpd, pandas as pd, numpy as np, openpyxl, sys, os
SCEN = sys.argv[1]  # existent | propus_v1 | propus_v2
os.chdir("/home/claude/clasif")

U = "/mnt/user-data/uploads/"
WB = U + "_World_Bank_/"
G = WB + "Baza_de_date/WB_Iasi_2025_GDB/"
ZDI = U + "ZIARUL_DE_IASI_EDITORIAL/03_10_2025/"

# ---------- units
cart = gpd.read_file(ZDI + "shp/pop_2020_cartiere_iasi.shp")
cart = cart[cart.denumire.notna()].dissolve("denumire").reset_index()[["denumire", "geometry"]]
cart["tip"] = "cartier"
uat = gpd.read_file(G + "ANCPI_Limite_administrative.gpkg", layer="ZM_Iasi_Unitate_administrativa_UAT")[["name", "geometry"]].to_crs(3844)
uat = uat[~uat["name"].isin(["IAŞI", "DOBROVĂŢ"])].rename(columns={"name": "denumire"})
uat["tip"] = "comună"
units = gpd.GeoDataFrame(pd.concat([cart, uat], ignore_index=True), crs=3844)

def nice(s):
    s = s.replace("Ş", "Ș").replace("ş", "ș").replace("Ţ", "Ț").replace("ţ", "ț")
    out = " ".join(w.capitalize() for w in s.lower().split(" "))
    out = "-".join(p[:1].upper() + p[1:] for p in out.split("-"))
    return out.replace("Cug", "CUG")
units["nume"] = units.denumire.map(nice)

# ---------- I1: acces pietonal (Madina, dist pe rețea la cea mai apropiată stație)
pop = gpd.read_file("/home/claude/prop/access_pop_prop.gpkg")
MEAS = {"existent": [], "propus_v1": ["a1_tren_v1", "b_trasee", "c_r1", "d_r2", "e_intermodal"], "propus_v2": ["a1_tren_v1", "a2_tren_aero", "b_trasee", "c_r1", "d_r2", "e_intermodal"]}[SCEN]
pop["dist_toate"] = pop[["dist_toate"] + [f"dist_{m}" for m in MEAS]].min(axis=1, skipna=True)
# stații de tren: rază de captare pietonală de 800 m (TOD, 400–800 m); autobuz/tramvai: 500 m (Legea 155/2023 art. 21 lit. d)
pop["dist_tren"] = pop[["dist_cf"] + [f"dist_{m}" for m in MEAS if m.startswith("a")]].min(axis=1, skipna=True)
pop["acoperit"] = (pop.dist_toate.fillna(9e9) <= 500) | (pop.dist_tren.fillna(9e9) <= 800)
j = gpd.sjoin(pop, units[["nume", "geometry"]], predicate="within")
def acc(g):
    P = g.pop2020.sum(); d = g.dist_toate
    w = g.pop2020.values; o = np.argsort(d.fillna(9e9).values); c = np.cumsum(w[o])
    med = d.fillna(9e9).values[o][np.searchsorted(c, P / 2)] if P > 0 else np.nan
    return pd.Series({"pop": P, "p500": g.pop2020[d <= 500].sum() / P * 100, "p800": g.pop2020[d <= 800].sum() / P * 100,
                      "pcov": g.pop2020[g.acoperit].sum() / P * 100,
                      "fara_1500": g.pop2020[d.isna()].sum(), "med_m": med if med < 9e9 else np.nan})
units = units.merge(j.groupby("nume").apply(acc).reset_index(), on="nume", how="left")

# ---------- lines (same definition as the Madina run) and stops
urb = gpd.read_file(WB + "shp/trasee_TP_ZMI.shp")
urb = urb[urb["route"].isin(["bus", "tram", "trolleybus"])]
urb = urb.assign(line=urb["route"].str[0] + ":" + urb["ref"].astype(str))[["line", "geometry"]]
met = gpd.read_file(WB + "shp/concept/trasee_TP_ZM_Iasi.shp")
met = met.assign(line="m:" + met["folders"].str.split("; ").str[-1].str.extract(r"(\d{3})")[0])[["line", "geometry"]]
met = met[met.line.notna()]
lines = gpd.GeoDataFrame(pd.concat([urb, met], ignore_index=True), crs=3844)
stops = gpd.read_file("/home/claude/zmi/data/stops_toate.geojson")[["geometry"]]
if MEAS:
    lp = gpd.read_file("/home/claude/prop/data/lines_prop.gpkg")
    keep = {"a1_tren_v1": "a1", "a2_tren_aero": "a2", "b_trasee": "b", "c_r1": "c", "d_r2": "d", "e_intermodal": "e"}
    lp = lp[lp.measure.isin([keep[m] for m in MEAS])][["line", "geometry"]]
    lines = gpd.GeoDataFrame(pd.concat([lines, lp], ignore_index=True), crs=3844)
    stops = gpd.GeoDataFrame(pd.concat([stops] + [gpd.read_file(f"/home/claude/prop/data/stops_{m}.geojson")[["geometry"]] for m in MEAS], ignore_index=True), crs=3844)
sl = gpd.sjoin(stops[["geometry"]].reset_index(names="sid"), lines.assign(geometry=lines.buffer(35)), predicate="within")[["sid", "line"]]

# I2: număr de linii distincte cu stații în unitate (buffer 150 m pentru străzile de limită)
ub = units[["nume", "geometry"]].copy(); ub["geometry"] = ub.buffer(150)
su = gpd.sjoin(stops[["geometry"]].reset_index(names="sid"), ub, predicate="within")[["sid", "nume"]]
lu = su.merge(sl, on="sid").drop_duplicates(["nume", "line"])
units["n_linii"] = units.nume.map(lu.groupby("nume").line.nunique()).fillna(0).astype(int)
units["n_statii"] = units.nume.map(su.groupby("nume").sid.nunique()).fillna(0).astype(int)

# I3: legătură directă cu nodurile intermodale (Gara Iași, Gara Nicolina, autogări Codreanu / Iași Vest)
from shapely.geometry import Point
nodes = {"Gara Iași": [Point(694894, 632739)], "Gara Nicolina": [Point(695694, 630792)],
         "Autogară": [Point(694968, 632894), Point(693686, 633610)]}
if MEAS:  # situația propusă: punctele intermodale MPM devin noduri de transfer; I3 = noduri atinse direct, plafonat la 3
    _pi = gpd.read_file("/home/claude/prop/data/stops_e_intermodal.geojson")
    for nm, g in zip(_pi["name"], _pi.geometry):
        if nm in ("Gara Mare", "Gara Nicolina"): continue  # identice cu Gara Iași / Gara Nicolina
        nodes["PI " + nm] = [g]
node_lines = {k: set(lines[lines.geometry.distance(v[0]) <= 400].line) | (set(lines[lines.geometry.distance(v[1]) <= 400].line) if len(v) > 1 else set())
              for k, v in nodes.items()}
def nodes_reached(n):
    L = set(lu[lu.nume == n].line)
    return [k for k, s in node_lines.items() if L & s]
units["noduri"] = units.nume.map(lambda n: ", ".join(x.replace("PI ", "") for x in nodes_reached(n)))
units["n_noduri"] = units.nume.map(lambda n: len(nodes_reached(n)))

# I4: dotări (școli + unități medicale) la max. 300 m pe jos de o stație — Legea 155/2023 art. 21 lit. b)
dot = gpd.read_file("dotari_dist.gpkg")
if MEAS:
    dp = gpd.read_file("/home/claude/prop/" + ("dotari_dist_prop_v1.gpkg" if SCEN == "propus_v1" else "dotari_dist_prop_v2.gpkg"))
    dot["dist_stop"] = np.fmin(dot["dist_stop"].values, dp["dist_prop"].values)
dj = gpd.sjoin(dot, units[["nume", "geometry"]], predicate="within")
units["n_dotari"] = units.nume.map(dj.groupby("nume").size()).fillna(0).astype(int)
units["p_dotari300"] = units.nume.map(dj.groupby("nume").apply(lambda g: (g.dist_stop <= 300).mean() * 100))

# I5 benzi dedicate, I6 velo — cartiere: Covăsnianu (2025); comune: fără benzi dedicate; velo din OSM (cycleway)
wb = openpyxl.load_workbook(ZDI + "analiza_multicriteriala_accesibilitate_cartiere_IASI.xlsx", data_only=False)
ws = wb.active
cov = {}
for r in ws.iter_rows(min_row=6, values_only=True):
    if r[2]:
        k = nice(r[2])
        pct = r[4] / r[3] * 100
        idx = (pct / 100 * .30 + r[10 - 0] / 21 * .25 if False else 0)
        n_bt = (r[8] or 0) + (r[9] or 0)
        cov[k] = dict(benzi=1 if str(r[18]).strip() == "DA" else 0, velo=1 if str(r[21]).strip() == "DA" else 0,
                      cov_index=round((pct / 100 * .30 + n_bt / 21 * .25 + r[16] * .15 + (1 if str(r[18]).strip() == "DA" else 0) * .10
                                       + (1 if str(r[21]).strip() == "DA" else 0) * .10 + (10.3 - r[24]) / 9.8 * .10) * 100, 1),
                      cov_10min=round(pct, 1))
roads = gpd.read_file(G + "OpenStreetMap.gpkg", layer="gis_osm_roads")
cyc = roads[roads.fclass == "cycleway"]
cyc_u = gpd.sjoin(cyc, units[["nume", "geometry"]], predicate="intersects").groupby("nume").size()
units["benzi"] = units.nume.map(lambda n: cov.get(n, {}).get("benzi", 0))
units["velo"] = [cov[n]["velo"] if n in cov else int(cyc_u.get(n, 0) > 0) for n in units.nume]
units["idx_2025"] = units.nume.map(lambda n: cov.get(n, {}).get("cov_index"))

# ---------- normalizare și indice (ponderi după Covăsnianu 2025; congestia nu e disponibilă în afara municipiului)
W = {"I1": .30, "I2": .25, "I3": .15, "I4": .10, "I5": .10, "I6": .10}
maxL = 30  # maximul din situația existentă (Centru), ca indicii să fie comparabili între scenarii
units["I1"] = units.pcov / 100  # 500 m autobuz/tramvai sau 800 m tren
units["I2"] = (units.n_linii / maxL).clip(upper=1)
units["I3"] = (units.n_noduri / 3).clip(upper=1)
units["I4"] = units.p_dotari300 / 100
units["I5"] = units.benzi
units["I6"] = units.velo
def score(r):
    num = sum(W[k] * r[k] for k in W if pd.notna(r[k])); den = sum(W[k] for k in W if pd.notna(r[k]))
    return num / den * 100
units["indice"] = units.apply(score, axis=1).round(1)
units["clasa"] = pd.cut(units.indice, [-1, 40, 70, 101], labels=["slabă", "medie", "bună"]).astype(str)
units.loc[units.n_statii == 0, "clasa"] = "fără date TP"
units["art21d_prag"] = np.where(units.p500 >= 60, "atins", "sub prag")
units["art21b_prag"] = np.where(units.n_dotari == 0, "fără dotări", np.where(units.p_dotari300 >= 100, "atins", "parțial"))
units = units.sort_values(["tip", "indice"], ascending=[True, False])
units.to_file(f"clasificare_accesibilitate_TP_{SCEN}.gpkg", driver="GPKG")
cols = ["tip", "nume", "pop", "pcov", "p500", "p800", "med_m", "fara_1500", "n_statii", "n_linii", "noduri", "n_dotari", "p_dotari300",
        "benzi", "velo", "I1", "I2", "I3", "I4", "I5", "I6", "indice", "clasa", "art21d_prag", "art21b_prag", "idx_2025"]
units[cols].to_csv(f"clasificare_accesibilitate_TP_{SCEN}.csv", index=False)
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
print(units[["tip", "nume", "pop", "p500", "n_linii", "n_noduri", "n_dotari", "p_dotari300", "benzi", "velo", "indice", "clasa", "idx_2025"]].round(1).to_string())
print("maxL", maxL, node_lines.keys(), {k: len(v) for k, v in node_lines.items()})
