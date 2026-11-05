#!/usr/bin/env python3
"""Preia datele hărții de sine stătătoare „Orașe după Legea 351” (fișier HTML cu `const DATA`, construită separat) în
data/urban/harta_proprie.csv, pe cod SIRUTA, pentru scripts/urban_351.py:
  - tipul UAT-ului (corecții de statut, ex. Băneasa – oraș prin Legea 83/2004, comună în ANCPI și RPL 2021);
  - dotarea locuințelor pe UAT: RPL 2011 (a, b, h, cn) și estimarea 2021 (a2, b2, h2, cn2 – valoarea 2011 a UAT-ului
    ajustată cu evoluția județului 2011–2021, pe scară logit);
  - liceele și școlile postliceale (Rețeaua școlară 2025–2026), locurile în hoteluri (SITUR, structuri clasificate);
  - zona fără orașe din anexa II pct. 6 a Legii 351/2001 (1–17), pentru comunele care o compun.

  python scripts/urban_harta_import.py <harta.html>
"""
import csv, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'urban', 'harta_proprie.csv')
COLS = ['s', 'n', 't', 'a', 'b', 'h', 'cn', 'a2', 'b2', 'h2', 'cn2', 'li', 'pl', 'ho', 'ht', 'z']


def main(src):
    s = open(src, encoding='utf-8').read()
    d = json.loads(re.search(r'const DATA = (\{.*?\});\n', s, re.S).group(1))
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(COLS)
        for x in d['features']:
            p = x['properties']
            w.writerow(['' if p.get(k) is None else p[k] for k in COLS])
    print(len(d['features']), 'UAT →', OUT)


if __name__ == '__main__':
    main(sys.argv[1])
