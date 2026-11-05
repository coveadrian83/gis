#!/usr/bin/env python3
"""Indicatori pe UAT din proiectul geo-spatial.org „Unde locuiesc românii?” (github.com/geospatialorg/unde-locuiesc-romanii),
pentru harta /urban/ – acolo unde INS nu publică date pe UAT:
  - populația RPL 2021 (grila de 1 km) din localitățile cu acces la rețeaua de gaze naturale (branșate sau branșabile;
    atribut per localitate din intravilanul ANCPI/CNGCFT) – pentru estimarea încălzirii centrale (indicatorul 5);
  - spitalele active din registrul ANMCS din fiecare UAT – un UAT fără spital are 0 paturi în spitale (indicatorul 6).

  git clone --depth 1 https://github.com/geospatialorg/unde-locuiesc-romanii.git <dir>
  python scripts/urban_ulr.py <dir>      → data/urban/ulr_uat.csv
Necesită pyarrow, pyogrio, shapely; limitele UAT vin din cache/urban (scripts/urban_351.py).
"""
import csv, json, os, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'urban', 'ulr_uat.csv')


def main(repo):
    import pyarrow.parquet as pq
    import pyogrio.raw, shapely
    d = os.path.join(repo, 'data', 'out')
    core = pq.read_table(os.path.join(d, 'core.parquet'), columns=['cell_id', 'pop_total']).to_pydict()
    env = pq.read_table(os.path.join(d, 'env.parquet'), columns=['cell_id', 'siruta', 'acces_gaz']).to_pydict()
    pop = dict(zip(core['cell_id'], core['pop_total']))
    agg = {}
    for cid, sir, gaz in zip(env['cell_id'], env['siruta'], env['acces_gaz']):
        if sir is None:
            continue
        a = agg.setdefault(int(sir), [0, 0, 0])
        p = pop.get(cid) or 0
        a[0] += p                       # populația pe grilă
        if gaz is not None:
            a[1] += p                   # în intravilan
            if gaz == 'conectat':
                a[2] += p               # în localități cu acces la gaze
    # spitalele ANMCS în poligoanele UAT (GISCO LAU 2024)
    hosp = json.load(open(os.path.join(d, 'hospitals.geojson'), encoding='utf-8'))['features']
    pts = shapely.points([f['geometry']['coordinates'] for f in hosp])
    _m, _f, geom, fields = pyogrio.raw.read(os.path.join(ROOT, 'cache', 'urban', 'LAU_RG_01M_2024_4326.gpkg'),
                                           where="CNTR_CODE='RO'")
    polys = shapely.from_wkb(geom)
    tree = shapely.STRtree(polys)
    sp = {}
    for i, j in zip(*tree.query(pts, predicate='within')):
        s = int(fields[0][j].split('_')[1])
        sp.setdefault(s, []).append(hosp[i]['properties'].get('nume') or '')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f)
        w.writerow(['siruta', 'pop_grila', 'pop_intravilan', 'pop_acces_gaz', 'spitale_anmcs', 'spitale'])
        for s in sorted(set(agg) | set(sp)):
            a = agg.get(s, [0, 0, 0])
            w.writerow([s] + [int(x) for x in a] + [len(sp.get(s, [])), ' | '.join(sp.get(s, []))])
    print('UAT:', len(agg), '· spitale localizate:', sum(len(v) for v in sp.values()), 'din', len(hosp), '·', OUT)


if __name__ == '__main__':
    main(sys.argv[1])
