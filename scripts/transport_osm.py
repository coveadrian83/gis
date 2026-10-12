#!/usr/bin/env python3
"""Descarcă din OpenStreetMap (Overpass) liniile de transport public din Iași și Zona Metropolitană, pentru comparația
cu traseele și stațiile din data/transport/linii/ (scripts/transport_compara_osm.py).

Se descarcă, în dreptunghiul ZMI: relațiile route=bus / tram / trolleybus / share_taxi (cu geometria membrilor),
relațiile route_master și nodurile stațiilor (highway=bus_stop, railway=tram_stop, public_transport=platform /
stop_position). Rezultatul brut (JSON Overpass) se scrie în data/transport/osm/, câte un fișier pe interogare.

Din rutele descărcate se extrag și traseele tramvaiului pe linii (relațiile route=tram ale CTP), în
data/transport/linii/rute_tramvai_osm.geojson, preluat de scripts/transport_linii.py (harta /transport/).

Doar biblioteca standard. Rulare: python scripts/transport_osm.py  (în GitHub Actions: „Date OSM transport public”)
          python scripts/transport_osm.py --doar-tramvai   (doar extragerea tramvaiului din rute.json existent)
"""
import json
import re
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


def export_trams():
    """Relațiile route=tram ale CTP din rute.json → GeoJSON cu linie, tip, rețea, de_la / pana_la și relația OSM."""
    d = json.loads((OUT / "rute.json").read_text(encoding="utf-8"))
    feats = []
    for el in d.get("elements", []):
        t = el.get("tags", {})
        if el.get("type") != "relation" or t.get("route") != "tram":
            continue
        net = " ".join(t.get(k, "") for k in ("network", "operator")).lower()
        if "ctp" not in net and "transport public" not in net and t.get("network:wikidata") != "Q7275888":
            continue
        m = re.match(r"^\s*tram\s+([0-9]{1,3}[a-z]?)\s*:", t.get("name", ""), re.I)
        ref = (m.group(1) if m else t.get("ref", "")).upper()
        lines = [[[round(p["lon"], 6), round(p["lat"], 6)] for p in mb["geometry"]]
                 for mb in el.get("members", []) if mb.get("type") == "way" and len(mb.get("geometry") or []) > 1]
        if not ref or not lines:
            continue
        feats.append({"type": "Feature", "properties": {
            "linie": ref, "tip": "tramvai", "retea": "local", "name": t.get("name"), "from": t.get("from"), "to": t.get("to"),
            "operator": t.get("operator") or "CTP Iași", "full_id": f"r{el['id']}", "osm_type": "relation"},
            "geometry": {"type": "MultiLineString", "coordinates": lines}})
    feats.sort(key=lambda f: (int(re.match(r"\d+", f["properties"]["linie"]).group()), f["properties"]["name"] or ""))
    dest = ROOT / "data" / "transport" / "linii" / "rute_tramvai_osm.geojson"
    dest.write_text(json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False, separators=(",", ":")),
                    encoding="utf-8")
    print(f"tramvai: {len(feats)} trasee ({', '.join(sorted({f['properties']['linie'] for f in feats}, key=lambda r: int(re.match(r'[0-9]+', r).group())))}) → {dest}")


def main():
    if "--doar-tramvai" in sys.argv:
        export_trams()
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for name, q in QUERIES.items():
        print(f"{name}…", file=sys.stderr)
        d = fetch(q)
        n = len(d.get("elements", []))
        (OUT / f"{name}.json").write_text(json.dumps(d, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"{name}: {n} elemente (OSM la {d.get('osm3s', {}).get('timestamp_osm_base')})")
        time.sleep(5)
    export_trams()


if __name__ == "__main__":
    main()
