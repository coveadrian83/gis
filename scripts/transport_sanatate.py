#!/usr/bin/env python3
"""Planul de referință pentru harta „Sănătatea transportului public” (/transport/sanatate/).

Pozițiile GPS în timp real (Tranzy) se compară cu orarul GTFS CTP Iași. Pentru fiecare linie și sens (cheia
„route_id_direction_id”, aceeași cu trip_id-ul vehiculelor din Tranzy, ex. „8_1”), scriptul păstrează:
  - forma traseului, simplificată (din data/transport/linii/rute_gtfs.geojson – formele corectate, cu tramvaiele pe
    șine), și lungimea ei în metri;
  - șinele din depouri (OSM, data/transport/osm/sine.json), ca vehiculele garate să nu apară oprite pe linie;
  - cursele din orar pe tipul de serviciu din calendar.txt (ex. LV = luni–vineri, SD = weekend, LD = zilnic), ca
    perechi [plecare, sosire] în minute de la miezul nopții – din ele pagina află câte vehicule ar trebui să fie pe
    traseu acum, intervalul planificat și viteza comercială planificată.

Intrare: data/transport/gtfs/IASI_GTFS.zip, data/transport/linii/rute_gtfs.geojson (scripts/transport_gtfs.py).
Ieșire: public/data/transport/sanatate_plan.json

Doar biblioteca standard. Rulare: python scripts/transport_sanatate.py
"""
import csv
import io
import json
import math
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "data" / "transport" / "gtfs" / "IASI_GTFS.zip"
SHAPES = ROOT / "data" / "transport" / "linii" / "rute_gtfs.geojson"
OUT = ROOT / "public" / "data" / "transport" / "sanatate_plan.json"
RAILS = ROOT / "data" / "transport" / "osm" / "sine.json"     # scripts/transport_osm.py
PLANNING = ROOT / "data" / "transport" / "ctp_planificare.json"   # unitățile pe linie, din planificarea S.C.T.P.
UAT = ROOT / "public" / "data" / "zmi_uat_web.geojson"
TRANZY = ROOT / "data" / "transport" / "tranzy_rute.json"     # scripts/transport_tranzy.py (rutele curente din Tranzy)
TOL_M = 4.0           # toleranța simplificării formelor (Douglas–Peucker), în metri
R_LAT, R_LON = 110540.0, 111320.0
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def xy(p, lat0):
    return p[0] * R_LON * math.cos(math.radians(lat0)), p[1] * R_LAT


def length(coords):
    lat0 = coords[0][1]
    pts = [xy(p, lat0) for p in coords]
    return sum(math.dist(a, b) for a, b in zip(pts, pts[1:]))


def simplify(coords, tol=TOL_M):
    """Douglas–Peucker iterativ, pe coordonate în metri; păstrează capetele."""
    if len(coords) < 3:
        return coords
    lat0 = coords[0][1]
    pts = [xy(p, lat0) for p in coords]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = pts[a], pts[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
            d = math.hypot(px - ax - t * dx, py - ay - t * dy)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [c for c, k in zip(coords, keep) if k]


def minutes(t):
    h, m, s = (int(x) for x in t.split(":"))
    return h * 60 + m + s / 60


def network(ref):
    """Rețeaua liniilor fără formă în rute_gtfs.geojson: metropolitană = număr ≥ 100 (ca în transport_gtfs.py)."""
    digits = "".join(ch for ch in ref if ch.isdigit())
    return "metropolitan" if digits and int(digits) >= 100 else "local"


def table(z, name):
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def depots(path=RAILS):
    """Șinele din depouri (railway=tram cu service=yard / spur în OSM, ex. Depoul Gară): un tramvai mai aproape de ele
    decât de traseu e garat, nu oprit pe linie."""
    if not Path(path).exists():
        return []
    out = []
    for e in json.loads(Path(path).read_text(encoding="utf-8")).get("elements", []):
        t = e.get("tags", {})
        if e.get("type") == "way" and t.get("railway") == "tram" and t.get("service") in ("yard", "spur") and e.get("geometry"):
            out.append([[round(p["lon"], 5), round(p["lat"], 5)] for p in e["geometry"]])
    return out


def build(feed=FEED, shapes=SHAPES):
    z = zipfile.ZipFile(feed)
    cal = table(z, "calendar.txt")
    services = {c["service_id"]: [i for i, d in enumerate(DAYS) if c[d] == "1"] for c in cal}
    valid = {"de_la": min(c["start_date"] for c in cal), "pana_la": max(c["end_date"] for c in cal)}
    routes = {r["route_id"]: r for r in table(z, "routes.txt")}
    trips = {t["trip_id"]: t for t in table(z, "trips.txt")}

    span = {}                                           # trip_id -> [prima plecare, ultima sosire]
    with z.open("stop_times.txt") as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
            a, d = minutes(r["arrival_time"] or r["departure_time"]), minutes(r["departure_time"] or r["arrival_time"])
            s = span.get(r["trip_id"])
            if s is None:
                span[r["trip_id"]] = [d, a]
            else:
                s[0], s[1] = min(s[0], d), max(s[1], a)

    forms = {}
    for f in json.loads(Path(shapes).read_text(encoding="utf-8"))["features"]:
        key, g = f["properties"].get("gtfs_shape"), f["geometry"]
        if not key or g["type"] != "LineString":
            continue
        if key not in forms or len(g["coordinates"]) > len(forms[key][1]["coordinates"]):
            forms[key] = (f["properties"], g)

    curse = defaultdict(lambda: defaultdict(list))
    heads = defaultdict(lambda: defaultdict(int))
    for tid, t in trips.items():
        if tid not in span:
            continue
        key = f'{t["route_id"]}_{t["direction_id"] or 0}'
        a, b = span[tid]
        curse[key][t["service_id"]].append([round(a, 1), round(b, 1)])
        heads[key][t.get("trip_headsign") or ""] += 1

    out = {}
    for key in sorted(curse, key=lambda k: [int(x) if x.isdigit() else 0 for x in k.split("_")]):
        rid = key.rsplit("_", 1)[0]
        r = routes.get(rid, {})
        if key in forms:
            props, g = forms[key]
            coords = g["coordinates"]
        else:
            props, coords = {}, None
        rec = {
            "linie": r.get("route_short_name") or props.get("linie") or rid,
            "tip": "tramvai" if r.get("route_type") == "0" else "autobuz",
            "retea": props.get("retea") or network(r.get("route_short_name") or ""),
            "spre": max(heads[key].items(), key=lambda kv: kv[1])[0] if heads[key] else "",
            "culoare": "#" + (r.get("route_color") or "888888"),
            "curse": {s: sorted(v) for s, v in sorted(curse[key].items())},
        }
        if coords:
            rec["lungime"] = round(length(coords))
            rec["forma"] = [[round(x, 5), round(y, 5)] for x, y in simplify(coords)]
        out[key] = rec
    return {"sursa": "GTFS CTP Iași (Tranzy, https://tranzy.ai/opendata/)", "valabil": valid,
            "servicii": services, "rute": out, "depouri": depots(), "planificare": planning(), "municipiu": municipality(),
            "alias_rute": aliases(routes)}


def aliases(routes, path=TRANZY):
    """Codurile de rută din Tranzy (pozițiile GPS) care nu corespund rutei cu același cod din orarul GTFS → route_id-ul
    din orar al liniei cu același număr și tip (data/transport/tranzy_rute.json, scripts/transport_tranzy.py)."""
    if not Path(path).exists():
        return {}
    kind = lambda r: "tramvai" if r.get("route_type") == "0" else "autobuz"
    by_line = {(kind(r), (r.get("route_short_name") or "").strip().lower()): rid for rid, r in routes.items()}
    out = {}
    for tid, t in json.loads(Path(path).read_text(encoding="utf-8")).get("rute", {}).items():
        own = routes.get(tid)
        if own and (own.get("route_short_name") or "").strip().lower() == t["linie"].lower() and kind(own) == t["tip"]:
            continue                                     # același cod, aceeași linie
        gid = by_line.get((t["tip"], t["linie"].lower()))
        if gid and gid != tid:
            out[tid] = gid
    return dict(sorted(out.items(), key=lambda kv: (len(kv[0]), kv[0])))


def municipality(path=UAT):
    """Conturul municipiului Iași (SIRUTA 95060), simplificat: un autobuz fără linie recunoscută care nu iese din el e
    socotit pe rețeaua urbană (planificarea CTP acoperă municipiul; liniile metropolitane ies din oraș)."""
    if not Path(path).exists():
        return None
    for f in json.loads(Path(path).read_text(encoding="utf-8"))["features"]:
        if str(f["properties"].get("siruta_uat")) == "95060":
            g = f["geometry"]
            ring = g["coordinates"][0] if g["type"] == "Polygon" else max((p[0] for p in g["coordinates"]), key=len)
            return [[round(x, 5), round(y, 5)] for x, y in simplify(ring, 20.0)]
    return None


def planning(path=PLANNING):
    """Planificarea CTP (unități pe linie, pe tip de zi, ranforsări la vârf): referința pentru câte vehicule trebuie să
    fie pe stradă pe fiecare linie urbană; orarul GTFS rămâne referința pentru intervale, viteze și programul liniei."""
    if not Path(path).exists():
        return None
    p = json.loads(Path(path).read_text(encoding="utf-8"))
    keep = ("tip", "linie", "familie", "am", "pm", "ranf", "sambata", "duminica")
    return {"sursa": p["sursa"], "valabil_de_la": p["valabil_de_la"], "varf": p["varf"],
            "linii": [{k: l[k] for k in keep if k in l} for l in p["linii"]]}


def main(argv):
    plan = build(Path(argv[1]) if len(argv) > 1 else FEED)
    OUT.write_text(json.dumps(plan, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n = len(plan["rute"])
    fara = [k for k, v in plan["rute"].items() if "forma" not in v]
    print(f"{OUT.relative_to(ROOT)}: {n} linii-sens, {OUT.stat().st_size // 1024} KB"
          + (f"; fără formă: {', '.join(fara)}" if fara else ""))


if __name__ == "__main__":
    main(sys.argv)
