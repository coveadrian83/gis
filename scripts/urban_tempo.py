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

def req(path, body=None, tries=4, raw=False, timeout=180):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    for i in range(tries):
        try:
            r = urllib.request.Request(url, data=data, headers={
                'Content-Type': 'application/json', 'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (analiza-urbana; github.com/coveadrian83/gis)'})
            with urllib.request.urlopen(r, timeout=timeout) as f:
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

# matricea → opțiunile alese pe dimensiunile care nu sunt județ / localitate / an / UM (potrivire pe începutul etichetei,
# fără spații; None = toate opțiunile)
MATRICE = {
    'POP107D': {'Varste si grupe de varsta': ['Total'], 'Sexe': ['Total']},   # populația după domiciliu, 1 ianuarie
    'LOC101B': {'Forme de proprietate': ['Total']},                               # locuințe existente
    'GOS104A': {},                                                                # lungimea străzilor orășenești
    'GOS105A': {},                                                                # străzi orășenești modernizate
    'GOS106B': {},                                                                # rețeaua de distribuție a apei
    'GOS110A': {},                                                                # conductele de canalizare
    'GOS103A': {},                                                                # spațiile verzi (municipii și orașe)
    'GOS108A': {'Destinatia  apei distribuite': None},                           # apa distribuită (total, uz casnic)
    'GOS109A': {},                                                                # energia termică distribuită
    'GOS116A': {},                                                                # rețeaua de gaze
    'GOS118A': {'Destinatia gazelor naturale distribuite': None},                 # gaze distribuite (total, uz casnic)
    'SAN102C': {'Categorii de unitati sanitare': ['In spitale'], 'Forme de proprietate': None},   # paturi în spitale
    'SAN104B': {'Categorii de cadre medico-sanitare': ['Medici'], 'Forme de proprietate': None},  # medici
    'SCL101C': {'Niveluri de educatie': None},                                    # unități de învățământ pe niveluri
    'TUR102C': {'Tipuri de structuri de primire turistica': ['Total', 'Hoteluri']},  # locuri de cazare
    'ART101B': {'Categorii de biblioteci': None},                                 # biblioteci (total, publice)
    'ART103B': None,                                                              # instituții de spectacole
    'ART104A': None,                                                              # muzee
    'SCL107C': {'Niveluri de educatie': ['Total']},                               # săli de gimnastică
    'SCL110B': {'Niveluri de educatie': ['Total']},                               # terenuri de sport
}
ANI = 3   # ultimii ani disponibili (indicatorul folosește cel mai recent an cu valoare)

def opt(o):
    return {'label': o['label'], 'nomItemId': o['nomItemId'], 'offset': o['offset'], 'parentId': o['parentId']}

def norm(t):
    return ' '.join(str(t).split()).lower()

FORMAT = []   # varianta de cerere care a funcționat (detectată la prima cerere)

def pivot(meta, arr):
    """Cererea de date: varianta actuală a TEMPO (encQuery – nomItemId-urile alese, separate prin „,” în interiorul
    unei dimensiuni și prin „:” între dimensiuni) sau varianta veche (arr + matrixDetails)."""
    det = meta['details']
    enc = ':'.join(','.join(str(o['nomItemId']) for o in d) for d in arr)
    variante = {
        'enc': {'encQuery': enc, 'language': 'ro', 'matCode': meta.get('code') or meta['_code'], 'matMaxDim': det['matMaxDim'],
                'matUMSpec': det['matUMSpec'], 'matRegJ': det.get('matRegJ', 0)},
        'arr': {'language': 'ro', 'arr': arr, 'matrixName': meta['matrixName'], 'matrixDetails': det},
    }
    for v in (FORMAT or ['enc', 'arr']):
        t = req('/pivot', variante[v], raw=True, tries=2, timeout=90)
        if t.strip():
            if not FORMAT:
                FORMAT.append(v); print('formatul cererii:', v, flush=True)
            return t
    return ''

def descarca():
    os.makedirs(os.path.join(OUT, 'tempo'), exist_ok=True)
    for code, alege in MATRICE.items():
        dest = os.path.join(OUT, 'tempo', f'{code}.csv')
        try:
            meta = req(f'/matrix/{code}')
            meta['_code'] = code
        except RuntimeError:
            print(code, 'metadate indisponibile'); continue
        det = meta['details']
        dims = meta['dimensionsMap']
        iJ, iL, iT = det['nomJud'] - 1, det['nomLoc'] - 1, det['matTime'] - 1
        sel = []
        for i, d in enumerate(dims):
            if i in (iJ, iL):
                sel.append(None)
            elif i == iT:
                sel.append([opt(o) for o in d['options'][-ANI:]])
            elif d['label'].startswith('UM'):
                sel.append([opt(o) for o in d['options']])
            else:
                want = (alege or {}).get(d['label'].strip()) if alege is not None else None
                if want is None and alege is not None and d['label'].strip() not in alege:
                    want = ['Total']
                os_ = [o for o in d['options'] if want is None or any(norm(o['label']).startswith(norm(w)) for w in want)]
                if not os_:
                    os_ = d['options'][:1]
                sel.append([opt(o) for o in os_])
        rows, header, esecuri, judete = [], None, 0, 0
        for j in dims[iJ]['options']:
            if header is None and judete >= 3:
                print(code, 'abandonat: răspunsuri goale', flush=True); break
            if esecuri >= 3:
                print(code, 'abandonat după 3 eșecuri la rând', flush=True); break
            if j['label'].strip().upper() == 'TOTAL':
                continue
            locs = [o for o in dims[iL]['options'] if o['parentId'] == j['nomItemId']]
            if not locs:
                continue
            judete += 1
            arr = list(sel)
            arr[iJ] = [opt(j)]
            # cereri de cel mult ~150 de localități (limita de celule a serverului)
            for k in range(0, len(locs), 150):
                arr[iL] = [opt(o) for o in locs[k:k + 150]]
                try:
                    t = pivot(meta, arr)
                    esecuri = 0
                except RuntimeError:
                    esecuri += 1
                    print(code, j['label'], 'eșuat', flush=True); continue
                if header is None and t.strip():
                    print(code, 'primul răspuns:', t[:300].replace('\n', ' | '), flush=True)
                lines = [l for l in t.splitlines() if l.strip()]
                if not lines:
                    continue
                if header is None:
                    header = lines[0]
                rows += lines[1:]
            time.sleep(0.3)
        if header:
            open(dest, 'w').write('\n'.join([header] + rows) + '\n')
        print(code, len(rows), 'rânduri', flush=True)

SONDE = {
    'lege_351_2001.html': 'https://legislatie.just.ro/Public/DetaliiDocument/29780',
    'lege_351_2001_afis.html': 'https://legislatie.just.ro/Public/DetaliiDocumentAfis/29780',
    'lege_100_2007.html': 'https://legislatie.just.ro/Public/DetaliiDocument/81574',
    'observator.html': 'https://observatorulteritorial.ro/',
    'insse_rpl.html': 'https://insse.ro/cms/ro/content/rezultate-definitive-ale-recens%C4%83m%C3%A2ntului-popula%C8%9Biei-%C8%99i-locuin%C8%9Belor-runda-2021',
}

def sondeaza():
    """Paginile surselor inaccesibile din alte rețele: le salvăm pentru verificare (texte de lege, portaluri)."""
    d = os.path.join(OUT, 'sonde')
    os.makedirs(d, exist_ok=True)
    for name, url in SONDE.items():
        try:
            r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(r, timeout=60) as f:
                open(os.path.join(d, name), 'wb').write(f.read())
            print(name, 'ok')
        except Exception as e:  # noqa: BLE001
            print(name, e)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--catalog', action='store_true')
    ap.add_argument('--descarca', action='store_true')
    ap.add_argument('--sonde', action='store_true')
    a = ap.parse_args()
    if a.catalog:
        catalog()
    if a.descarca:
        descarca()
    if a.sonde:
        sondeaza()

if __name__ == '__main__':
    main()
