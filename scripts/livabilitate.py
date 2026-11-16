#!/usr/bin/env python3
"""Indicele de locuibilitate (livability index) pe cele 17 zone MVA–MVI ale municipiului Iași, din OpenStreetMap.

Metoda urmează capitolul 6 „The Livability Index” din Urban Analytics (indice simplu, doar din OSM): zece indicatori
(KPI) în cinci dimensiuni, fiecare raportat la suprafața zonei (pe km²), scalați min–max la 1–10, ponderați explicit
și însumați, apoi suma scalată din nou la 1–10. Pagina /livabilitate/ reface scalarea și ponderarea în browser, deci
ponderile se pot schimba fără a rula din nou scriptul.

Adaptări pentru Iași (vezi și public/livabilitate/metodologie.html):
  - unitatea de analiză: cele 17 zone ale studiului O–D (public/data/iasi_17_zone_mva_mvi.geojson), nu sectoare
    administrative (Iașul nu are);
  - pe lângă densitatea pe km², fiecare indicator e calculat și la 1.000 de locuitori (populația 2020 pe caroiaj
    de 100 m din analiza accesibilității, public/accesibilitate/data/general.json) – zonele mari și puțin locuite
    (Bularga – Zona Industrială, Bucium) sunt altfel dezavantajate doar de suprafață;
  - o singură descărcare Overpass pentru tot orașul, apoi fiecare obiect e atribuit unei singure zone (după punctul
    său reprezentativ), deci nu se numără de două ori; străzile și parcurile sunt tăiate exact pe limita zonei;
  - comerțul (shop=*) și birourile (office=*) sunt separate corect (în capitol cele două straturi ieșiseră identice);
  - stațiile de transport public sunt deduplicate (aceeași denumire la mai puțin de 150 m = o stație), altfel fiecare
    sens, peron și punct de oprire s-ar număra separat;
  - parcurile sunt unite înainte de calculul suprafeței (parcurile incluse unul în altul nu se adună de două ori).

Utilizare (rulează automat în GitHub Actions – .github/workflows/livabilitate.yml):
    pip install shapely pyproj
    python scripts/livabilitate.py                     # descarcă din Overpass și scrie public/livabilitate/data/
    python scripts/livabilitate.py --cache osm.json    # păstrează / refolosește răspunsul Overpass
"""
import argparse
import json
import math
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, shape
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent
ZONES = ROOT / "public/data/iasi_17_zone_mva_mvi.geojson"
POPULATION = ROOT / "public/accesibilitate/data/general.json"
OUT = ROOT / "public/livabilitate/data/livabilitate.json"
OVERPASS_SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
                    "https://overpass.kumi.systems/api/interpreter"]

# Stereo 70 (EPSG:3844) – proiecția națională, în metri
_TO_M = Transformer.from_crs(4326, 3844, always_xy=True).transform


def to_m(g):
    return shapely.transform(g, lambda c: np.column_stack(_TO_M(c[:, 0], c[:, 1])))

# Indicatorii: cheie, denumire, dimensiune, unitate (pe km² / la 1.000 loc.), pondere implicită (din capitol)
KPIS = [
    dict(k="strazi", n="Densitatea străzilor", d="Accesibilitate și mobilitate", u_km2="km de stradă / km²",
         u_pop="km de stradă / 1.000 loc.", w=0.10, osm="highway=* (toate tipurile de căi, ca network_type='all')"),
    dict(k="statii", n="Stații de transport public", d="Accesibilitate și mobilitate", u_km2="stații / km²",
         u_pop="stații / 1.000 loc.", w=0.15,
         osm="public_transport=platform|stop_position, highway=bus_stop, railway=tram_stop (deduplicate)"),
    dict(k="parcuri", n="Suprafața parcurilor", d="Spații verzi și recreere", u_km2="% din suprafața zonei",
         u_pop="m² de parc / locuitor", w=0.10, osm="leisure=park (poligoane, unite)"),
    dict(k="sport", n="Terenuri de sport", d="Spații verzi și recreere", u_km2="terenuri / km²",
         u_pop="terenuri / 1.000 loc.", w=0.10, osm="leisure=pitch"),
    dict(k="farmacii", n="Farmacii", d="Servicii publice", u_km2="farmacii / km²", u_pop="farmacii / 1.000 loc.",
         w=0.10, osm="amenity=pharmacy"),
    dict(k="scoli", n="Școli", d="Servicii publice", u_km2="școli / km²", u_pop="școli / 1.000 loc.", w=0.10,
         osm="amenity=school"),
    dict(k="urgente", n="Poliție și pompieri", d="Siguranță", u_km2="unități / km²", u_pop="unități / 1.000 loc.",
         w=0.10, osm="amenity=police, amenity=fire_station"),
    dict(k="iluminat", n="Stâlpi de iluminat cartografiați", d="Siguranță", u_km2="stâlpi / km²",
         u_pop="stâlpi / 1.000 loc.", w=0.10, osm="highway=street_lamp"),
    dict(k="comert", n="Magazine", d="Oportunități economice", u_km2="magazine / km²",
         u_pop="magazine / 1.000 loc.", w=0.10, osm="shop=*"),
    dict(k="birouri", n="Birouri", d="Oportunități economice", u_km2="birouri / km²", u_pop="birouri / 1.000 loc.",
         w=0.05, osm="office=*"),
]
# sub acest număr total de obiecte în tot orașul, stratul e considerat insuficient cartografiat (pondere implicită 0)
MIN_TOTAL = 60


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def overpass(query, cache=None):
    if cache and Path(cache).exists():
        return json.loads(Path(cache).read_text())
    data = urllib.parse.urlencode({"data": query}).encode()
    last = None
    for attempt in range(6):
        url = OVERPASS_SERVERS[attempt % len(OVERPASS_SERVERS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "mobilitate-iasi-livabilitate/1.0"})
            with urllib.request.urlopen(req, timeout=400) as r:
                res = json.loads(r.read())
            if cache:
                Path(cache).write_text(json.dumps(res))
            return res
        except Exception as e:  # noqa: BLE001 – orice eroare de rețea: încearcă serverul următor
            last = e
            print(f"  Overpass {url.split('/')[2]}: {type(e).__name__} {e}; reîncerc…", file=sys.stderr)
            time.sleep(20)
    raise RuntimeError(f"Overpass indisponibil: {last}")


def classify(tags):
    """Lista de chei KPI în care intră un obiect (fără străzi și parcuri, tratate separat)."""
    out = []
    pt, hw, rw, am = tags.get("public_transport"), tags.get("highway"), tags.get("railway"), tags.get("amenity")
    if pt in ("platform", "stop_position") or hw == "bus_stop" or rw == "tram_stop":
        out.append("statii")
    if tags.get("leisure") == "pitch":
        out.append("sport")
    if am == "pharmacy":
        out.append("farmacii")
    if am == "school":
        out.append("scoli")
    if am in ("police", "fire_station"):
        out.append("urgente")
    if hw == "street_lamp":
        out.append("iluminat")
    if "shop" in tags and tags["shop"] not in ("no", "vacant"):
        out.append("comert")
    if "office" in tags and tags["office"] not in ("no", "vacant"):
        out.append("birouri")
    return out


def way_line(el):
    g = el.get("geometry") or []
    return LineString([(p["lon"], p["lat"]) for p in g]) if len(g) >= 2 else None


def element_area(el):
    """Poligonul (WGS84) al unui way închis sau al unei relații multipolygon, altfel None."""
    if el["type"] == "way":
        g = el.get("geometry") or []
        if len(g) >= 4 and g[0] == g[-1]:
            p = Polygon([(q["lon"], q["lat"]) for q in g])
            return p if p.is_valid else p.buffer(0)
        return None
    if el["type"] == "relation":
        outer, inner = [], []
        for m in el.get("members", []):
            if m.get("type") != "way" or not m.get("geometry"):
                continue
            ln = LineString([(q["lon"], q["lat"]) for q in m["geometry"]])
            (inner if m.get("role") == "inner" else outer).append(ln)
        if not outer:
            return None
        poly = unary_union(list(polygonize(unary_union(outer))))
        if inner:
            poly = poly.difference(unary_union(list(polygonize(unary_union(inner)))))
        return poly if not poly.is_empty else None
    return None


def rep_point(el):
    if el["type"] == "node":
        return Point(el["lon"], el["lat"])
    a = element_area(el)
    if a is not None and not a.is_empty:
        return a.representative_point()
    if el.get("center"):
        return Point(el["center"]["lon"], el["center"]["lat"])
    if el["type"] == "way" and el.get("geometry"):
        return way_line(el).interpolate(0.5, normalized=True)
    if el.get("bounds"):
        b = el["bounds"]
        return Point((b["minlon"] + b["maxlon"]) / 2, (b["minlat"] + b["maxlat"]) / 2)
    return None


def dedupe_stops(stops):
    """Aceeași denumire la < 150 m = o singură stație (sensuri, peron + punct de oprire). Fără nume: la < 30 m."""
    kept = []
    for name, p in stops:
        dup = False
        for n2, q in kept:
            d = p.distance(q)
            if (name and name == n2 and d < 150) or d < 30:
                dup = True
                break
        if not dup:
            kept.append((name, p))
    return kept


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", help="fișier JSON cu răspunsul Overpass (se creează la prima rulare)")
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()

    zones = json.loads(ZONES.read_text())["features"]
    zgeo = [shape(f["geometry"]) for f in zones]
    zm = [to_m(g) for g in zgeo]
    city = unary_union(zgeo)
    minx, miny, maxx, maxy = city.bounds
    bbox = f"{miny:.5f},{minx:.5f},{maxy:.5f},{maxx:.5f}"

    # populația 2020 pe zone (caroiaj de 100 m, analiza accesibilității)
    popn = {}
    if POPULATION.exists():
        for u in json.loads(POPULATION.read_text()).get("u", []):
            if u.get("t") == "cartier":
                popn[norm(u["n"])] = u["pop"]
    pops = [popn.get(norm(f["properties"]["zone_name"])) for f in zones]
    missing = [f["properties"]["zone_name"] for f, p in zip(zones, pops) if not p]
    if missing:
        print("Fără populație:", ", ".join(missing), file=sys.stderr)

    q = f"""[out:json][timeout:360][bbox:{bbox}];
(
  nwr[shop]; nwr[office];
  nwr[amenity~"^(pharmacy|school|police|fire_station)$"];
  nwr[leisure~"^(park|pitch)$"];
  node[highway~"^(street_lamp|bus_stop)$"];
  node[public_transport~"^(platform|stop_position)$"]; way[public_transport=platform];
  node[railway=tram_stop];
  way[highway][area!=yes];
);
out geom qt;"""
    print("Descarc din Overpass…", file=sys.stderr)
    res = overpass(q, a.cache)
    els = res.get("elements", [])
    stamp = res.get("osm3s", {}).get("timestamp_osm_base")
    print(f"  {len(els)} obiecte OSM (bază din {stamp})", file=sys.stderr)

    tree = STRtree(zgeo)

    def zone_of(p):
        for i in tree.query(p):
            if zgeo[i].covers(p):
                return int(i)
        return None

    n = len(zones)
    counts = {k["k"]: [0] * n for k in KPIS}
    road_m = [0.0] * n
    parks = [[] for _ in range(n)]
    stops = [[] for _ in range(n)]
    road_lines = []
    for el in els:
        tags = el.get("tags") or {}
        if el["type"] == "way" and "highway" in tags and tags.get("area") != "yes" and \
                tags["highway"] not in ("platform", "construction", "proposed", "abandoned", "razed"):
            ln = way_line(el)
            if ln is not None:
                road_lines.append(ln)
        if tags.get("leisure") == "park":
            ar = element_area(el)
            if ar is not None:
                for i in tree.query(ar):
                    parks[int(i)].append(ar)
        cats = classify(tags)
        if not cats:
            continue
        p = rep_point(el)
        if p is None:
            continue
        z = zone_of(p)
        if z is None:
            continue
        for c in cats:
            if c == "statii":
                stops[z].append((tags.get("name", "").strip().lower(), to_m(p)))
            else:
                counts[c][z] += 1

    # străzile: lungimea tăiată pe fiecare zonă
    rtree = STRtree(road_lines)
    for i, g in enumerate(zgeo):
        sel = [road_lines[j] for j in rtree.query(g)]
        if sel:
            road_m[i] = to_m(unary_union(sel).intersection(g)).length
    park_m2 = [to_m(unary_union(ps).intersection(g)).area if ps else 0.0 for ps, g in zip(parks, zgeo)]
    for i in range(n):
        counts["statii"][i] = len(dedupe_stops(stops[i]))

    out_z = []
    for i, f in enumerate(zones):
        pr = f["properties"]
        km2 = zm[i].area / 1e6
        pop = pops[i]
        raw = {k["k"]: counts[k["k"]][i] for k in KPIS if k["k"] not in ("strazi", "parcuri")}
        raw["strazi"] = round(road_m[i] / 1000, 2)        # km
        raw["parcuri"] = round(park_m2[i])                # m²
        km2v, popv = {}, {}
        for k in KPIS:
            key = k["k"]
            if key == "parcuri":
                km2v[key] = round(park_m2[i] / (km2 * 1e6) * 100, 2)          # % din suprafață
                popv[key] = round(park_m2[i] / pop, 2) if pop else None      # m² / locuitor
            else:
                km2v[key] = round(raw[key] / km2, 3)
                popv[key] = round(raw[key] / pop * 1000, 3) if pop else None
        geom = f["geometry"]
        rnd = lambda c: [round(c[0], 5), round(c[1], 5)]  # noqa: E731
        if geom["type"] == "Polygon":
            coords = [[rnd(c) for c in ring] for ring in geom["coordinates"]]
        else:
            coords = [[[rnd(c) for c in ring] for ring in poly] for poly in geom["coordinates"]]
        out_z.append(dict(id=pr["zone_id"], n=pr["zone_name"], km2=round(km2, 3), pop=pop, raw=raw,
                          km2v=km2v, popv=popv, geom=dict(type=geom["type"], coordinates=coords)))

    totals = {k["k"]: sum(z["raw"][k["k"]] for z in out_z) for k in KPIS}
    kpis = []
    for k in KPIS:
        ok = k["k"] in ("strazi", "parcuri") or totals[k["k"]] >= MIN_TOTAL
        kpis.append(dict(k, total=totals[k["k"]], ok=ok, w=k["w"] if ok else 0.0))
    doc = dict(generated=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), osm_base=stamp,
               crs="EPSG:3844 (Stereo 70) pentru suprafețe și lungimi",
               population="populația 2020 pe caroiaj de 100 m (analiza accesibilității, /accesibilitate/)",
               kpis=kpis, zones=out_z)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    print(f"Scris {a.out}", file=sys.stderr)
    for k in kpis:
        print(f"  {k['n']:<34} total {k['total']:>10}  {'ok' if k['ok'] else 'INSUFICIENT cartografiat'}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
