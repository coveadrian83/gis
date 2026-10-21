"""Frecvența transportului public (GTFS CTP) și bazinele de captare ale stațiilor de tren și punctelor intermodale.

Completează pagina /accesibilitate/ cu:
  - nivelul de serviciu la ≤ 500 m pentru fiecare celulă de 100 m (art. 21 lit. d din Legea 155/2023: o linie cu
    frecvență de cel mult 20 de minute), la vârful de dimineață (07–09) și în afara vârfului (10–14), zile lucrătoare;
  - unitatea (cartier / comună) în care cade fiecare celulă, pentru tabelele pe unități calculate în pagină;
  - bazinul de captare (locuitori la 500 / 800 m) și legăturile cu liniile existente (≤ 300 m) pentru stațiile
    trenului metropolitan și punctele intermodale propuse.

Distanța pe rețea până la o stație frecventă e estimată: distanța în linie dreaptă înmulțită cu factorul de ocol al
celulei (distanța Madina pe rețea / distanța în linie dreaptă până la cea mai apropiată stație, limitat la 1–2).
Când cea mai apropiată stație e și frecventă, valoarea e cea din Madina.

Rulare (doar numpy): python3 scripts/accesibilitate/frecventa.py
Intrări: public/accesibilitate/data/detaliu.json, data/transport/gtfs/IASI_GTFS.zip
Ieșire: public/accesibilitate/data/frecventa.json
"""
import csv, io, json, os, zipfile
from collections import Counter, defaultdict
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DET = os.path.join(ROOT, "public/accesibilitate/data/detaliu.json")
GTFS = os.path.join(ROOT, "data/transport/gtfs/IASI_GTFS.zip")
OUT = os.path.join(ROOT, "public/accesibilitate/data/frecventa.json")

LAT0, LON0 = 47.16, 27.59
KX, KY = 111320 * np.cos(np.radians(LAT0)), 110540
WEEKDAY = {"LV", "LD"}                      # LV = luni–vineri, LD = zilnic
WINDOWS = {"v": (7, 9), "o": (10, 14)}      # vârf de dimineață, în afara vârfului
HW = [10, 20, 30]                            # clase de interval (minute): ≤10, ≤20, ≤30, peste 30
DETOUR_DEFAULT = 1.3


def proj(lon, lat):
    return (np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY


def read(z, name):
    return list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig")))


# ---------- GTFS: cel mai bun interval pe stație (cea mai frecventă linie și sens), pe ferestre
z = zipfile.ZipFile(GTFS)
routes = {r["route_id"]: r for r in read(z, "routes.txt")}
trips = {r["trip_id"]: r for r in read(z, "trips.txt") if r["service_id"] in WEEKDAY}
stops = {r["stop_id"]: r for r in read(z, "stops.txt") if r.get("location_type", "0") in ("", "0")}
dep = {w: Counter() for w in WINDOWS}
per_stop_routes = defaultdict(set)
for r in read(z, "stop_times.txt"):
    t = trips.get(r["trip_id"])
    if not t or r["stop_id"] not in stops:
        continue
    per_stop_routes[r["stop_id"]].add(routes[t["route_id"]]["route_short_name"])
    h = int(r["departure_time"][:2])
    for w, (a, b) in WINDOWS.items():
        if a <= h < b:
            dep[w][(t["route_id"], t["direction_id"], r["stop_id"])] += 1
best = {w: defaultdict(int) for w in WINDOWS}      # plecări ale celei mai frecvente linii într-un sens
total = {w: defaultdict(int) for w in WINDOWS}     # toate plecările din stație
for w, c in dep.items():
    for (_, _, s), n in c.items():
        best[w][s] = max(best[w][s], n)
        total[w][s] += n
sid = [s for s in stops if s in per_stop_routes]
slon = np.array([float(stops[s]["stop_lon"]) for s in sid]); slat = np.array([float(stops[s]["stop_lat"]) for s in sid])
SX, SY = proj(slon, slat)
headway = {}
for w, (a, b) in WINDOWS.items():
    mins = (b - a) * 60
    headway[w] = np.array([mins / best[w][s] if best[w][s] else np.inf for s in sid])

# ---------- celule
D = json.load(open(DET))
B = np.array([r[:12] for r in D["b"]], dtype=float)
CX, CY = proj(B[:, 0], B[:, 1])
pop, net_any, zmi = B[:, 2], B[:, 3], B[:, 8] > 0
ES = np.array([[s[1], s[2]] for s in D["s"]])
EX, EY = proj(ES[:, 0], ES[:, 1])


def nearest(px, py, qx, qy, chunk=2000):
    out = np.empty(len(px))
    for i in range(0, len(px), chunk):
        d = np.hypot(px[i:i + chunk, None] - qx[None], py[i:i + chunk, None] - qy[None])
        out[i:i + chunk] = d.min(axis=1)
    return out


eu_any = nearest(CX, CY, EX, EY)
detour = np.where(net_any >= 0, net_any / np.maximum(eu_any, 1), DETOUR_DEFAULT)
detour = np.clip(detour, 1, 2)
print("factor de ocol median", round(float(np.median(detour[net_any >= 0])), 2))

cls = {}
for w in WINDOWS:
    c = np.full(len(B), 4, dtype=int)  # 4 = nicio stație cu serviciu la ≤ 500 m
    for k, lim in reversed(list(enumerate(HW + [np.inf]))):
        m = headway[w] <= lim if np.isfinite(lim) else np.isfinite(headway[w])
        if not m.any():
            continue
        est = nearest(CX, CY, SX[m], SY[m]) * detour
        c[est <= 500] = k
    cls[w] = c
    p = pop[zmi]; P = p.sum()
    print(w, {k: round(float(p[cls[w][zmi] == k].sum() / P * 100), 1) for k in range(5)})

# ---------- unitatea fiecărei celule (cartier înaintea comunei, ca în pagină)
def in_rings(px, py, rings):
    inside = np.zeros(len(px), bool)
    for ring in rings:
        rx, ry = proj([q[0] for q in ring], [q[1] for q in ring])
        j = len(rx) - 1
        for i in range(len(rx)):
            xi, yi, xj, yj = rx[i], ry[i], rx[j], ry[j]
            cond = ((yi > py) != (yj > py)) & (px < (xj - xi) * (py - yi) / np.where(yj - yi == 0, 1e-9, yj - yi) + xi)
            inside ^= cond
            j = i
    return inside


unit = np.full(len(B), -1, dtype=int)
order = sorted(range(len(D["bnd"])), key=lambda i: D["bnd"][i]["t"] != "cartier")
for i in order:
    m = (unit < 0) & in_rings(CX, CY, D["bnd"][i]["geo"])
    unit[m] = i
print("celule fără unitate", int((unit < 0).sum()), "locuitori", round(float(pop[unit < 0].sum())))

# ---------- bazine de captare: tren metropolitan și puncte intermodale
cat = []
for s in D["ps"]:
    if s[0] not in ("A1", "A2", "E"):
        continue
    x, y = proj(s[1], s[2])
    est = np.hypot(CX - x, CY - y) * detour
    near = np.hypot(SX - x, SY - y) <= 300
    lines = sorted(set().union(*[per_stop_routes[sid[i]] for i in np.flatnonzero(near)]) if near.any() else set(),
                   key=lambda v: (len(v), v))
    vh = sum(total["v"][sid[i]] for i in np.flatnonzero(near)) / (WINDOWS["v"][1] - WINDOWS["v"][0])
    cat.append([s[0], s[4] or "stație", int(round(pop[est <= 500].sum())), int(round(pop[est <= 800].sum())),
                len(lines), int(round(vh)), " ".join(lines)])

stops_out = [[round(float(lo), 5), round(float(la), 5), stops[s]["stop_name"],
              round(float(headway["v"][i]), 1) if np.isfinite(headway["v"][i]) else -1,
              round(float(headway["o"][i]), 1) if np.isfinite(headway["o"][i]) else -1,
              len(per_stop_routes[s])]
             for i, (s, lo, la) in enumerate(zip(sid, slon, slat))]
out = {"hw": HW, "win": WINDOWS, "fv": "".join(map(str, cls["v"])), "fo": "".join(map(str, cls["o"])),
       "u": unit.tolist(), "stops": stops_out, "cat": cat,
       "gtfs": z.infolist()[0].date_time[:3]}
json.dump(out, open(OUT, "w"), ensure_ascii=False, separators=(",", ":"))
print(OUT, os.path.getsize(OUT) // 1000, "KB;", len(sid), "stații GTFS;", len(cat), "puncte în bazine")
