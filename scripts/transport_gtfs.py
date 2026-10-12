#!/usr/bin/env python3
"""Feedul GTFS al transportului public din Iași (CTP Iași, publicat de Tranzy – https://tranzy.ai/opendata/).

Intrare: data/transport/gtfs/IASI_GTFS.zip (agency, routes, trips, stop_times, stops, shapes, calendar).

Ieșire:
  data/transport/linii/rute_gtfs.geojson – traseele GTFS (câte unul pe formă / sens), cu prioritate „principal”:
      orarul oficial CTP înlocuiește în scripts/transport_linii.py traseele aceleiași linii din celelalte surse
      (AMTPI, OSM), care rămân doar pentru liniile fără orar GTFS (ex. 201, 204, 602, 603, liniile în proiect).
  public/data/transport/gtfs_servicii.json – serviciul pe linie (curse pe zi lucrătoare / zi de weekend, prima și
      ultima plecare, intervalul mediu la ora de vârf 7–9) și pe stație (liniile exacte din orar, plecări pe zi).

Tipul zilei: zi lucrătoare = serviciile active luni (ex. LV + LD), weekend = serviciile active sâmbătă (ex. SD + LD),
după calendar.txt. Rețeaua: metropolitană = linie din lista AMTPI sau cu număr ≥ 100.

Doar biblioteca standard. Rulare: python scripts/transport_gtfs.py [cale/feed.zip]
"""
import csv
import io
import json
import re
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "data" / "transport" / "gtfs" / "IASI_GTFS.zip"
OUT_LINES = ROOT / "data" / "transport" / "linii" / "rute_gtfs.geojson"
OUT_SERV = ROOT / "public" / "data" / "transport" / "gtfs_servicii.json"


def table(z, name):
    if name not in z.namelist():
        return []
    return list(csv.DictReader(io.TextIOWrapper(z.open(name), encoding="utf-8-sig")))


def minutes(t):
    h, m, *_ = (int(x) for x in t.split(":"))
    return h * 60 + m


def hhmm(m):
    return f"{m // 60 % 24:02d}:{m % 60:02d}"


def ref_of(r):
    return (r.get("route_short_name") or r.get("route_id") or "").strip().upper()


def mode_of(r):
    return "tramvai" if r.get("route_type") in ("0", "900") else "troleibuz" if r.get("route_type") == "11" else "autobuz"


def network(ref, amtpi):
    """Rețeaua: metropolitană = linie AMTPI (data/transport/amtpi_trasee.json) sau număr ≥ 100 (numerotarea AMTPI);
    zonele tarifare din GTFS nu despart rețelele (liniile CTP 27, 41, 44 au și stații în zona „metro”)."""
    m = re.match(r"\d+", ref)
    return "metropolitan" if ref in amtpi or (m and int(m.group()) >= 100) else "local"


def main():
    feed = Path(sys.argv[1]) if len(sys.argv) > 1 else FEED
    z = zipfile.ZipFile(feed)
    agency = (table(z, "agency.txt") or [{}])[0]
    routes = {r["route_id"]: r for r in table(z, "routes.txt")}
    trips = {t["trip_id"]: t for t in table(z, "trips.txt")}
    stops = {s["stop_id"]: s for s in table(z, "stops.txt")}
    cal = table(z, "calendar.txt")
    amtpi_path = ROOT / "data" / "transport" / "amtpi_trasee.json"
    amtpi = {x["linie"] for x in json.loads(amtpi_path.read_text(encoding="utf-8"))["linii"]} if amtpi_path.exists() else set()
    amtpi.discard("29")                                  # 29 (Tomești) e linie CTP, listată și de AMTPI
    weekday = {c["service_id"] for c in cal if c.get("monday") == "1"}
    weekend = {c["service_id"] for c in cal if c.get("saturday") == "1"}
    validity = (min((c["start_date"] for c in cal), default=""), max((c["end_date"] for c in cal), default=""))

    # orarul: plecările pe stație, stațiile și ora de plecare a fiecărei curse
    trip_start, trip_stops = {}, defaultdict(list)
    dep = defaultdict(lambda: [0, 0])
    stop_lines = defaultdict(set)
    for st in table(z, "stop_times.txt"):
        t = trips.get(st["trip_id"])
        if not t:
            continue
        r = routes[t["route_id"]]
        key = ("T" if mode_of(r) == "tramvai" else "") + ref_of(r)
        stop_lines[st["stop_id"]].add(key)
        if t["service_id"] in weekday:
            dep[st["stop_id"]][0] += 1
        if t["service_id"] in weekend:
            dep[st["stop_id"]][1] += 1
        seq = int(st["stop_sequence"])
        trip_stops[st["trip_id"]].append((seq, st["stop_id"]))
        tm = st.get("departure_time") or st.get("arrival_time")
        if tm and (st["trip_id"] not in trip_start or seq < trip_start[st["trip_id"]][0]):
            trip_start[st["trip_id"]] = (seq, minutes(tm))

    # serviciul pe linie
    serv = {}
    by_route = defaultdict(list)
    for t in trips.values():
        by_route[t["route_id"]].append(t)
    for rid, ts in by_route.items():
        r = routes[rid]
        key = f"{mode_of(r)}|{ref_of(r)}"
        wd = [t for t in ts if t["service_id"] in weekday]
        we = [t for t in ts if t["service_id"] in weekend]
        starts = sorted(trip_start[t["trip_id"]][1] for t in wd if t["trip_id"] in trip_start)
        peak = defaultdict(int)
        for t in wd:
            s = trip_start.get(t["trip_id"])
            if s and 7 * 60 <= s[1] < 9 * 60:
                peak[t.get("direction_id") or "0"] += 1
        headways = [120 / n for n in peak.values() if n]
        stop_ids = {sid for t in ts for _, sid in trip_stops.get(t["trip_id"], [])}
        e = serv.setdefault(key, {"linie": ref_of(r), "tip": mode_of(r), "nume": r.get("route_long_name") or "",
                                  "url": r.get("route_url") or "", "lucru": 0, "weekend": 0, "prima": None, "ultima": None,
                                  "interval_varf": None, "statii": 0, "retea": network(ref_of(r), amtpi)})
        e["lucru"] += len(wd)
        e["weekend"] += len(we)
        e["statii"] = max(e["statii"], len(stop_ids))
        if starts:
            e["prima"] = min(filter(None, [e["prima"], hhmm(starts[0])]))
            e["ultima"] = max(filter(None, [e["ultima"], hhmm(starts[-1])]))
        if headways:
            e["interval_varf"] = round(sum(headways) / len(headways))

    # traseele: o formă pe sens, cu stația de plecare și destinația
    shapes = defaultdict(list)
    for p in table(z, "shapes.txt"):
        shapes[p["shape_id"]].append((int(p["shape_pt_sequence"]), float(p["shape_pt_lon"]), float(p["shape_pt_lat"])))
    feats, seen = [], set()
    for t in trips.values():
        sid = t.get("shape_id")
        if not sid or sid in seen or sid not in shapes:
            continue
        seen.add(sid)
        r = routes[t["route_id"]]
        seq = sorted(trip_stops.get(t["trip_id"], []))
        first = stops.get(seq[0][1], {}).get("stop_name") if seq else None
        pts = [[round(x, 6), round(y, 6)] for _, x, y in sorted(shapes[sid])]
        key = f"{mode_of(r)}|{ref_of(r)}"
        feats.append({"type": "Feature", "properties": {
            "linie": ref_of(r), "tip": mode_of(r), "retea": serv.get(key, {}).get("retea", "local"),
            "name": r.get("route_long_name") or "", "from": first, "to": t.get("trip_headsign") or None,
            "operator": agency.get("agency_name") or "CTP Iași", "prioritate": "principal", "gtfs_shape": sid,
            "url": r.get("route_url") or None},
            "geometry": {"type": "LineString", "coordinates": pts}})
    feats.sort(key=lambda f: (f["properties"]["tip"] != "tramvai", int(re.match(r"\d+", f["properties"]["linie"]).group())
                              if re.match(r"\d+", f["properties"]["linie"]) else 999, f["properties"]["linie"], f["properties"]["gtfs_shape"]))
    OUT_LINES.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")),
                         encoding="utf-8")

    def lkey(k):
        m = re.search(r"\d+", k)
        return (k[:1] != "T", int(m.group()) if m else 999, k)
    stop_out = [{"id": sid, "nume": s.get("stop_name"), "lat": round(float(s["stop_lat"]), 6), "lng": round(float(s["stop_lon"]), 6),
                 "zona": s.get("zone_id") or "", "linii": sorted(stop_lines.get(sid, ()), key=lkey),
                 "plecari_lucru": dep[sid][0], "plecari_weekend": dep[sid][1]}
                for sid, s in stops.items() if s.get("location_type", "0") in ("", "0")]
    out = {"sursa": "GTFS CTP Iași (Tranzy, https://tranzy.ai/opendata/)", "operator": agency.get("agency_name"),
           "valabil": {"de_la": validity[0], "pana_la": validity[1]},
           "linii": dict(sorted(serv.items())), "statii": stop_out}
    OUT_SERV.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    top = sorted(stop_out, key=lambda s: -s["plecari_lucru"])[:5]
    print(f"{len(serv)} linii, {len(feats)} trasee, {len(stop_out)} stații; cele mai multe plecări (zi lucrătoare): "
          + ", ".join(f"{s['nume']} {s['plecari_lucru']}" for s in top))


if __name__ == "__main__":
    main()
