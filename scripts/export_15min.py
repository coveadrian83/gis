#!/usr/bin/env python3
"""Exportă rețeaua pietonală și facilitățile din OpenStreetMap pentru harta „15 minute. Pentru cine?” – Iași.

Adaptat după export_city.py din https://github.com/martincantcode/15-minutes
(© 2026 Martin Bangratz, licență MIT). Formatul binar al rețelei este același (versiunea 1).

Utilizare (pe calculatorul propriu sau automat, din GitHub Actions – .github/workflows/export-15min.yml):
    pip install osmnx
    python scripts/export_15min.py                       # Iași: pătrat de 2 × 9,5 km în jurul centrului
    python scripts/export_15min.py --radius 12000        # zonă mai mare (include localitățile limitrofe)
    python scripts/export_15min.py --overpass https://overpass.private.coffee/api

Rezultat, în public/15min/data/<slug>/:
    graph.bin   rețeaua de străzi și alei pietonale (binar, citit direct de pagină)
    pois.json   facilități, bănci de odihnă, stații de transport public
    meta.json   denumire, încadrare, punct de pornire, data exportului

Diferențe față de originalul din Köln:
  - stațiile includ, pe lângă gări și stațiile de tramvai, și stațiile de autobuz (highway=bus_stop);
    fiecare stație are un mod (1 = tren, 2 = tramvai, 3 = autobuz);
  - stațiile cu același nume și același mod, aflate la mai puțin de 300 m (cele două sensuri, peronul și
    poziția de oprire), sunt numărate o singură dată;
  - doar varianta „un singur fișier” (zona Iașului este suficient de mică), fără tăiere în dale.
"""
import argparse
import json
import math
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

CATS = ["Alimentație", "Sănătate", "Educație", "Parcuri și locuri de joacă", "Cafenele și restaurante",
        "Bănci de odihnă", "Stații de transport public"]
GROCERY = {"supermarket", "convenience", "greengrocer", "bakery", "butcher"}
HEALTH = {"pharmacy", "doctors", "clinic", "hospital", "dentist"}
EDUCATION = {"school", "kindergarten", "library"}
PARKS = {"park", "playground", "garden"}
EATING = {"cafe", "restaurant", "pub", "bar"}
WHEELCHAIR = {"yes": 1, "limited": 2, "no": 3}   # 0 = fără etichetă
MODE_TRAIN, MODE_TRAM, MODE_BUS = 1, 2, 3
STATION = 6

OVERPASS_SERVERS = ["https://overpass-api.de/api", "https://overpass.private.coffee/api",
                    "https://overpass.kumi.systems/api"]

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CENTER = (47.1563, 27.5842)   # centrul celor 17 zone MVA–MVI (Piața Unirii este la ~400 m)
DEFAULT_START = (47.16485, 27.58186)  # Piața Unirii – punctul de pornire al paginii


def categorize(tags):
    """(categorie, cod accesibilitate scaun rulant, mod) sau None. `tags` = dict de șiruri."""
    railway, highway = tags.get("railway"), tags.get("highway")
    if railway in ("station", "halt") and tags.get("station") not in ("subway", "light_rail", "funicular") \
            and tags.get("usage") not in ("industrial", "military") and tags.get("disused") != "yes":
        return STATION, WHEELCHAIR.get(tags.get("wheelchair"), 0), MODE_TRAIN
    if railway == "tram_stop":
        return STATION, WHEELCHAIR.get(tags.get("wheelchair"), 0), MODE_TRAM
    if highway == "bus_stop":
        return STATION, WHEELCHAIR.get(tags.get("wheelchair"), 0), MODE_BUS
    amenity, shop, leisure = tags.get("amenity"), tags.get("shop"), tags.get("leisure")
    if amenity == "bench":
        return 5, 0, 0
    if shop in GROCERY:
        return 0, 0, 0
    if amenity in HEALTH:
        return 1, 0, 0
    if amenity in EDUCATION:
        return 2, 0, 0
    if leisure in PARKS:
        return 3, 0, 0
    if amenity in EATING:
        return 4, 0, 0
    return None


def is_steps(highway):
    values = highway if isinstance(highway, (list, tuple)) else [highway]
    return "steps" in values


def step_kind(data):
    """0 = drum obișnuit, 1 = scări (barieră pentru cine nu poate urca scări),
    2 = scări cu rampă pentru scaun rulant (OSM ramp:wheelchair=yes), deci practicabile."""
    if not is_steps(data.get("highway")):
        return 0
    ramp = data.get("ramp:wheelchair")
    values = ramp if isinstance(ramp, (list, tuple)) else [ramp]
    return 2 if all(v == "yes" for v in values) else 1


def haversine_m(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12742000 * math.asin(math.sqrt(a))


def e5(value):
    return int(round(value * 1e5))


def build_graph_arrays(G, simplify_tol_deg=3e-5):
    """Graf networkx (OSMnx) → tablourile formatului binar.

    lonlat (int32, grade × 1e5), eu / ev (capetele muchiilor, uint32), lf (lungime în decimetri << 2 | flag,
    uint32), shape_start (uint32, muchii + 1), shape_arr (perechi lon/lat int32 – punctele intermediare).
    """
    nodes = list(G.nodes)
    index = {n: i for i, n in enumerate(nodes)}
    lonlat = np.array([(e5(G.nodes[n]["x"]), e5(G.nodes[n]["y"])) for n in nodes], dtype=np.int32).reshape(-1, 2)

    best = {}   # (nod mic, nod mare, tip) -> (lungime m, puncte intermediare mic -> mare)
    for u, v, _key, data in G.edges(keys=True, data=True):
        a, b = index[u], index[v]
        if a == b:
            continue
        kind = step_kind(data)
        length = data.get("length")
        if length is None:
            length = haversine_m(G.nodes[u]["x"], G.nodes[u]["y"], G.nodes[v]["x"], G.nodes[v]["y"])
        interior = []
        geom = data.get("geometry")
        if geom is not None:
            coords = list(geom.simplify(simplify_tol_deg, preserve_topology=False).coords)
            interior = [(e5(x), e5(y)) for x, y in coords[1:-1]]
            if a > b:
                interior.reverse()
        key = (min(a, b), max(a, b), kind)
        if key not in best or length < best[key][0]:
            best[key] = (float(length), interior)

    keys = sorted(best)
    n_edges = len(keys)
    eu = np.zeros(n_edges, dtype="<u4")
    ev = np.zeros(n_edges, dtype="<u4")
    lf = np.zeros(n_edges, dtype="<u4")
    shape_start = np.zeros(n_edges + 1, dtype="<u4")
    shape_pts = []
    for i, key in enumerate(keys):
        a, b, kind = key
        length, interior = best[key]
        eu[i], ev[i] = a, b
        lf[i] = (min(int(round(length * 10)), (1 << 30) - 1) << 2) | kind
        shape_pts.extend(interior)
        shape_start[i + 1] = len(shape_pts)
    shape_arr = np.array(shape_pts, dtype="<i4").reshape(-1, 2)
    return {"lonlat": lonlat, "eu": eu, "ev": ev, "lf": lf, "shape_start": shape_start, "shape_arr": shape_arr}


def graph_summary(a):
    lonlat = a["lonlat"]
    flags = a["lf"] & 3
    return {"nodes": len(lonlat), "edges": len(a["eu"]), "shape_points": len(a["shape_arr"]),
            "steps": int((flags == 1).sum()), "steps_with_wheelchair_ramp": int((flags == 2).sum()),
            "bbox": [float(lonlat[:, 0].min() / 1e5), float(lonlat[:, 1].min() / 1e5),
                     float(lonlat[:, 0].max() / 1e5), float(lonlat[:, 1].max() / 1e5)]}


def write_graph_bin(a, out_path):
    """Un singur fișier binar (versiunea 1), little endian: antet 4 × uint32 (versiune, noduri, muchii,
    puncte intermediare), apoi lon/lat noduri (int32), muchii de la / la / (lungime dm << 2 | flag) (uint32),
    începutul punctelor intermediare (uint32, muchii + 1) și punctele intermediare (perechi int32 lon/lat)."""
    with open(out_path, "wb") as f:
        f.write(struct.pack("<4I", 1, len(a["lonlat"]), len(a["eu"]), len(a["shape_arr"])))
        for arr in (a["lonlat"].astype("<i4"), a["eu"], a["ev"], a["lf"], a["shape_start"], a["shape_arr"]):
            f.write(arr.tobytes())


def merge_stations(stations, max_m=300):
    """Stațiile cu același mod și același nume, la mai puțin de max_m metri, devin una singură
    (cele două sensuri, peronul și poziția de oprire). Stațiile fără nume rămân separate."""
    groups = []   # fiecare: [suma lon, suma lat, n, mod, nume, set coduri]
    out = []
    for lon, lat, wc, mode, name in stations:
        key = (name or "").strip().lower()
        if not key:
            out.append([lon, lat, STATION, wc, mode])
            continue
        for g in groups:
            if g[3] == mode and g[4] == key and haversine_m(lon, lat, g[0] / g[2], g[1] / g[2]) <= max_m:
                g[0] += lon; g[1] += lat; g[2] += 1; g[5].add(wc)
                break
        else:
            groups.append([lon, lat, 1, mode, key, {wc}])
    for g in groups:
        codes = g[5] - {0}
        wc = codes.pop() if len(codes) == 1 else (2 if codes else 0)
        out.append([round(g[0] / g[2], 5), round(g[1] / g[2], 5), STATION, wc, g[3]])
    return out


def collect_pois(gdf):
    """Facilități din GeoDataFrame-ul OSMnx, ca liste [lon, lat, categorie, cod scaun rulant, mod]."""
    keep = [c for c in ("shop", "amenity", "leisure", "railway", "highway", "station", "usage", "disused",
                        "wheelchair", "name") if c in gdf.columns]
    pts, stations = [], []
    for _, row in gdf.iterrows():
        tags = {k: row[k] for k in keep if isinstance(row[k], str)}
        result = categorize(tags)
        geom = row.geometry
        if result is None or geom is None or geom.is_empty:
            continue
        p = geom if geom.geom_type == "Point" else geom.representative_point()
        cat, wc, mode = result
        if cat == STATION:
            stations.append((round(p.x, 5), round(p.y, 5), wc, mode, tags.get("name")))
        else:
            pts.append([round(p.x, 5), round(p.y, 5), cat, wc, mode])
    merged = merge_stations(stations)
    print("Stații: %d obiecte OSM → %d stații după unirea sensurilor" % (len(stations), len(merged)))
    return pts + merged


def with_servers(label, fn, servers):
    """Rulează o descărcare, trecând la următorul server Overpass dacă unul refuză."""
    import osmnx as ox
    last = None
    for attempt in range(2):
        for url in servers:
            ox.settings.overpass_url = url
            try:
                print("%s … (%s)" % (label, url), flush=True)
                return fn()
            except Exception as err:   # 429 / 504 / deconectare: încearcă alt server
                last = err
                print("  eșec: %s" % str(err)[:200], flush=True)
                time.sleep(20 * (attempt + 1))
    raise SystemExit("Toate serverele Overpass au refuzat cererea (%s). Reîncercați mai târziu." % last)


def main():
    ap = argparse.ArgumentParser(description="Exportă rețeaua pietonală și facilitățile pentru pagina 15 minute (Iași).")
    ap.add_argument("--slug", default="iasi", help="directorul de ieșire din public/15min/data/ (implicit iasi)")
    ap.add_argument("--name", default="Iași", help="denumirea afișată")
    ap.add_argument("--center", default="%.4f,%.4f" % DEFAULT_CENTER, help="lat,lon al centrului pătratului exportat")
    ap.add_argument("--start", default="%.5f,%.5f" % DEFAULT_START, help="lat,lon al punctului de pornire al paginii")
    ap.add_argument("--radius", type=int, default=9500, help="metri de la centru la fiecare latură (implicit 9500)")
    ap.add_argument("--overpass", help="server(e) Overpass, separate prin virgulă")
    args = ap.parse_args()

    def latlon(s, name):
        try:
            lat, lon = (float(x) for x in s.split(","))
            assert -90 <= lat <= 90 and -180 <= lon <= 180
            return lat, lon
        except (ValueError, AssertionError):
            ap.error('%s trebuie să arate ca "47.16,27.58" (latitudine,longitudine)' % name)
    center, start = latlon(args.center, "--center"), latlon(args.start, "--start")
    servers = args.overpass.split(",") if args.overpass else OVERPASS_SERVERS

    import osmnx as ox

    ox.settings.use_cache = True
    ox.settings.cache_folder = str(ROOT / "cache" / "osmnx")
    ox.settings.log_console = False
    ox.settings.requests_timeout = 300
    # osmnx renunță la majoritatea etichetelor; o păstrăm pe cea care marchează scările cu rampă
    ox.settings.useful_tags_way = sorted(set(ox.settings.useful_tags_way) | {"ramp:wheelchair"})
    out = ROOT / "public" / "15min" / "data" / args.slug
    out.mkdir(parents=True, exist_ok=True)
    tags = {"shop": sorted(GROCERY), "amenity": sorted(HEALTH | EDUCATION | EATING | {"bench"}),
            "leisure": sorted(PARKS), "railway": ["station", "halt", "tram_stop"], "highway": ["bus_stop"]}

    # facilitățile întâi: sunt partea pe care serverele gratuite o refuză cel mai des
    gdf = with_servers("Descarc facilitățile", lambda: ox.features_from_point(center, tags, dist=args.radius), servers)
    pts = collect_pois(gdf)
    counts = [sum(1 for p in pts if p[2] == c) for c in range(len(CATS))]
    print("Facilități:", len(pts), dict(zip(CATS, counts)))

    G = with_servers("Descarc rețeaua pietonală",
                     lambda: ox.graph_from_point(center, dist=args.radius, dist_type="bbox",
                                                 network_type="walk", simplify=False), servers)
    try:
        G = ox.simplify_graph(G, edge_attrs_differ=["highway", "ramp:wheelchair"])   # scările rămân muchii separate
    except TypeError:
        print("Atenție: această versiune OSMnx nu poate păstra scările separat; muchiile cu scări sunt blocate integral.")
        G = ox.simplify_graph(G)
    arrays = build_graph_arrays(G)
    stats = graph_summary(arrays)
    print("Rețea:", stats)
    print("Scări: %d care blochează traseele fără trepte, %d cu rampă pentru scaun rulant (practicabile)"
          % (stats["steps"], stats["steps_with_wheelchair_ramp"]))

    write_graph_bin(arrays, out / "graph.bin")
    with open(out / "pois.json", "w", encoding="utf-8") as f:
        json.dump({"cats": CATS, "pts": pts}, f, ensure_ascii=False, separators=(",", ":"))
    meta = {"name": args.name, "bbox": stats["bbox"], "start": list(start), "center": list(center),
            "radius_m": args.radius, "nodes": stats["nodes"], "edges": stats["edges"], "pois": len(pts),
            "counts": dict(zip(CATS, counts)), "steps": stats["steps"],
            "steps_with_wheelchair_ramp": stats["steps_with_wheelchair_ramp"],
            "osmnx": ox.__version__, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    with open(out / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    for name in ("graph.bin", "pois.json", "meta.json"):
        print(f"{name}: {(out / name).stat().st_size / 1e6:.2f} MB")
    print("Gata:", out)


if __name__ == "__main__":
    sys.exit(main())
