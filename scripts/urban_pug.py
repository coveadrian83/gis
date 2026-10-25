#!/usr/bin/env python3
"""Registrul documentațiilor de urbanism (PUG) de pe platforma MDLPA „Date Locale” (datelocale.mdlpa.ro), pentru harta
/urban/: pentru fiecare UAT – stadiul PUG-ului, data HCL de aprobare, valabilitatea, prelungirea și existența datelor
spațiale conforme cu Ordinul MDLPA nr. 904/2023.

  python scripts/urban_pug.py   → data/urban/pug_registru.csv
Fișele individuale se păstrează în cache/urban/pug/ (rularea următoare descarcă doar ce lipsește).
"""
import csv, html, os, re, sys, time, urllib.request
from datetime import datetime

BASE = 'https://datelocale.mdlpa.ro'
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
CACHE = os.path.join(ROOT, 'cache', 'urban', 'pug')
OUT = os.path.join(ROOT, 'data', 'urban', 'pug_registru.csv')
LUNI = {m: i + 1 for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}


def get(path, cache=None):
    if cache and os.path.exists(cache):
        return open(cache, encoding='utf-8').read()
    for i in range(3):
        try:
            r = urllib.request.Request(BASE + path, headers={'User-Agent': 'Mozilla/5.0 (analiza-urbana; github.com/coveadrian83/gis)'})
            with urllib.request.urlopen(r, timeout=90) as f:
                t = f.read().decode('utf-8', 'replace')
            if cache:
                open(cache, 'w', encoding='utf-8').write(t)
            return t
        except Exception as e:  # noqa: BLE001
            print('  !', path, e, file=sys.stderr)
            time.sleep(3 * (i + 1))
    return ''


def text(s):
    s = re.sub(r'<script.*?</script>|<style.*?</style>|<svg.*?</svg>', '', s, flags=re.S)
    return ' '.join(html.unescape(re.sub('<[^>]+>', ' ', s)).split())


def data(t, label):
    m = re.search(re.escape(label) + r' (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})', t)
    return '%s-%02d-%02d' % (m.group(3), LUNI.get(m.group(2), 1), int(m.group(1))) if m else ''


def main():
    os.makedirs(CACHE, exist_ok=True)
    s = get('/ro/planning/registru-pug/')
    rows = []
    for tr in re.findall(r'<tr>(.*?)</tr>', s, re.S):
        td = re.findall(r'<td>(.*?)</td>', tr, re.S)
        if len(td) < 7:
            continue
        det = re.search(r'href="(/ro/planning/registru[^"]*/(?:doc-detail)?(\d+)/)"', tr)
        zipf = re.search(r'href="(/media/[^"]+\.zip)"', tr)
        rows.append({'siruta': text(td[0]), 'tip': text(td[1]), 'denumire': text(td[2]), 'judet': text(td[3]),
                     'uat': text(td[4]), 'stadiu': text(td[5]), 'date_spatiale': text(td[6]),
                     'detalii': BASE + det.group(1) if det else '', 'arhiva': BASE + zipf.group(1) if zipf else ''})
    pug = [r for r in rows if r['tip'] == 'PUG']
    print(len(rows), 'documentații,', len(pug), 'PUG')
    for i, r in enumerate(pug):
        if not r['detalii']:
            continue
        key = re.sub(r'\W+', '_', r['detalii'].split('/ro/planning/')[1]).strip('_')
        t = text(get(r['detalii'][len(BASE):], os.path.join(CACHE, key + '.html')))
        r['hcl_aprobare'] = data(t, 'Dată HCL aprobare')
        r['valabil_pana'] = data(t, 'Dată valabilitate documentație')
        r['hcl_prelungire'] = data(t, 'Dată HCL prelungire')
        if i % 200 == 0:
            print(' ', i, r['uat'], r['hcl_aprobare'], r['valabil_pana'], flush=True)
    cols = ['siruta', 'tip', 'denumire', 'judet', 'uat', 'stadiu', 'date_spatiale', 'hcl_aprobare', 'hcl_prelungire',
            'valabil_pana', 'detalii', 'arhiva']
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, cols, extrasaction='ignore')
        w.writeheader()
        for r in pug:
            w.writerow(r)
    print('scris', OUT, datetime.now().isoformat(timespec='seconds'))


if __name__ == '__main__':
    main()
