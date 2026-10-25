#!/usr/bin/env python3
"""Descarcă din INS TEMPO-Online (statistici.insse.ro:8077) matricele pe localități folosite la verificarea
indicatorilor minimali ai Legii 351/2001 (anexa 2), pentru harta /urban/.

Rulează în GitHub Actions (.github/workflows/urban-tempo.yml): serverul TEMPO nu e accesibil din orice rețea.
  python scripts/urban_tempo.py --catalog     → data/urban/tempo_catalog.json (toate matricele, cu denumirea)
  python scripts/urban_tempo.py --descarca    → data/urban/tempo/<COD>.csv (matricele din MATRICE, ultimii ani)
Fără dependențe externe (doar biblioteca standard).
"""
import argparse, json, os, sys, time, urllib.request, urllib.error

BASE = 'http://statistici.insse.ro:8077/tempo-ins'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'urban')

def req(path, body=None, tries=4, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        try:
            r = urllib.request.Request(url, data=data, headers={
                'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (analiza-urbana; github.com/coveadrian83/gis)'})
            with urllib.request.urlopen(r, timeout=180) as f:
                t = f.read().decode('utf-8', 'replace')
                return t if raw else json.loads(t)
        except Exception as e:  # noqa: BLE001 – serverul INS cade des; reîncercăm
            print(f'  ! {url}: {e}', file=sys.stderr)
            time.sleep(5 * (i + 1))
    raise RuntimeError(url)

def catalog():
    """Salvează răspunsurile brute ale serverului (lista matricelor, arborele de contexte) și metadatele
    matricelor-candidat, pentru alegerea codurilor din MATRICE."""
    os.makedirs(os.path.join(OUT, 'tempo'), exist_ok=True)
    for name, path in [('tempo_matrices.json', '/matrix/matrices?lang=ro'), ('tempo_contexte.json', '/context/')]:
        try:
            t = req(path, raw=True)
            open(os.path.join(OUT, name), 'w').write(t)
            print(name, len(t), 'octeți')
        except RuntimeError:
            print('indisponibil:', path)
    for code in CANDIDATI:
        try:
            t = req(f'/matrix/{code}', raw=True)
            open(os.path.join(OUT, 'tempo', f'meta_{code}.json'), 'w').write(t)
            print(code, 'ok')
        except RuntimeError:
            print(code, 'lipsă')

# coduri ghicite (se confirmă din catalog): populație, locuințe, apă, canalizare, străzi, spații verzi, paturi, medici,
# cazare, școli, biblioteci, cinematografe, gaze
CANDIDATI = ['POP107D', 'POP105A', 'LOC101B', 'LOC103B', 'GOS106B', 'GOS107A', 'GOS108A', 'GOS109A', 'GOS110A',
             'GOS111A', 'GOS101A', 'GOS102A', 'GOS103A', 'GOS104A', 'GOS105A', 'GOS116A', 'GOS118A', 'SAN101B',
             'SAN102C', 'SAN103B', 'SAN104B', 'TUR101C', 'TUR102C', 'TUR104E', 'SCL101C', 'SCL102C', 'ART101B',
             'ART104A', 'ART113A', 'FOM104D']

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--catalog', action='store_true')
    ap.add_argument('--descarca', action='store_true')
    a = ap.parse_args()
    if a.catalog:
        catalog()

if __name__ == '__main__':
    main()
