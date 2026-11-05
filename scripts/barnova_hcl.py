"""Descarcă registrul HCL Bârnova (emol.ro) și clasifică hotărârile 2020–2026.

Utilizare:  python3 scripts/barnova_hcl.py [director_pdf_optional]
Scrie analize/barnova/hcl_2020_2026.csv. Dacă se dă un director cu PDF-uri convertite
(HCL_AAAA_NNN.txt, generate cu pdftotext), satul se caută și în articolele hotărârii.
Coloana „sat” e detectată automat (titlu + articole) și trebuie verificată.
"""
import csv, html, json, math, os, re, subprocess, sys, time

BAZA = 'https://emol.ro/barnova-is/registru-hcl/'
SATE = ['Bârnova', 'Cercu', 'Pietrăria', 'Păun', 'Todirel', 'Vișan']
# străzi cu sat cunoscut (din hotărâri) – folosite doar când satul nu e scris explicit
STRAZI = {'Sf. Ilie': 'Vișan', 'Sf Ilie': 'Vișan', 'Luminii': 'Vișan', 'Lalelelor': 'Păun', 'Cezar Petrescu': 'Păun',
          'Traian Vuia': 'Pietrăria', 'Sf. Apostol Petru': 'Pietrăria', 'Doamna Elena Cuza': 'Pietrăria',
          'Gutuiului': 'Bârnova', 'George Emil Palade': 'Bârnova', 'Dafina Doamna': 'Bârnova', 'Pr. Gheorghe Mireuță': 'Pietrăria'}

CATEGORII = [
    ('buget_aprobat', r'aprobarea bugetului local de venituri (și|si) cheltuieli|anexei suplimentare la bugetul ini'),
    ('buget_previziune', r'previziunii bugetului'),
    ('buget_rectificare', r'(modific|suplimen|rectific)\w*\s+(și\s+\w+\s+)?(a\s+)?(prin suplimentare\s+)?(a\s+)?(buget|bugetului) local'),
    ('executie_bugetara', r'contul(ui)? de execu|execuția bugetelor locale|executia bugetelor locale|situa[tț]iilor financiare'),
    ('urbanism_puz_pug', r'\bp\.?u\.?z\b|plan(ului)? urbanistic|regulament(ului)? local de urbanism'),
    ('drumuri_investitii', r'modernizare drum|modernizarea (infrastructurii rutiere|drum)|asfaltare|trotuar|infrastructurii rutiere|rigole|anghel saligny|cale acces|pist(e|a) pentru bicicli|pietruire'),
    ('drumuri_patrimoniu', r'drum(ul|uri)? (public|de utilitate)|înființare drum|infiintare drum|tronso\w* de drum|declasific|nomenclator\w* stradal|denumir\w* de strad|expropriere drum|centurii'),
    ('transport_public', r'transport public|transportul public|transport (în|in) comun|microbuz|asocia[tț]i\w* metropolitan\w* de transport|program\w* de transport'),
]

def get(url):
    for i in range(4):
        r = subprocess.run(['curl', '-sS', '-m', '90', url], capture_output=True, text=True)
        if r.returncode == 0 and 'data-data' in r.stdout:
            return r.stdout
        time.sleep(2 ** i)
    raise SystemExit('eșec la ' + url)

def pagina(h):
    m = re.search(r'id="react-emol-pagination-registrehcl" data-data="([^"]*)"', h)
    return json.loads(html.unescape(m.group(1)))

def sat_din(text):
    t = text.replace('ş', 'ș').replace('ţ', 'ț')
    gasite = [s for s in SATE if re.search(r'\bsat(ul|ului)?\s+' + s, t, re.I)]
    if not gasite:
        gasite = sorted({v for k, v in STRAZI.items() if k.lower() in t.lower()})
    if re.search(r'municipiul(ui)? iași', t, re.I) and 'extravilan' in t.lower():
        gasite.append('teritoriul mun. Iași')
    return '; '.join(dict.fromkeys(gasite))

def main():
    dir_txt = sys.argv[1] if len(sys.argv) > 1 else None
    randuri = []
    for an in range(2020, 2027):
        d = pagina(get(f'{BAZA}?an={an}'))
        el = list(d['elements'])
        for p in range(2, math.ceil(int(d['totalElements']) / 20) + 1):
            el += pagina(get(f'{BAZA}?an={an}&page={p}'))['elements']
        for e in el:
            titlu = re.sub(r'\s+', ' ', e['nume_ro']).strip()
            cat = [c for c, rx in CATEGORII if re.search(rx, titlu.lower())]
            text = titlu
            fn = dir_txt and os.path.join(dir_txt, f"HCL_{an}_{int(e['numar']):03d}.txt")
            if fn and os.path.exists(fn):
                corp = open(fn, encoding='utf8').read()
                i = max(corp.find('Art. 1'), corp.find('Art.1'), 0)
                j = corp.find('PROCEDURI ADMINISTRATIVE', i)
                text += ' ' + corp[i:j if j > i else None]  # doar articolele, nu considerentele
            randuri.append({'an': an, 'numar': int(e['numar']), 'data': e['dataemitere'],
                             'categorii': ';'.join(cat), 'sat': sat_din(text) if cat else '',
                             'titlu': titlu, 'url': f"{BAZA}{e['id']}/"})
    randuri.sort(key=lambda r: (r['an'], r['numar']))
    out = os.path.join(os.path.dirname(__file__), '..', 'analize', 'barnova', 'hcl_2020_2026.csv')
    with open(out, 'w', newline='', encoding='utf8') as f:
        w = csv.DictWriter(f, fieldnames=list(randuri[0]))
        w.writeheader(); w.writerows(randuri)
    print(len(randuri), 'hotărâri →', os.path.normpath(out))

if __name__ == '__main__':
    main()
