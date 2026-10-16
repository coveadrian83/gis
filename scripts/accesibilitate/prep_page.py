import geopandas as gpd, pandas as pd, numpy as np, json, shapely

A = "/mnt/user-data/uploads/_World_Bank_/"
ADM = A + "Baza_de_date/WB_Iasi_2025_GDB/ANCPI_Limite_administrative.gpkg"
r5 = lambda v: round(float(v), 5)

zmi = gpd.read_file(ADM, layer="ZM_Iasi_Unitate_administrativa").union_all()
uat = gpd.read_file(ADM, layer="ZM_Iasi_Unitate_administrativa_UAT")[["name", "geometry"]].to_crs(3844)
p = gpd.read_file("access_pop_prop.gpkg")
p["zmi"] = p.within(zmi)
V1 = ["a1_tren_v1", "b_trasee", "c_r1", "d_r2", "e_intermodal"]; V2 = V1 + ["a2_tren_aero"]
p["d_v1"] = p[["dist_toate"] + [f"dist_{m}" for m in V1]].min(axis=1)
p["d_v2"] = p[["dist_toate"] + [f"dist_{m}" for m in V2]].min(axis=1)
COLS = ["dist_toate", "dist_tramvai", "dist_metropolitan", "d_v1", "d_v2"]
VIEWS = ["existent", "tramvai", "metropolitan", "propus_v1", "propus_v2"]
q = p.to_crs(4326)
p["tr_e"] = p["dist_cf"]
p["tr_v1"] = p[["dist_cf", "dist_a1_tren_v1"]].min(axis=1)
p["tr_v2"] = p[["dist_cf", "dist_a1_tren_v1", "dist_a2_tren_aero"]].min(axis=1)
TR = ["tr_e", "tr_v1", "tr_v2"]
rows = [[r5(g.x), r5(g.y), round(float(w), 1)] + [-1 if np.isnan(v) else int(v) for v in vals] + [int(z)] + [-1 if np.isnan(v) else int(v) for v in tv]
        for g, w, vals, z, tv in zip(q.geometry, q.pop2020, p[COLS].values, p.zmi, p[TR].values)]

def stats(d, w):
    P = w.sum(); dd = np.nan_to_num(d, nan=9e9); o = np.argsort(dd); c = np.cumsum(w[o]); med = dd[o][np.searchsorted(c, P / 2)]
    return dict(med=int(med), p300=round(float(w[dd <= 300].sum() / P * 100), 1), p500=round(float(w[dd <= 500].sum() / P * 100), 1),
                p800=round(float(w[dd <= 800].sum() / P * 100), 1), n500=int(w[dd <= 500].sum()), out=int(w[dd > 1500].sum()))
z = p[p.zmi]
ST = {v: stats(z[c].values, z.pop2020.values) for v, c in zip(VIEWS, COLS)}
for v, c, t in [("existent", "dist_toate", "tr_e"), ("propus_v1", "d_v1", "tr_v1"), ("propus_v2", "d_v2", "tr_v2"), ("tramvai", "dist_tramvai", None), ("metropolitan", "dist_metropolitan", None)]:
    a = z[c].fillna(9e9).values; tt = z[t].fillna(9e9).values if t else np.full(len(z), 9e9)
    ST[v]["pcov"] = round(float(z.pop2020.values[(a <= 500) | (tt <= 800)].sum() / z.pop2020.sum() * 100), 1)
MS = json.load(open("scen_stats.json"))
base = MS["existent"]
MEAS = [dict(k=k, gain=MS[k]["n500"] - base["n500"], gcov=MS[k]["ncov"] - base["ncov"], less=base["out"] - MS[k]["out"], p500=MS[k]["p500"], pcov=MS[k]["pcov"]) for k in ["a1", "a2", "b", "c", "d", "e", "propus_v1", "propus_v2"]]

# UAT table per scenario
j = gpd.sjoin(p, uat, predicate="within")
def nice(s):
    s = s.replace("Ş", "Ș").replace("ş", "ș").replace("Ţ", "Ț").replace("ţ", "ț")
    return " ".join(w.capitalize() for w in s.lower().split(" "))
UT = []
for n, g in j.groupby("name"):
    P = g.pop2020.sum()
    if P < 100: continue
    UT.append([nice(n), int(P)] + [[round(float(g.pop2020[g[c] <= 500].sum() / P * 100), 1), round(float(g.pop2020[g[c] <= 800].sum() / P * 100), 1), int(g.pop2020[g[c].isna()].sum())] for c in ["dist_toate", "d_v1", "d_v2"]])
UT.sort(key=lambda r: -r[1])

# stops
old = json.load(open("/home/claude/zmi/mapdata.json"))
ex_stops = [s for s in old["s"] if s[0] != "p"]  # [mode, lon, lat, lines, pop500, name]
MC = {"a1_tren_v1": "A1", "a2_tren_aero": "A2", "b_trasee": "B", "c_r1": "C", "d_r2": "D", "e_intermodal": "E"}
pst = []
mpm_b = gpd.read_file("/mnt/user-data/uploads/_World_Bank_/shp/concept/statii_TP_ZM_Iasi_propunere.shp")
for m, code in MC.items():
    g = gpd.read_file(f"data/stops_{m}.geojson")
    gen = [0] * len(g) if (m.startswith("a") or m.startswith("e")) else ([0] * len(mpm_b) + [1] * (len(g) - len(mpm_b)) if m == "b_trasee" else [1] * len(g))
    g = g.to_crs(4326)
    pst += [[code, r5(s.x), r5(s.y), gf, nm or ""] for s, gf, nm in zip(g.geometry, gen, g["name"])]

# routes: existing (from first page) + proposed
routes = old["r"]
lp = gpd.read_file("data/lines_prop.gpkg")
lp["geometry"] = shapely.force_2d(lp.geometry).simplify(8)
lp = lp.to_crs(4326).explode(index_parts=False)
KM = {"a1": "tm", "a2": "aero", "b": "prop", "c": "r1", "d": "r2"}
for r in lp.itertuples():
    if r.geometry.geom_type == "LineString" and r.geometry.length > 0:
        routes.append([KM[r.measure], [[r5(c[0]), r5(c[1])] for c in r.geometry.coords]])

cd = json.load(open("/home/claude/clasif/cdata.json"))
tdist = gpd.read_file("statii_tren_distante.gpkg")
TRAIN = [[r.name, r.v, int(r.urban), r.n1 if r.d1 < 1e5 else "", round(r.d1 / 1000, 2) if r.d1 < 1e5 else None, r.verdict if r.d1 < 1e5 else "fără date"] for r in tdist.itertuples()]
TRAIN.sort(key=lambda x: (x[1], -x[2], x[4] or 99))
DET = dict(train=TRAIN, b=rows, st=ST, meas=MEAS, ut=UT, s=ex_stops, ps=pst, r=routes, o=old["o"],
           bnd=[{"t": u["t"], "n": u["n"], "geo": u["geo"]} for u in cd["u"]])

# general scale: three scenarios
fix = {'Pacurari': 'Păcurari', 'Bularga-Zona Industriala': 'Bularga-Zona Industrială', 'Ticau-Sararie': 'Țicău-Sărărie', 'Aviatiei': 'Aviației',
       'Tatarasi': 'Tătărași', 'Alexandru Cel Bun': 'Alexandru cel Bun', 'Studentesc': 'Studențesc', 'Moara De Vant': 'Moara de Vânt'}
f1 = lambda v: None if pd.isna(v) else round(float(v), 1)
SC = {}
for s in ["existent", "propus_v1", "propus_v2"]:
    d = pd.read_csv(f"/home/claude/clasif/clasificare_accesibilitate_TP_{s}.csv")
    d["nume"] = d.nume.replace(fix)
    SC[s] = {r.nume: dict(pc=f1(r.pcov), p5=f1(r.p500), p8=f1(r.p800), med=f1(r.med_m), out=int(r.fara_1500), ns=int(r.n_statii), nl=int(r.n_linii),
                          nod=r.noduri if isinstance(r.noduri, str) else "", nd=int(r.n_dotari), pd=f1(r.p_dotari300),
                          I=[f1(getattr(r, k) * 100) if pd.notna(getattr(r, k)) else None for k in ["I1", "I2", "I3", "I4", "I5", "I6"]],
                          idx=f1(r.indice), c=r.clasa) for r in d.itertuples()}
GEN = dict(u=[dict(t=u["t"], n=u["n"], pop=u["pop"], b=u["b"], v=u["v"], old=u["old"], geo=u["geo"], sc={s: SC[s][u["n"]] for s in SC}) for u in cd["u"]],
           ias=cd["ias"])
json.dump(DET, open("det.json", "w"), separators=(",", ":"), ensure_ascii=False)
json.dump(GEN, open("gen.json", "w"), separators=(",", ":"), ensure_ascii=False)
import os
print(os.path.getsize("det.json") // 1000, os.path.getsize("gen.json") // 1000, "KB")
print(ST); print(MEAS); print(len(pst), "proposed stops")
