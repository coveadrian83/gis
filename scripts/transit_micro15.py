#!/usr/bin/env python3
"""Orarul CTP Iași (GTFS) într-o formă compactă pentru varianta „bicicletă + transport public” a hărții
„15 minute pe două roți” (public/micromobilitate/).

Pentru fiecare traseu distinct (linie, sens, succesiunea stațiilor) se păstrează stațiile, timpul mediu de la
prima stație la fiecare stație și intervalul mediu dintre curse la ora de vârf a dimineții (zi lucrătoare,
07:00–09:00). Pagina folosește apoi: pedalezi până la o stație, lași bicicleta (park & ride), aștepți jumătate
din interval, mergi fără transbordare și continui pe jos.

Doar biblioteca standard. Rulare:
    python scripts/transit_micro15.py [cale/feed.zip]        # scrie public/micromobilitate/data/transit.json
"""
import csv
import io
import json
import statistics
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FEED = ROOT / "data" / "transport" / "gtfs" / "IASI_GTFS.zip"
OUT = ROOT / "public" / "micromobilitate" / "data" / "transit.json"
PEAK = (7 * 3600, 9 * 3600)
MODE = {"0": 2, "900": 2, "3": 3, "700": 3, "2": 1}   # 1 = tren, 2 = tramvai, 3 = autobuz (ca în pois.json)


def table(z, name):
    with z.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def seconds(t):
    h, m, s = (int(x) for x in t.strip().split(":"))
    return h * 3600 + m * 60 + s


def build(feed):
    z = zipfile.ZipFile(feed)
    weekday = {c["service_id"] for c in table(z, "calendar.txt") if c["monday"] == "1"}
    routes = {r["route_id"]: r for r in table(z, "routes.txt")}
    trips = {t["trip_id"]: t for t in table(z, "trips.txt") if t["service_id"] in weekday}
    times = defaultdict(list)
    for st in table(z, "stop_times.txt"):
        if st["trip_id"] in trips:
            times[st["trip_id"]].append((int(st["stop_sequence"]), st["stop_id"], seconds(st["departure_time"] or st["arrival_time"])))
    stops = {s["stop_id"]: s for s in table(z, "stops.txt")}

    patterns = defaultdict(list)   # (rută, sens, stații) → [(plecare, [timpi relativi])]
    for tid, rows in times.items():
        rows.sort()
        t = trips[tid]
        key = (t["route_id"], t["direction_id"], tuple(r[1] for r in rows))
        t0 = rows[0][2]
        patterns[key].append((t0, [r[2] - t0 for r in rows]))

    # intervalul se calculează pe linie și sens (variantele aceleiași linii circulă alternativ pe tronsonul comun)
    by_dir = defaultdict(list)
    for (rid, d, _seq), runs in patterns.items():
        by_dir[(rid, d)].extend(dep for dep, _ in runs)

    stop_index, stop_list, out = {}, [], []
    for (rid, _d, seq), runs in sorted(patterns.items(), key=lambda kv: (routes[kv[0][0]]["route_short_name"], kv[0][1])):
        r = routes[rid]
        if len(seq) < 2 or r["route_type"] not in MODE:
            continue
        deps = sorted(by_dir[(rid, _d)])
        peak = [d for d in deps if PEAK[0] <= d < PEAK[1]]
        if len(peak) >= 2:
            headway = (PEAK[1] - PEAK[0]) / len(peak)
        elif len(deps) >= 2:
            headway = (deps[-1] - deps[0]) / (len(deps) - 1)
        else:
            continue   # o singură cursă pe zi: nu este o opțiune realistă
        if len(runs) < 2:
            continue   # variantă cu o singură cursă (de exemplu intrarea la depou)
        sel = [rel for d, rel in runs if PEAK[0] <= d < PEAK[1]] or [rel for _, rel in runs]
        cum = [round(statistics.median(col)) for col in zip(*sel)]
        idx = []
        for sid in seq:
            if sid not in stop_index:
                s = stops[sid]
                stop_index[sid] = len(stop_list)
                stop_list.append([round(float(s["stop_lon"]), 5), round(float(s["stop_lat"]), 5), s["stop_name"]])
            idx.append(stop_index[sid])
        out.append({"r": r["route_short_name"], "m": MODE[r["route_type"]], "h": round(headway), "s": idx, "t": cum,
                    "n": len(runs)})
    return {"sursa": "GTFS CTP Iași (Tranzy)", "zi": "lucrătoare", "varf": "07:00–09:00", "stops": stop_list, "patterns": out}


def main():
    feed = Path(sys.argv[1]) if len(sys.argv) > 1 else FEED
    data = build(feed)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    hw = sorted(p["h"] for p in data["patterns"])
    print("Stații: %d; trasee (linie × sens × variantă): %d; interval median la vârf: %.0f min; %s (%.0f kB)"
          % (len(data["stops"]), len(data["patterns"]), statistics.median(hw) / 60, OUT, OUT.stat().st_size / 1e3))


if __name__ == "__main__":
    main()
