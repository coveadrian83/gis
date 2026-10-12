#!/usr/bin/env python3
"""Lista oficială a traseelor metropolitane AMTPI (https://www.amtpi.ro/trasee-2/) → data/transport/amtpi_trasee.json.

Pagina construiește lista în browser dintr-un tablou JavaScript (ROUTES: comună, număr, stațiile principale, link,
proj:true = „în proiect”); scriptul îl extrage. Variantele scrise împreună („23 / 23B”, „501 / 501B”) devin numere
separate. Lista este folosită de scripts/transport_linii.py (statutul liniilor: în exploatare / în proiect) și de
scripts/transport_compara_osm.py (secțiunea AMTPI a raportului).

Doar biblioteca standard. Rulare: python scripts/transport_amtpi.py [pagina.html descărcată]
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://www.amtpi.ro/trasee-2/"
OUT = ROOT / "data" / "transport" / "amtpi_trasee.json"


def js_array(src, name):
    """Tabloul `var NAME = [ … ];` dintr-o pagină, ca listă Python (obiecte JS cu chei fără ghilimele)."""
    i = src.index(f"var {name}")
    body = src[src.index("[", i):src.index("];", i) + 1]
    body = re.sub(r"^\s*//[^\n]*", "", body, flags=re.M)        # comentariile pe rând propriu (nu „https://”)
    body = re.sub(r"([{,]\s*)([A-Za-z_]\w*)\s*:", r'\1"\2":', body)
    body = re.sub(r",\s*([}\]])", r"\1", body)
    return json.loads(body)


def parse(html):
    zones = {z["id"]: z for z in js_array(html, "ZONES")}
    out = []
    for r in js_array(html, "ROUTES"):
        for nr in re.split(r"\s*/\s*", r["nr"]):
            out.append({"linie": nr.replace(" ", "").upper(), "nr_afisat": r["nr"], "comuna": zones.get(r["z"], {}).get("name", r["z"]),
                        "statii": r.get("stops", []), "in_proiect": bool(r.get("proj")), "url": r.get("url")})
    notes = [z["note"] for z in zones.values() if z.get("note")]
    return {"sursa": URL, "linii": out, "note": notes}


def main():
    if len(sys.argv) > 1:
        html = Path(sys.argv[1]).read_text(encoding="utf-8", errors="ignore")
    else:
        req = urllib.request.Request(URL, headers={"User-Agent": "mobilitate-iasi/transport (MVI)"})
        with urllib.request.urlopen(req, timeout=60) as r:
            html = r.read().decode("utf-8", errors="ignore")
    d = parse(html)
    OUT.write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    proj = [x["linie"] for x in d["linii"] if x["in_proiect"]]
    print(f"{len(d['linii'])} linii AMTPI ({', '.join(x['linie'] for x in d['linii'])}); în proiect: {', '.join(proj)} → {OUT}")


if __name__ == "__main__":
    main()
