#!/usr/bin/env python3
"""Compară traseele și stațiile de transport public din datele proiectului (public/data/transport/linii.geojson și
statii.geojson, generate de scripts/transport_linii.py) cu OpenStreetMap (data/transport/osm/, descărcat de
scripts/transport_osm.py).

Linii (pe tip și număr): prezente în ambele surse / doar în datele proiectului / doar în OSM; pentru cele comune,
ponderea din lungime care se suprapune (la ≤ 30 m) în fiecare sens al comparației și porțiunile care diferă (> 100 m).
Stații: pentru fiecare stație a proiectului, cea mai apropiată stație OSM de același mod (autobuz / tramvai):
concordantă, nume diferit, decalată (> 30 m) sau lipsă în OSM; plus stațiile liniilor CTP din OSM care lipsesc din
datele proiectului. Probleme de etichetare în OSM: ref diferit de numele relației, ref lipsă, rețea / operator
neobișnuit, trasee discontinue, stații fără nume.

Ieșire:
  public/data/transport/comparatie_osm.json     – sumar și liste, citit de /transport/comparatie.html
  public/data/transport/comparatie_osm.geojson  – porțiunile de traseu și stațiile care diferă (pentru hartă)
  public/data/transport/comparatie_osm_linii.csv, comparatie_osm_statii.csv, comparatie_osm_probleme.csv

Necesită: pip install pyproj shapely
"""
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

import shapely
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import LineString, MultiLineString, Point, mapping, shape
from shapely.ops import linemerge, unary_union

ROOT = Path(__file__).resolve().parent.parent
OSM = ROOT / "data" / "transport" / "osm"
PUB = ROOT / "public" / "data" / "transport"
OUT_CSV = PUB
LINE_TOL = 30      # m – un traseu „se suprapune” cu celălalt dacă trece la cel mult atâta de el
DIFF_MIN = 100     # m – porțiunile diferite mai scurte nu se raportează
STOP_OK = 30       # m – stație concordantă
STOP_FAR = 150     # m – peste atât, stația e considerată lipsă
FWD = Transformer.from_crs("EPSG:4326", "EPSG:3844", always_xy=True)
INV = Transformer.from_crs("EPSG:3844", "EPSG:4326", always_xy=True)
MODE = {"bus": "autobuz", "trolleybus": "autobuz", "minibus": "autobuz", "share_taxi": "autobuz", "tram": "tramvai"}


def proj(g):
    return shapely.transform(g, lambda x, y: FWD.transform(x, y), interleaved=False)


def unproj(g):
    return shapely.transform(g, lambda x, y: INV.transform(x, y), interleaved=False)


def norm(s):
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"([a-z])\.(?=[a-z])", r"\1", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\btg\b", "targu", s)
    s = re.sub(r"\b(iii|ii|i|iv)\b", lambda m: {"i": "1", "ii": "2", "iii": "3", "iv": "4"}[m.group(1)], s)
    return re.sub(r"\s+", " ", s).strip()


def tokens(name):
    stop = {"piata", "str", "strada", "statia", "de", "la", "bd", "bulevardul"}
    return [t for t in norm(name).replace("podu", "pod").split() if t not in stop]


def same_name(a, b):
    ta, tb = tokens(a), tokens(b)
    if not ta or not tb:
        return False
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return all(t in big for t in small)


def is_ctp(tags):
    t = norm(" ".join(tags.get(k, "") for k in ("network", "operator", "network:short")))
    return "ctp" in t or "amtpi" in t or "transport public iasi" in t or tags.get("network:wikidata") == "Q7275888"


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


# ---------- linii ----------

def osm_routes():
    d = load(OSM / "rute.json")
    out = []
    for el in d["elements"]:
        if el["type"] != "relation":
            continue
        t = el.get("tags", {})
        ways = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
                for m in el.get("members", []) if m["type"] == "way" and len(m.get("geometry") or []) > 1]
        if not ways:
            continue
        merged = linemerge(MultiLineString(ways))
        gaps = route_gaps(proj(merged))
        stops = [(m["lon"], m["lat"], m["role"]) for m in el.get("members", []) if m["type"] == "node" and "lat" in m]
        ref = (t.get("ref") or "").upper().strip()
        m = re.match(r"^\s*(bus|tram|trolleybus|minibus)\s+([0-9]{1,3}[a-z]?)\s*:", t.get("name", ""), re.I)
        name_ref = m.group(2).upper() if m else None
        out.append({"id": el["id"], "tags": t, "mode": MODE.get(t.get("route"), "autobuz"), "ref": name_ref or ref, "ref_tag": ref,
                    "geom": proj(merged), "gaps": gaps, "stops": stops, "ctp": is_ctp(t)})
    return out


def route_gaps(g, tol=20):
    """Golurile unui traseu: capetele „libere” ale bucăților (la peste tol m de orice altă bucată). Un traseu continuu
    are 2 capete libere (o buclă – 0); fiecare gol mai adaugă 2."""
    if g.geom_type != "MultiLineString":
        return 0
    parts = list(g.geoms)
    free = 0
    for i, part in enumerate(parts):
        for e in (Point(part.coords[0]), Point(part.coords[-1])):
            if all(e.distance(q) > tol for j, q in enumerate(parts) if j != i):
                free += 1
    return max(0, (free - 1) // 2)


def our_lines():
    d = load(PUB / "linii.geojson")
    by = {}
    for f in d["features"]:
        p = f["properties"]
        if not p.get("linie") or p.get("stare") == "propus":
            continue
        by.setdefault((p["tip"], p["linie"].upper()), []).append((p, proj(shape(f["geometry"]))))
    return by


def share_within(a, b, tol):
    if a.is_empty or b.is_empty or a.length == 0:
        return 0.0
    return a.intersection(b.buffer(tol)).length / a.length


def diff_parts(a, b, tol):
    d = a.difference(b.buffer(tol))
    geoms = list(d.geoms) if hasattr(d, "geoms") else [d]
    geoms = [g for g in geoms if g.geom_type in ("LineString", "MultiLineString") and g.length >= DIFF_MIN]
    return geoms


def compare_lines(osm, ours, feats, issues):
    rows = []
    osm_by = {}
    for r in osm:
        if r["ctp"] and r["ref"]:
            osm_by.setdefault((r["mode"], r["ref"]), []).append(r)
    keys = sorted(set(ours) | set(osm_by), key=lambda k: (k[0] != "tramvai", int(re.match(r"\d+", k[1]).group()) if re.match(r"\d+", k[1]) else 999, k[1]))
    for k in keys:
        o, s = ours.get(k), osm_by.get(k)
        row = {"tip": k[0], "linie": k[1], "retea": (o[0][0].get("retea") if o else ""), "sensuri_proiect": len(o) if o else 0,
               "sensuri_osm": len(s) if s else 0, "osm": " ".join(f"relation/{r['id']}" for r in (s or []))}
        if o and s:
            g_ours = unary_union([g for _, g in o])
            g_osm = unary_union([r["geom"] for r in s])
            a, b = share_within(g_ours, g_osm, LINE_TOL), share_within(g_osm, g_ours, LINE_TOL)
            row.update({"km_proiect": round(g_ours.length / 1000, 2), "km_osm": round(g_osm.length / 1000, 2),
                        "proiect_acoperit_de_osm": round(a * 100, 1), "osm_acoperit_de_proiect": round(b * 100, 1)})
            row["stare"] = "concordant" if min(a, b) >= 0.95 else "diferențe minore" if min(a, b) >= 0.8 else "diferențe majore"
            for which, src, dst in (("doar în datele proiectului", g_ours, g_osm), ("doar în OSM", g_osm, g_ours)):
                for g in diff_parts(src, dst, LINE_TOL):
                    feats.append({"type": "Feature", "properties": {"tip_dif": "traseu", "unde": which, "tip": k[0], "linie": k[1],
                                  "m": round(g.length)}, "geometry": rnd(mapping(unproj(g)))})
        else:
            row["stare"] = "doar în datele proiectului" if o else "doar în OSM"
            if s:
                g_osm = unary_union([r["geom"] for r in s])
                row["km_osm"] = round(g_osm.length / 1000, 2)
                row["nume_osm"] = s[0]["tags"].get("name", "")
                feats.append({"type": "Feature", "properties": {"tip_dif": "traseu", "unde": "linie doar în OSM", "tip": k[0], "linie": k[1],
                              "m": round(g_osm.length), "nume": row["nume_osm"]}, "geometry": rnd(mapping(unproj(g_osm)))})
        rows.append(row)
    # probleme de etichetare ale relațiilor OSM
    for r in osm:
        t, name = r["tags"], r["tags"].get("name", "")
        if r["ctp"] and r["ref_tag"] and r["ref"] != r["ref_tag"]:
            issues.append(problem("relație", r["id"], name, f"ref={r['ref_tag']} diferă de numărul din nume ({r['ref']}); comparat ca linia {r['ref']}"))
        if r["ctp"] and not r["ref_tag"]:
            issues.append(problem("relație", r["id"], name, "lipsește ref (numărul liniei)"))
        if r["ctp"] and r["gaps"]:
            issues.append(problem("relație", r["id"], name, f"traseu întrerupt: {r['gaps']} {'gol' if r['gaps'] == 1 else 'goluri'} "
                                  "(capete de căi la peste 20 m de restul traseului – lipsesc căi din relație)"))
        if r["ctp"] and not (t.get("from") and t.get("to")):
            issues.append(problem("relație", r["id"], name, "lipsesc from / to"))
        net = norm(t.get("network", ""))
        if r["ctp"] and net and "ctp" not in net and "iasi" not in net:
            issues.append(problem("relație", r["id"], name, f"network neobișnuit: {t.get('network')}"))
    return rows


def rnd(g):
    def r(c):
        return [round(c[0], 5), round(c[1], 5)] if isinstance(c[0], (int, float)) else [r(x) for x in c]
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


def problem(kind, osm_id, name, text):
    return {"obiect": kind, "osm": f"{'relation' if kind == 'relație' else 'node'}/{osm_id}", "nume": name, "problema": text}


# ---------- stații ----------

def osm_stops(routes):
    d = load(OSM / "statii.json")
    ctp_nodes = {}
    for r in routes:
        if r["ctp"]:
            for lon, lat, role in r["stops"]:
                ctp_nodes.setdefault((round(lon, 6), round(lat, 6)), set()).add(r["ref"])
    out = []
    for el in d["elements"]:
        if el["type"] != "node":
            continue
        t = el.get("tags", {})
        tram = t.get("railway") == "tram_stop" or (t.get("tram") == "yes" and t.get("bus") != "yes" and t.get("highway") != "bus_stop")
        bus = t.get("highway") == "bus_stop" or t.get("bus") == "yes" or (not tram and t.get("public_transport") == "platform")
        refs = ctp_nodes.get((round(el["lon"], 6), round(el["lat"], 6)), set())
        out.append({"id": el["id"], "name": t.get("name", ""), "tags": t, "tram": tram, "bus": bus or (not tram),
                    "p": proj(Point(el["lon"], el["lat"])), "lon": el["lon"], "lat": el["lat"], "ctp_lines": refs})
    return out


def compare_stops(ostops, feats, issues):
    d = load(PUB / "statii.geojson")
    ours = [f for f in d["features"] if not re.search(r"aglomerat|terminus|transfer", f["properties"].get("strat") or "", re.I)]
    rows = []
    for mode in ("autobuz", "tramvai"):
        cand = [s for s in ostops if (s["tram"] if mode == "tramvai" else s["bus"])]
        if not cand:
            continue
        tree = STRtree([s["p"] for s in cand])
        mine = [f for f in ours if (f["properties"].get("mod") or "autobuz") == mode]
        mine_pts = [proj(shape(f["geometry"])) for f in mine]
        for f, pt in zip(mine, mine_pts):
            p = f["properties"]
            near = [cand[i] for i in tree.query(pt.buffer(STOP_FAR))]
            near.sort(key=lambda s: s["p"].distance(pt))
            nearest = near[0] if near else None
            named = next((s for s in near if same_name(s["name"], p.get("nume"))), None)
            dn = nearest["p"].distance(pt) if nearest else None
            dnm = named["p"].distance(pt) if named else None
            if named and dnm <= STOP_OK:
                st = "concordant"
            elif nearest and dn <= STOP_OK:
                st = "nume diferit"
            elif named:
                st = "decalat"
            else:
                st = "lipsă în OSM"
            ref = named or nearest
            rows.append({"mod": mode, "strat": p.get("strat"), "nume_proiect": p.get("nume") or "", "nume_osm": ref["name"] if ref else "",
                         "distanta_m": round((dnm if named else dn) or 0) if ref else "", "stare": st,
                         "osm": f"node/{ref['id']}" if ref else "", "lat": f["geometry"]["coordinates"][1], "lon": f["geometry"]["coordinates"][0]})
            if st != "concordant":
                feats.append({"type": "Feature", "properties": {"tip_dif": "stație", "stare": st, "mod": mode, "nume": p.get("nume") or "",
                              "nume_osm": ref["name"] if ref else "", "m": rows[-1]["distanta_m"], "strat": p.get("strat")},
                              "geometry": f["geometry"]})
        # stațiile liniilor CTP din OSM care lipsesc din datele proiectului
        if mine_pts:
            mtree = STRtree(mine_pts)
            for s in cand:
                if not s["ctp_lines"]:
                    continue
                if not any(mine_pts[i].distance(s["p"]) <= 40 for i in mtree.query(s["p"].buffer(40))):
                    rows.append({"mod": mode, "strat": "OSM", "nume_proiect": "", "nume_osm": s["name"], "distanta_m": "",
                                 "stare": "doar în OSM", "osm": f"node/{s['id']}", "lat": s["lat"], "lon": s["lon"],
                                 "linii_osm": ", ".join(sorted(s["ctp_lines"]))})
                    feats.append({"type": "Feature", "properties": {"tip_dif": "stație", "stare": "doar în OSM", "mod": mode,
                                  "nume": "", "nume_osm": s["name"], "linii_osm": ", ".join(sorted(s["ctp_lines"]))},
                                  "geometry": {"type": "Point", "coordinates": [round(s["lon"], 5), round(s["lat"], 5)]}})
    for s in ostops:
        if s["ctp_lines"] and not s["name"]:
            issues.append(problem("stație", s["id"], "", "stație a unei linii CTP fără nume"))
        net = norm(s["tags"].get("network", ""))
        if net and "ctp" not in net and "iasi" not in net and ("cluj" in net or "bucuresti" in net or "stb" in net):
            issues.append(problem("stație", s["id"], s["name"], f"network greșit: {s['tags'].get('network')}"))
    return rows


def compare_amtpi(lines, routes):
    """Lista oficială AMTPI față de datele proiectului și OSM: linie, comună, statut, prezență, observații."""
    path = ROOT / "data" / "transport" / "amtpi_trasee.json"
    if not path.exists():
        return []
    amtpi = json.loads(path.read_text(encoding="utf-8"))["linii"]
    ours = {}
    for f in load(PUB / "linii.geojson")["features"]:
        p = f["properties"]
        if p.get("linie") and p.get("tip") == "autobuz":
            ours.setdefault(p["linie"].upper(), p)
    osm = {r["ref"] for r in routes if r["mode"] == "autobuz" and r["ref"]}
    by_line = {r["linie"]: r for r in lines}
    rows = []
    for a in amtpi:
        o = ours.get(a["linie"])
        src = (o or {}).get("sursa") or ""
        obs = []
        if a["in_proiect"]:
            obs.append("în proiect – pe hartă ca propunere" if o else "în proiect")
        if not o:
            obs.append("lipsește din datele proiectului" + (" (există în OSM)" if a["linie"] in osm else ""))
        elif "osm" in src.lower():
            obs.append("preluată din OSM (fără fișier KMZ)")
        st = by_line.get(a["linie"], {}).get("stare")
        if st and st not in ("concordant",) and o and a["linie"] in osm:
            obs.append(f"față de OSM: {st}")
        rows.append({"linie": a["linie"], "comuna": a["comuna"], "statii_amtpi": " – ".join(a["statii"]),
                     "statut_amtpi": "în proiect" if a["in_proiect"] else "în exploatare",
                     "in_proiect_date": "da" if o else "nu", "in_osm": "da" if a["linie"] in osm else "nu",
                     "observatii": "; ".join(obs), "url": a["url"]})
    listed = {a["linie"] for a in amtpi}
    for ref, p in sorted(ours.items()):
        if p.get("retea") == "metropolitan" and ref not in listed:
            rows.append({"linie": ref, "comuna": ", ".join(p.get("uat_nume") or []), "statii_amtpi": p.get("nume") or "",
                         "statut_amtpi": "nelistat", "in_proiect_date": "da", "in_osm": "da" if ref in osm else "nu",
                         "observatii": p.get("nota") or ("în datele proiectului, dar nu în lista AMTPI (posibil desființată): " + (p.get("nume") or "")),
                         "url": ""})
    return rows


def write_csv(path, rows):
    if not rows:
        return
    keys = []
    for r in rows:
        keys += [k for k in r if k not in keys]
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


def count(rows, key):
    out = {}
    for r in rows:
        out[r[key]] = out.get(r[key], 0) + 1
    return out


def main():
    if not (OSM / "rute.json").exists():
        sys.exit("Lipsesc datele OSM: rulați scripts/transport_osm.py (acțiunea „Date OSM transport public”).")
    routes = osm_routes()
    feats, issues = [], []
    lines = compare_lines(routes, our_lines(), feats, issues)
    stops = compare_stops(osm_stops(routes), feats, issues)
    amtpi = compare_amtpi(lines, routes)
    osm_time = load(OSM / "rute.json").get("osm3s", {}).get("timestamp_osm_base")
    others = sorted({(MODE.get(r["tags"].get("route"), "autobuz"), r["ref"], r["tags"].get("network") or r["tags"].get("operator") or "")
                     for r in routes if not r["ctp"]}, key=lambda x: (x[0], x[1]))
    summary = {
        "osm_la": osm_time,
        "linii": {"total": len(lines), **count(lines, "stare")},
        "statii": {m: count([s for s in stops if s["mod"] == m], "stare") for m in ("autobuz", "tramvai")},
        "probleme_osm": len(issues),
        "amtpi": count(amtpi, "statut_amtpi") if amtpi else {},
        "rute_osm_ctp": sum(1 for r in routes if r["ctp"]),
        "rute_osm_alti_operatori": [{"tip": a, "linie": b, "retea": c} for a, b, c in others],
    }
    PUB.mkdir(parents=True, exist_ok=True)
    (PUB / "comparatie_osm.json").write_text(json.dumps({"sumar": summary, "linii": lines, "probleme": issues,
                                                          "statii": [s for s in stops if s["stare"] != "concordant"], "amtpi": amtpi},
                                                         ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (PUB / "comparatie_osm.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats},
                                                            ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    write_csv(OUT_CSV / "comparatie_osm_linii.csv", lines)
    write_csv(OUT_CSV / "comparatie_osm_statii.csv", stops)
    write_csv(OUT_CSV / "comparatie_osm_probleme.csv", issues)
    write_csv(OUT_CSV / "comparatie_amtpi.csv", amtpi)
    print(json.dumps(summary, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
