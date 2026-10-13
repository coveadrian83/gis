#!/usr/bin/env python3
"""Exportă rețeaua pentru harta „15 minute pe două roți” – Iași (bicicletă, bicicletă electrică, trotinetă electrică).

Pornește de la scripts/export_15min.py (rețeaua pietonală, adaptată după https://github.com/martincantcode/15-minutes,
licență MIT) și păstrează, pentru fiecare segment, ce contează pentru regulile de circulație din Codul rutier:
tipul drumului, pistele pentru biciclete, limita de viteză, sensul unic (și excepțiile pentru biciclete),
interdicțiile (bicycle=no / dismount, foot=no) și îmbrăcămintea (piatră cubică, neasfaltat).
Regulile propriu-zise (cine pe unde are voie) se aplică în pagină – public/micromobilitate/micro.js –
ca să poată fi comparate cu varianta „fără restricții” și cu mersul pe jos.

Utilizare (automat din GitHub Actions – .github/workflows/export-micro15.yml – sau pe calculatorul propriu):
    pip install osmnx
    python scripts/export_micro15.py                      # Iași: pătrat de 2 × 12 km în jurul centrului
    python scripts/export_micro15.py --xml harta.osm      # dintr-un fișier OSM XML (fără Overpass; teste)
    python scripts/elevatie_15min.py --dir public/micromobilitate/data/iasi   # panta (elev.bin)

Rezultat, în public/micromobilitate/data/<slug>/:
    graph.bin   rețeaua (același format ca harta pietonală, versiunea 1)
    micro.bin   atributele segmentelor (formatul este descris la write_micro_bin)
    edges.json  denumire, incline, step_count – pentru scripts/elevatie_15min.py
    pois.json   facilități, parcări și închirieri de biciclete / trotinete, stații de transport public
    meta.json   denumire, încadrare, kilometri pe tipuri de infrastructură, data exportului
"""
import argparse
import json
import struct
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import export_15min as w15  # noqa: E402  (aceleași categorii, aceeași scriere a rețelei)

ROOT = w15.ROOT

# ---------------------------------------------------------------- facilitățile
CATS = ["Alimentație", "Sănătate", "Educație", "Parcuri și locuri de joacă", "Cafenele și restaurante",
        "Parcări pentru biciclete", "Stații de transport public", "Închiriere biciclete / trotinete"]
BIKE_PARKING, STATION, RENTAL = 5, 6, 7
RENTAL_AMENITIES = {"bicycle_rental", "kick-scooter_rental", "scooter_rental"}

# ---------------------------------------------------------------- clasele de segmente (micro.bin)
CLS_CYCLEWAY = 0    # pistă pentru biciclete: highway=cycleway sau bicycle=designated (indicator)
CLS_SHARED = 1      # alee / trotuar unde bicicletele sunt permise explicit (bicycle=yes), fără pistă
CLS_PATH = 2        # path, track, bridleway: bicicleta este permisă implicit în România (OSM)
CLS_LOCAL = 3       # străzi locale: residential, living_street, service, unclassified, road
CLS_TERTIARY = 4
CLS_SECONDARY = 5
CLS_PRIMARY = 6
CLS_TRUNK = 7
CLS_MOTORWAY = 8    # autostradă / drum expres: interzis bicicletelor și trotinetelor (și pietonilor)
CLS_FOOTWAY = 9     # trotuar, zonă pietonală, alee pietonală: doar pe jos (vehiculul se împinge)
CLS_STEPS = 10      # scări
CLS_NOBIKE = 11     # drum cu bicycle=no / dismount: doar pe jos
CLASS_NAMES = ["pistă pentru biciclete", "alee comună (bicicleta permisă)", "alee / drum de pământ",
               "stradă locală", "stradă terțiară", "stradă secundară", "stradă principală", "drum național (trunk)",
               "autostradă / drum expres", "trotuar / zonă pietonală", "scări", "drum interzis bicicletelor"]

F_LANE = 1          # stradă cu bandă / pistă pentru biciclete (cycleway=lane|track, inclusiv pe o parte)
F_NOFOOT = 2        # foot=no (nici împins de mână)
F_SETT = 4          # piatră cubică / bolovani (sett, cobblestone, unhewn_cobblestone)
F_UNPAVED = 8       # neasfaltat (gravel, dirt, ground, grass, compacted …)
ONEWAY_SHIFT = 5    # biții 5–6: 0 = ambele sensuri, 1 = doar nod mic → nod mare, 2 = doar invers (pentru vehicule)

ROAD_CLASS = {"residential": CLS_LOCAL, "living_street": CLS_LOCAL, "service": CLS_LOCAL, "unclassified": CLS_LOCAL,
              "road": CLS_LOCAL, "busway": CLS_LOCAL, "tertiary": CLS_TERTIARY, "tertiary_link": CLS_TERTIARY,
              "secondary": CLS_SECONDARY, "secondary_link": CLS_SECONDARY, "primary": CLS_PRIMARY,
              "primary_link": CLS_PRIMARY, "trunk": CLS_TRUNK, "trunk_link": CLS_TRUNK,
              "motorway": CLS_MOTORWAY, "motorway_link": CLS_MOTORWAY}
FOOT_HIGHWAYS = {"footway", "pedestrian", "corridor", "platform", "elevator"}
PATH_HIGHWAYS = {"path", "track", "bridleway"}
SETT = {"sett", "cobblestone", "unhewn_cobblestone", "cobblestone:flattened"}
UNPAVED = {"unpaved", "gravel", "fine_gravel", "pebblestone", "dirt", "earth", "ground", "grass", "sand", "mud",
           "compacted", "woodchips", "grass_paver", "rock"}
YES = {"yes", "designated", "permissive", "official", "destination"}
ONEWAY_YES = {"yes", "true", "1", "-1", "reverse"}
LANE_VALUES = {"lane", "track", "opposite_lane", "opposite_track", "separate"}

WAY_TAGS = ["highway", "bicycle", "foot", "oneway", "oneway:bicycle", "junction", "cycleway", "cycleway:left",
            "cycleway:right", "cycleway:both", "cycleway:left:oneway", "cycleway:right:oneway", "cycleway:both:oneway",
            "maxspeed", "surface", "footway", "segregated", "motorroad", "ramp:wheelchair", "ramp:bicycle",
            "incline", "step_count"]

# Rețeaua: tot ce este practicabil pe jos (osmnx „walk”) plus tot ce este practicabil cu bicicleta (osmnx „bike”).
# Străzile cu trotuarele cartografiate separat (sidewalk=separate) intră prin filtrul pentru biciclete.
DEFAULT_ACCESS = '["access"!~"private"]'
WALK_FILTER = ('["highway"]["area"!~"yes"]' + DEFAULT_ACCESS +
               '["highway"!~"abandoned|bus_guideway|construction|cycleway|motor|no|planned|platform|proposed|'
               'raceway|razed|rest_area|services"]["foot"!~"no"]["service"!~"private"]')
BIKE_FILTER = ('["highway"]["area"!~"yes"]' + DEFAULT_ACCESS +
               '["highway"!~"abandoned|bus_guideway|construction|corridor|elevator|escalator|footway|motor|no|'
               'planned|platform|proposed|raceway|razed|rest_area|services|steps"]["bicycle"!~"no"]'
               '["service"!~"private"]')


def tag(data, key):
    """Prima valoare text a etichetei (osmnx pune liste când segmentele unite au valori diferite)."""
    return (w15.first_str(data.get(key)) or "").strip().lower()


def parse_maxspeed(value):
    """Eticheta OSM maxspeed → km/h (0 = necunoscută). Acceptă „50”, „30 mph”, „RO:urban”, „RO:rural”, „walk”."""
    v = (value or "").strip().lower()
    if not v:
        return 0
    if v in ("ro:urban", "ro:living_street"):
        return 50 if v == "ro:urban" else 20
    if v in ("ro:rural", "ro:trunk"):
        return 90 if v == "ro:rural" else 100
    if v == "ro:motorway":
        return 130
    if v == "walk":
        return 5
    try:
        num = float(v.split()[0].split(";")[0])
    except ValueError:
        return 0
    if "mph" in v:
        num *= 1.609
    return max(0, min(250, int(round(num))))


def classify(data):
    """(clasa, flaguri fără sens unic) pentru un segment, din etichetele OSM păstrate de osmnx."""
    hw = tag(data, "highway")
    bicycle, foot = tag(data, "bicycle"), tag(data, "foot")
    flags = 0
    if foot == "no" or (hw == "cycleway" and foot not in YES):
        flags |= F_NOFOOT
    surface = tag(data, "surface")
    if surface in SETT:
        flags |= F_SETT
    elif surface in UNPAVED or (hw == "track" and not surface):
        flags |= F_UNPAVED
    if hw == "steps":
        return CLS_STEPS, flags
    if hw in ROAD_CLASS:
        cls = ROAD_CLASS[hw]
        if tag(data, "motorroad") == "yes":
            cls = CLS_MOTORWAY
        if cls == CLS_MOTORWAY:
            return cls, flags | F_NOFOOT
        if bicycle in ("no", "dismount", "use_sidepath"):
            return CLS_NOBIKE, flags
        for k in ("cycleway", "cycleway:both", "cycleway:left", "cycleway:right"):
            if tag(data, k) in LANE_VALUES:
                flags |= F_LANE
        return cls, flags
    if hw == "cycleway" or bicycle == "designated":
        return CLS_CYCLEWAY, flags
    if bicycle in ("no", "dismount"):
        return (CLS_FOOTWAY if hw in FOOT_HIGHWAYS or hw in PATH_HIGHWAYS else CLS_NOBIKE), flags
    if hw in FOOT_HIGHWAYS:
        return (CLS_SHARED if bicycle in YES else CLS_FOOTWAY), flags
    if hw in PATH_HIGHWAYS:
        return CLS_PATH, flags
    return CLS_FOOTWAY, flags


def bike_oneway(data):
    """True dacă vehiculele (bicicletă, trotinetă) pot circula doar în sensul segmentului osmnx.

    Exportul folosește osmnx cu all_oneway = True: fiecare segment apare o singură dată, în ordinea nodurilor
    din calea OSM (inversată pentru oneway=-1), deci sensul permis este mereu u → v."""
    ow, owb = tag(data, "oneway"), tag(data, "oneway:bicycle")
    oneway = ow in ONEWAY_YES or tag(data, "junction") in ("roundabout", "circular")
    if ow == "no":
        oneway = False
    if owb == "no":
        return False
    if owb in ("yes", "1", "true"):
        return True
    if not oneway:
        return False
    for k in ("cycleway", "cycleway:both", "cycleway:left", "cycleway:right"):
        if tag(data, k).startswith("opposite"):
            return False
    for k in ("cycleway:both:oneway", "cycleway:left:oneway", "cycleway:right:oneway"):
        if tag(data, k) in ("no", "-1"):
            return False
    return True


def way_reversed(data):
    """Segmentul are nodurile în ordine inversă față de calea OSM (oneway=-1 / reverse)."""
    return tag(data, "oneway") in ("-1", "reverse")


def build_arrays(G, simplify_tol_deg=3e-5):
    """Graful osmnx (un segment pe sens permis al căii OSM) → tablourile graph.bin + atributele micro.bin."""
    nodes = list(G.nodes)
    index = {n: i for i, n in enumerate(nodes)}
    lonlat = np.array([(w15.e5(G.nodes[n]["x"]), w15.e5(G.nodes[n]["y"])) for n in nodes], dtype=np.int32).reshape(-1, 2)
    best, tags = {}, {}
    for u, v, _k, data in G.edges(keys=True, data=True):
        a, b = index[u], index[v]
        if a == b:
            continue
        kind = w15.step_kind(data)
        cls, flags = classify(data)
        if cls == CLS_STEPS and kind == 0:
            kind = 1
        ow = 0
        if bike_oneway(data):
            ow = 1 if a < b else 2
        length = data.get("length")
        if length is None:
            length = w15.haversine_m(G.nodes[u]["x"], G.nodes[u]["y"], G.nodes[v]["x"], G.nodes[v]["y"])
        interior = []
        geom = data.get("geometry")
        if geom is not None:
            coords = list(geom.simplify(simplify_tol_deg, preserve_topology=False).coords)
            interior = [(w15.e5(x), w15.e5(y)) for x, y in coords[1:-1]]
            if a > b:
                interior.reverse()
        speed = parse_maxspeed(tag(data, "maxspeed"))
        # aceeași pereche de noduri poate apărea de două ori (ex. două căi OSM suprapuse): se păstrează ambele
        # dacă diferă clasa sau sensul unic, altfel cea mai scurtă
        key = (min(a, b), max(a, b), kind, cls, ow, flags)
        if key not in best or length < best[key][0]:
            best[key] = (float(length), interior, speed)
        info = tags.setdefault(key, {})
        name = w15.first_str(data.get("name"))
        if name and "name" not in info:
            info["name"] = name
        if "incline" not in info:
            inc = w15.parse_incline(data.get("incline"))
            if inc is not None:
                along_low_high = (a < b) != way_reversed(data)   # sensul căii OSM coincide cu nod mic → nod mare
                info["incline"] = inc if along_low_high else -inc
        steps = w15.first_str(data.get("step_count"))
        if steps and "step_count" not in info:
            try:
                info["step_count"] = max(0, int(float(steps)))
            except ValueError:
                pass

    keys = sorted(best)
    n = len(keys)
    eu, ev, lf = np.zeros(n, "<u4"), np.zeros(n, "<u4"), np.zeros(n, "<u4")
    cls_arr, flag_arr, spd_arr = np.zeros(n, "u1"), np.zeros(n, "u1"), np.zeros(n, "u1")
    shape_start = np.zeros(n + 1, "<u4")
    shape_pts = []
    for i, key in enumerate(keys):
        a, b, kind, cls, ow, flags = key
        length, interior, speed = best[key]
        eu[i], ev[i] = a, b
        lf[i] = (min(int(round(length * 10)), (1 << 30) - 1) << 2) | kind
        cls_arr[i], flag_arr[i], spd_arr[i] = cls, flags | (ow << ONEWAY_SHIFT), speed
        shape_pts.extend(interior)
        shape_start[i + 1] = len(shape_pts)
    return {"lonlat": lonlat, "eu": eu, "ev": ev, "lf": lf, "shape_start": shape_start,
            "shape_arr": np.array(shape_pts, dtype="<i4").reshape(-1, 2), "tags": [tags[k] for k in keys],
            "cls": cls_arr, "flags": flag_arr, "maxspeed": spd_arr}


def write_micro_bin(a, out_path):
    """micro.bin, little endian: antet 2 × uint32 (versiune 1, muchii), apoi pentru fiecare muchie (aceeași ordine
    ca în graph.bin): clasa (uint8, CLS_*), flaguri (uint8: F_* și, pe biții 5–6, sensul unic pentru vehicule)
    și limita de viteză din OSM (uint8, km/h; 0 = neetichetată)."""
    with open(out_path, "wb") as f:
        f.write(struct.pack("<2I", 1, len(a["cls"])))
        for arr in (a["cls"], a["flags"], a["maxspeed"]):
            f.write(arr.astype("u1").tobytes())


def infra_summary(a):
    """Kilometri de rețea pe tipuri, pentru meta.json și metodologie."""
    length = (a["lf"] >> 2) / 10.0
    cls, flags, spd = a["cls"], a["flags"], a["maxspeed"]
    road = (cls >= CLS_LOCAL) & (cls <= CLS_TRUNK)
    km = lambda m: round(float(length[m].sum()) / 1000, 1)
    by_class = {CLASS_NAMES[c]: km(cls == c) for c in range(len(CLASS_NAMES)) if (cls == c).any()}
    return {
        "km_by_class": by_class,
        "km_roads_with_bike_lane": km(road & ((flags & F_LANE) > 0)),
        "km_roads_maxspeed_over_50": km(road & (spd > 50)),
        "km_roads_maxspeed_tagged": km(road & (spd > 0)),
        "km_roads_total": km(road),
        "km_oneway_for_vehicles": km(((flags >> ONEWAY_SHIFT) & 3) > 0),
        "km_sett": km((flags & F_SETT) > 0),
        "km_unpaved": km((flags & F_UNPAVED) > 0),
    }


def categorize(tags):
    """(categorie, cod scaun rulant, mod) sau None – categoriile hărții pietonale, fără bănci, plus parcările
    și punctele de închiriere pentru biciclete și trotinete."""
    amenity = tags.get("amenity")
    if amenity == "bicycle_parking":
        return BIKE_PARKING, 0, 0
    if amenity in RENTAL_AMENITIES:
        return RENTAL, 0, 0
    if amenity == "bench":
        return None
    r = w15.categorize(tags)
    if r is None:
        return None
    return (STATION if r[0] == w15.STATION else r[0]), r[1], r[2]


def collect_pois(gdf):
    keep = [c for c in ("shop", "amenity", "leisure", "railway", "highway", "station", "usage", "disused",
                        "wheelchair", "name") if c in gdf.columns]
    pts, stations = [], []
    for _, row in gdf.iterrows():
        t = {k: row[k] for k in keep if isinstance(row[k], str)}
        r = categorize(t)
        geom = row.geometry
        if r is None or geom is None or geom.is_empty:
            continue
        p = geom if geom.geom_type == "Point" else geom.representative_point()
        cat, wc, mode = r
        if cat == STATION:
            stations.append((round(p.x, 5), round(p.y, 5), wc, mode, t.get("name")))
        else:
            pts.append([round(p.x, 5), round(p.y, 5), cat, wc, mode])
    merged = w15.merge_stations(stations)
    for s in merged:
        s[2] = STATION
    print("Stații: %d obiecte OSM → %d stații după unirea sensurilor" % (len(stations), len(merged)))
    return pts + merged


def poi_tags():
    return {"shop": sorted(w15.GROCERY),
            "amenity": sorted(w15.HEALTH | w15.EDUCATION | w15.EATING | {"bicycle_parking"} | RENTAL_AMENITIES),
            "leisure": sorted(w15.PARKS), "railway": ["station", "halt", "tram_stop"], "highway": ["bus_stop"]}


def main():
    ap = argparse.ArgumentParser(description="Exportă rețeaua pentru harta micromobilității (Iași).")
    ap.add_argument("--slug", default="iasi")
    ap.add_argument("--name", default="Iași")
    ap.add_argument("--center", default="%.4f,%.4f" % w15.DEFAULT_CENTER)
    ap.add_argument("--start", default="%.5f,%.5f" % w15.DEFAULT_START)
    ap.add_argument("--radius", type=int, default=12000, help="metri de la centru la fiecare latură (implicit 12000)")
    ap.add_argument("--overpass", help="server(e) Overpass, separate prin virgulă")
    ap.add_argument("--xml", help="fișier OSM XML local în loc de Overpass (de exemplu pentru teste)")
    ap.add_argument("--out", help="directorul de ieșire (implicit public/micromobilitate/data/<slug>)")
    args = ap.parse_args()
    center = tuple(float(x) for x in args.center.split(","))
    start = tuple(float(x) for x in args.start.split(","))
    servers = args.overpass.split(",") if args.overpass else w15.OVERPASS_SERVERS

    import osmnx as ox
    ox.settings.use_cache = True
    ox.settings.cache_folder = str(ROOT / "cache" / "osmnx")
    ox.settings.log_console = False
    ox.settings.requests_timeout = 300
    ox.settings.useful_tags_way = sorted(set(ox.settings.useful_tags_way) | set(WAY_TAGS))
    # fiecare cale OSM o singură dată, în sensul ei (sau invers, pentru oneway=-1), cu eticheta oneway originală:
    # sensurile permise se stabilesc aici, nu în osmnx
    ox.settings.all_oneway = True
    out = Path(args.out) if args.out else ROOT / "public" / "micromobilitate" / "data" / args.slug
    out.mkdir(parents=True, exist_ok=True)

    if args.xml:
        gdf = ox.features_from_xml(args.xml, tags=poi_tags())
        G = ox.graph_from_xml(args.xml, simplify=False)
    else:
        gdf = w15.with_servers("Descarc facilitățile",
                               lambda: ox.features_from_point(center, poi_tags(), dist=args.radius), servers)
        G = w15.with_servers("Descarc rețeaua (pe jos ∪ bicicletă)",
                             lambda: ox.graph_from_point(center, dist=args.radius, dist_type="bbox", simplify=False,
                                                         custom_filter=[WALK_FILTER, BIKE_FILTER]), servers)
    pts = collect_pois(gdf)
    counts = [sum(1 for p in pts if p[2] == c) for c in range(len(CATS))]
    print("Facilități:", len(pts), dict(zip(CATS, counts)))

    differ = ["highway", "ramp:wheelchair", "incline", "step_count", "bicycle", "foot", "oneway", "oneway:bicycle",
              "cycleway", "cycleway:left", "cycleway:right", "cycleway:both", "maxspeed", "surface", "junction"]
    G = ox.simplify_graph(G, edge_attrs_differ=differ)
    arrays = build_arrays(G)
    stats = w15.graph_summary(arrays)
    infra = infra_summary(arrays)
    print("Rețea:", stats)
    print("Infrastructură (km):", json.dumps(infra, ensure_ascii=False))

    w15.write_graph_bin(arrays, out / "graph.bin")
    write_micro_bin(arrays, out / "micro.bin")
    print("Etichete OSM pe muchii:", w15.write_edge_info(arrays, out / "edges.json"))
    with open(out / "pois.json", "w", encoding="utf-8") as f:
        json.dump({"cats": CATS, "pts": pts}, f, ensure_ascii=False, separators=(",", ":"))
    meta = {"name": args.name, "bbox": stats["bbox"], "start": list(start), "center": list(center),
            "radius_m": args.radius, "nodes": stats["nodes"], "edges": stats["edges"], "pois": len(pts),
            "counts": dict(zip(CATS, counts)), "steps": stats["steps"], "infrastructure": infra,
            "osmnx": ox.__version__, "source": "xml" if args.xml else "overpass",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    with open(out / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    for name in ("graph.bin", "micro.bin", "edges.json", "pois.json", "meta.json"):
        print(f"{name}: {(out / name).stat().st_size / 1e6:.2f} MB")
    print("Gata:", out)


if __name__ == "__main__":
    sys.exit(main())
