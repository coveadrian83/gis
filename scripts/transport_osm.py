#!/usr/bin/env python3
"""Descarcă din OpenStreetMap (Overpass) liniile de transport public din Iași și Zona Metropolitană, pentru comparația
cu traseele și stațiile din data/transport/linii/ (scripts/transport_compara_osm.py).

Se descarcă, în dreptunghiul ZMI: relațiile route=bus / tram / trolleybus / share_taxi (cu geometria membrilor),
relațiile route_master și nodurile stațiilor (highway=bus_stop, railway=tram_stop, public_transport=platform /
stop_position). Rezultatul brut (JSON Overpass) se scrie în data/transport/osm/, câte un fișier pe interogare.

Doar biblioteca standard. Rulare: python scripts/transport_osm.py  (în GitHub Actions: „Date OSM transport public”)
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "transport" / "osm"
BBOX = "46.95,27.30,47.33,27.90"          # sud, vest, nord, est – Zona Metropolitană Iași
SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter",
           "https://overpass.private.coffee/api/interpreter"]
QUERIES = {
    "rute": f"""[out:json][timeout:300];
relation["type"="route"]["route"~"^(bus|tram|trolleybus|share_taxi|minibus)$"]({BBOX});
out body geom;""",
    "route_master": f"""[out:json][timeout:120];
relation["type"="route"]["route"~"^(bus|tram|trolleybus|share_taxi|minibus)$"]({BBOX})->.r;
rel(br.r)["type"="route_master"];
out body;""",
    "statii": f"""[out:json][timeout:180];
(
  node["highway"="bus_stop"]({BBOX});
  node["railway"="tram_stop"]({BBOX});
  node["public_transport"~"^(platform|stop_position)$"]({BBOX});
);
out body;""",
}


def fetch(query):
    last = None
    for attempt in range(3):
        for url in SERVERS:
            try:
                data = urllib.parse.urlencode({"data": query}).encode()
                req = urllib.request.Request(url, data=data, headers={"User-Agent": "mobilitate-iasi/transport (MVI)"})
                with urllib.request.urlopen(req, timeout=360) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:      # server aglomerat / indisponibil: următorul server, apoi o nouă încercare
                last = e
                print(f"  {url}: {e}", file=sys.stderr)
        time.sleep(30 * (attempt + 1))
    raise SystemExit(f"Overpass indisponibil: {last}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, q in QUERIES.items():
        print(f"{name}…", file=sys.stderr)
        d = fetch(q)
        n = len(d.get("elements", []))
        (OUT / f"{name}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{name}: {n} elemente (OSM la {d.get('osm3s', {}).get('timestamp_osm_base')})")
        time.sleep(5)


if __name__ == "__main__":
    main()
