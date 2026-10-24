#!/usr/bin/env python3
"""Accidentele cu bicicliști și trotinete (Poliția Română, județul Iași, 2022–2026) → datele stratului de siguranță
al hărții „15 minute pe două roți” (public/micromobilitate/).

Intrare: exportul Poliției (xlsx, foaia 1, antetul pe rândul 4: NR, Fisa Serie-Numar, Data, …, Cauza Principala,
Cauza Concurenta, Mod de Producere, Numar Morti, Numar Raniti Grav, Numar Raniti Usor, GPS Latitudine,
GPS Longitudine). Fișierul brut NU se publică (data/accidente/ este în .gitignore).

LIMITĂ ESENȚIALĂ: exportul nu are categoria vehiculelor implicate. Un accident este „cu bicicletă” sau „cu
trotinetă” doar dacă cauza (principală sau concurentă) este „abateri bicicliști” / „abateri conducători trotinete”,
adică biciclistul / trotinetistul a fost găsit vinovat. Accidentele în care un șofer a lovit un biciclist (cauza
„neacordare prioritate vehicule” etc.) NU pot fi separate și lipsesc. Majoritatea celor rămase sunt căderi.

Ieșire:
    public/micromobilitate/data/accidente.json
      puncte  – [lon, lat, an, categorie (1 = bicicletă, 2 = trotinetă), gravitate (0 = ușor / fără victime,
                1 = rănit grav, 2 = mort), în intersecție (0/1), mod de producere (indice în „moduri”)];
                coordonatele rotunjite la 1e-4° (~10 m), fără dată exactă și fără numărul fișei;
      rezumat – pe categorii: pe ani, pe gravitate, pe mod de producere, străzile cu cele mai multe accidente;
      judet   – totalul accidentelor din fișier (toate categoriile), pentru context.
    public/micromobilitate/data/tramvai.json
      șinele de tramvai din OSM (data/transport/osm/sine.json), simplificate, pentru factorul „șine” al scorului.

Rulare (openpyxl):
    python scripts/accidente_velo.py data/accidente/2022-2026_TOTAL_ACC.xlsx
"""
import argparse
import collections
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "micromobilitate" / "data"
CAUSES = {"abateri biciclisti": 1, "abateri conducatori trotinete": 2}
CAT_NAME = {1: "Bicicletă", 2: "Trotinetă"}
BBOX = (27.30, 46.95, 27.90, 47.35)   # județul Iași în jurul municipiului (pentru eliminarea coordonatelor greșite)


def dm(value, hemi):
    """„47N08.8470” / „027E34.2250” (grade și minute zecimale) → grade zecimale; None dacă lipsește sau e invalid."""
    if value is None:
        return None
    s = str(value).strip().upper()
    m = re.match(r"^(\d{1,3})\s*([NSEW])\s*(\d{1,2}(?:\.\d+)?)$", s)
    if m:
        deg, h, minutes = int(m.group(1)), m.group(2), float(m.group(3))
        v = deg + minutes / 60.0
        return -v if h in "SW" else v
    try:   # uneori grade zecimale simple
        return float(s.replace(",", "."))
    except ValueError:
        return None


def simplify(points, tol_m):
    """Douglas–Peucker pe [lon, lat] (metri aproximativi)."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][1])
    xy = [((p[0]) * 111320 * math.cos(lat0), p[1] * 110540) for p in points]

    def rec(i, j, out):
        (x1, y1), (x2, y2) = xy[i], xy[j]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, k = -1, -1
        for t in range(i + 1, j):
            d = abs(dy * (xy[t][0] - x1) - dx * (xy[t][1] - y1)) / L
            if d > best:
                best, k = d, t
        if best > tol_m:
            rec(i, k, out)
            rec(k, j, out)
        else:
            out.append(j)
    keep = [0]
    rec(0, len(points) - 1, keep)
    return [points[i] for i in keep]


def tram_lines():
    src = ROOT / "data" / "transport" / "osm" / "sine.json"
    d = json.loads(src.read_text(encoding="utf-8"))
    lines = []
    for el in d["elements"]:
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        pts = [[g["lon"], g["lat"]] for g in el["geometry"]]
        lines.append([[round(x, 5), round(y, 5)] for x, y in simplify(pts, 2.0)])
    return {"sursa": "OpenStreetMap railway=tram (data/transport/osm/sine.json)", "linii": lines}


def main():
    ap = argparse.ArgumentParser(description="Accidentele cu bicicliști și trotinete pentru harta micromobilității.")
    ap.add_argument("xlsx")
    args = ap.parse_args()
    import openpyxl

    rows = list(openpyxl.load_workbook(args.xlsx, read_only=True).worksheets[0].iter_rows(values_only=True))
    hi = next(i for i, r in enumerate(rows) if r and r[0] == "NR")
    head = [str(h).strip() if h else "" for h in rows[hi]]
    col = {h: i for i, h in enumerate(head)}
    data = [r for r in rows[hi + 1:] if r and r[0] is not None]
    print("Accidente în fișier:", len(data))

    modes, mode_idx = [], {}
    pts, skipped = [], collections.Counter()
    summary = {c: {"ani": collections.Counter(), "gravitate": collections.Counter(), "mod": collections.Counter(),
                   "strazi": collections.Counter(), "intersectie": 0, "total": 0} for c in CAUSES.values()}
    for r in data:
        cause = (str(r[col["Cauza Principala"]] or "").strip(), str(r[col["Cauza Concurenta"]] or "").strip())
        cat = CAUSES.get(cause[0]) or CAUSES.get(cause[1])
        if not cat:
            continue
        year = int(str(r[col["Data"]])[:4])
        dead, grav = int(r[col["Numar Morti"]] or 0), int(r[col["Numar Raniti Grav"]] or 0)
        sev = 2 if dead else (1 if grav else 0)
        inters = 1 if r[col["Intersectie Cu"]] else 0
        mode = str(r[col["Mod de Producere"]] or "necunoscut").strip()
        if mode not in mode_idx:
            mode_idx[mode] = len(modes)
            modes.append(mode)
        s = summary[cat]
        s["total"] += 1
        s["ani"][year] += 1
        s["gravitate"][["usor", "grav", "mort"][sev]] += 1
        s["mod"][mode] += 1
        s["intersectie"] += inters
        street = str(r[col["Strada"]] or "").strip()
        if street:
            s["strazi"][street.title()] += 1
        lat = dm(r[col["GPS Latitudine"]], "N")
        lon = dm(r[col["GPS Longitudine"]], "E")
        if lat is None or lon is None:
            skipped["fără coordonate"] += 1
            continue
        if not (BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]):
            skipped["coordonate în afara zonei"] += 1
            continue
        pts.append([round(lon, 4), round(lat, 4), year, cat, sev, inters, mode_idx[mode]])

    dates = sorted(str(r[col["Data"]])[:10] for r in data)
    out = {
        "sursa": "Poliția Română – accidente rutiere în județul Iași (export 2022–2026)",
        "perioada": [dates[0], dates[-1]],
        "identificare": "cauza principală sau concurentă „abateri bicicliști” / „abateri conducători trotinete”",
        "judet": {"accidente": len(data), "morti": sum(int(r[col["Numar Morti"]] or 0) for r in data),
                  "raniti_grav": sum(int(r[col["Numar Raniti Grav"]] or 0) for r in data)},
        "categorii": {str(k): v for k, v in CAT_NAME.items()},
        "moduri": modes,
        "puncte": pts,
        "fara_coordonate": dict(skipped),
        "rezumat": {CAT_NAME[c]: {"total": s["total"], "intersectie": s["intersectie"],
                                  "ani": {str(k): v for k, v in sorted(s["ani"].items())},
                                  "gravitate": dict(s["gravitate"]), "mod": dict(s["mod"].most_common()),
                                  "strazi": s["strazi"].most_common(15)} for c, s in summary.items()},
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "accidente.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tr = tram_lines()
    (OUT / "tramvai.json").write_text(json.dumps(tr, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for c, s in summary.items():
        print("%s: %d accidente (%d grave/mortale), %d în intersecții; moduri: %s" % (
            CAT_NAME[c], s["total"], s["gravitate"]["grav"] + s["gravitate"]["mort"], s["intersectie"],
            ", ".join("%s %d" % kv for kv in s["mod"].most_common(3))))
    print("Puncte cu coordonate: %d; excluse: %s" % (len(pts), dict(skipped)))
    print("Șine de tramvai: %d linii, %d puncte (%.0f kB)" % (len(tr["linii"]), sum(len(l) for l in tr["linii"]),
                                                              (OUT / "tramvai.json").stat().st_size / 1e3))


if __name__ == "__main__":
    main()
