#!/usr/bin/env python3
"""Rutele curente din API-ul de date deschise Tranzy (https://tranzy.ai/opendata/, agenția 1 = CTP Iași).

Pozițiile GPS ale vehiculelor poartă codul rutei din Tranzy (route_id). Orarul GTFS din proiect
(data/transport/gtfs/IASI_GTFS.zip) poate fi mai vechi decât codurile folosite acum de vehicule – ex. multe tramvaie
raportate pe „ruta 65”, care lipsește din orar – iar acele vehicule nu pot fi legate de o linie. Scriptul descarcă
lista rutelor (număr, tip, nume) și o salvează; scripts/transport_sanatate.py face din ea corespondența
cod Tranzy → linia din orar (după numărul liniei și tipul vehiculului).

Cheia API: variabila de mediu TRANZY_API_KEY (în GitHub: Settings → Secrets and variables → Actions). Fără cheie,
scriptul nu face nimic. Ieșire: data/transport/tranzy_rute.json. Doar biblioteca standard.
Rulare: TRANZY_API_KEY=… python scripts/transport_tranzy.py
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "transport" / "tranzy_rute.json"
API = "https://api.tranzy.ai/v1/opendata/"
AGENCY = "1"


def get(endpoint, key):
    req = urllib.request.Request(API + endpoint, headers={"X-API-KEY": key, "X-Agency-Id": AGENCY, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read().decode("utf-8"))
    return data.get("data", data) if isinstance(data, dict) else data


def routes(raw):
    """Lista Tranzy → { route_id: { linie, tip, nume } } (tip: route_type 0 = tramvai, restul autobuz)."""
    out = {}
    for r in raw or []:
        rid = r.get("route_id")
        if rid is None:
            continue
        out[str(rid)] = {
            "linie": str(r.get("route_short_name") or "").strip(),
            "tip": "tramvai" if str(r.get("route_type")) == "0" else "autobuz",
            "nume": (r.get("route_long_name") or r.get("route_desc") or "").strip(),
        }
    return dict(sorted(out.items(), key=lambda kv: (len(kv[0]), kv[0])))


def main():
    key = (os.environ.get("TRANZY_API_KEY") or "").strip().strip("\"'").strip()
    if not key:
        print("Lipsește TRANZY_API_KEY – rutele Tranzy nu se actualizează.")
        return 0
    rute = routes(get("routes", key))
    if not rute:
        print("Tranzy nu a întors nicio rută.", file=sys.stderr)
        return 1
    OUT.write_text(json.dumps({"sursa": "Tranzy – CTP Iași (https://tranzy.ai/opendata/)", "rute": rute},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(rute)} rute")
    return 0


if __name__ == "__main__":
    sys.exit(main())
