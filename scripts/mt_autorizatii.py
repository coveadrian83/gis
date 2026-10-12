#!/usr/bin/env python3
"""Autorizațiile de construire emise de Ministerul Transporturilor și Infrastructurii (MTI).

Sursa: https://mt.ro/interes-public/alte-informatii/autorizatii-de-construire
Fiecare an are o categorie (…/autorizatii-<an>) cu câte o pagină pe autorizație (…/autorizatii-<an>/a<N>).
Din fiecare pagină se extrag: numărul și data autorizației, obiectul lucrării, numărul cererii,
valabilitatea, durata de execuție și linkurile către PDF-uri (autorizația și anexa).

Paginile se găsesc din lista categoriei (cu paginare Joomla ?start=N), din legăturile „Prec/Următor”
dintre articole și prin încercarea adreselor a1, a2, … până la câteva lipsuri consecutive.

mt.ro poate refuza conexiunile din afara României; rulați scriptul de pe o conexiune din România.
Alternativ, salvați paginile din browser („Save page as” / „View source”) într-un director și rulați
cu --din-fisiere <director>: scriptul citește toate fișierele .html de acolo, fără rețea.

Rulare (doar biblioteca standard Python):
    python scripts/mt_autorizatii.py                     # anii 2020–anul curent
    python scripts/mt_autorizatii.py --ani 2021,2026
    python scripts/mt_autorizatii.py --descarca-pdf      # salvează și PDF-urile în cache/mt_autorizatii/pdf/
    python scripts/mt_autorizatii.py --din-fisiere ~/Downloads/mt
Rezultate: data/mt_autorizatii.csv, data/mt_autorizatii.json.
Cache HTML (nu se publică): cache/mt_autorizatii/.
"""
import argparse
import csv
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BAZA = "https://mt.ro"
CATEGORIE = "/interes-public/alte-informatii/autorizatii-de-construire"
RADACINA = Path(__file__).resolve().parent.parent
CACHE = RADACINA / "cache" / "mt_autorizatii"
IESIRE_CSV = RADACINA / "data" / "mt_autorizatii.csv"
IESIRE_JSON = RADACINA / "data" / "mt_autorizatii.json"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
PAUZA = 1.0  # secunde între cereri
LIPSURI_MAX = 5  # câte a<N> lipsă consecutive opresc căutarea pe un an

CAMPURI = [
    "an", "nr", "data_emitere", "titlu", "obiect", "nr_inregistrare_cerere",
    "nr_inregistrare_autorizatie", "valabilitate", "durata_executie",
    "pdf_autorizatie", "pdf_anexa", "alte_pdf", "publicat", "url",
]


# ---------------------------------------------------------------- rețea

def descarca(url, binar=False):
    """Întoarce conținutul URL-ului sau None la 404. Folosește cache pe disc."""
    cheie = re.sub(r"[^A-Za-z0-9._-]+", "_", url.replace(BAZA, ""))[:180] or "index"
    fisier = CACHE / ("pdf" if binar else "html") / cheie
    if fisier.exists():
        return fisier.read_bytes() if binar else fisier.read_text("utf-8")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ro-RO,ro;q=0.9"})
    for incercare in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                date = r.read()
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if incercare == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if incercare == 2:
                raise
        time.sleep(2 ** (incercare + 1))
    time.sleep(PAUZA)
    fisier.parent.mkdir(parents=True, exist_ok=True)
    fisier.write_bytes(date)
    return date if binar else date.decode("utf-8", "replace")


# ---------------------------------------------------------------- parsare

def text_curat(fragment):
    t = re.sub(r"<br\s*/?>", " ", fragment, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace(" ", " ").replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip(" -–")


def absolut(href):
    return urllib.parse.urljoin(BAZA + "/", html.unescape(href))


def linkuri_articole(pagina, an):
    """Adresele articolelor dintr-o pagină (listă de categorie sau articol, prin Prec/Următor)."""
    tipar = re.compile(r'href="(%s/autorizatii-%d/[^"#?]+)"' % (re.escape(CATEGORIE), an))
    return {absolut(m) for m in tipar.findall(pagina)}


def parseaza_articol(pagina, url=""):
    """Extrage câmpurile unei autorizații din HTML-ul paginii ei. Întoarce None dacă nu e o autorizație."""
    m = re.search(r'<h2 itemprop="headline">(.*?)</h2>', pagina, re.S)
    if not m:
        return None
    titlu = text_curat(m.group(1))
    if not url:
        m_url = re.search(r'"current_link":"([^"]+)"', pagina)
        url = m_url.group(1).replace("\\/", "/") if m_url else ""
    corp = re.search(r'<div itemprop="articleBody">(.*?)</div>\s*(?:<nav|<div class="article)', pagina, re.S)
    corp = corp.group(1) if corp else pagina

    r = {c: "" for c in CAMPURI}
    r["titlu"], r["url"] = titlu, url
    m_an = re.search(r"/autorizatii-(\d{4})/", url)
    r["an"] = m_an.group(1) if m_an else ""
    m_pub = re.search(r'itemprop="datePublished">\s*(.*?)\s*<|datetime="([^"]+)" itemprop="datePublished"', pagina, re.S)
    if m_pub:
        r["publicat"] = (m_pub.group(2) or "")[:10] or text_curat(m_pub.group(1) or "")

    m_nr = re.search(r"nr\.?\s*(\d+)", titlu, re.I)
    r["nr"] = m_nr.group(1) if m_nr else ""
    m_ob = re.search(r"nr\.?\s*\d+\s*[-–]\s*(.+)$", titlu, re.I)
    r["obiect"] = (m_ob.group(1) if m_ob else titlu).strip()

    # Primul paragraf: „Autorizatie 09/11.03.2021 - descarcare”
    m_ac = re.search(r"Autoriza[tț]i[ea]\s*(?:nr\.?)?\s*(\d+)\s*/\s*(\d{1,2}\.\d{1,2}\.\d{4})", text_curat(corp), re.I)
    if m_ac:
        r["nr"] = r["nr"] or str(int(m_ac.group(1)))
        r["data_emitere"] = m_ac.group(2)

    for li in re.findall(r"<li[^>]*>(.*?)</li>", corp, re.S):
        t = text_curat(li)
        cheie, _, val = t.partition(" - ")
        k = cheie.lower()
        val = val.strip()
        if "cerere" in k:
            r["nr_inregistrare_cerere"] = val
        elif "continut" in k or "conținut" in k:
            r["obiect"] = val.strip("„”\"“ ") or r["obiect"]
        elif "autoriza" in k and ("data" in k or "numar" in k or "număr" in k):
            r["nr_inregistrare_autorizatie"] = val
            if not r["data_emitere"]:
                m_d = re.search(r"\d{1,2}\.\d{1,2}\.\d{4}", val)
                r["data_emitere"] = m_d.group(0) if m_d else ""
        elif "valabilitate" in k:
            r["valabilitate"] = val
        elif "executie" in k or "execuție" in k:
            r["durata_executie"] = val

    # PDF-uri: fiecare link „descarcare” aparține etichetei din fața lui (Autorizatie / Anexa).
    # Paginile conțin uneori linkuri rătăcite din alte autorizații; se păstrează doar cele cu text.
    alte = []
    for m_a in re.finditer(r'<a\s+href="([^"]+\.pdf)"[^>]*>(.*?)</a>', corp, re.S | re.I):
        if not text_curat(m_a.group(2)):
            continue
        link = absolut(m_a.group(1))
        inainte = text_curat(corp[max(0, m_a.start() - 300):m_a.start()]).lower()
        eticheta = inainte.rsplit("descarcare", 1)[-1]
        if "anex" in eticheta and not r["pdf_anexa"]:
            r["pdf_anexa"] = link
        elif "autoriza" in eticheta and not r["pdf_autorizatie"]:
            r["pdf_autorizatie"] = link
        else:
            alte.append(link)
    r["alte_pdf"] = " ".join(alte)
    return r


# ---------------------------------------------------------------- colectare

def articole_an(an):
    baza = f"{BAZA}{CATEGORIE}/autorizatii-{an}"
    gasite = set()
    for start in range(0, 2000, 10):
        pagina = descarca(f"{baza}?start={start}" if start else baza)
        if pagina is None:
            break
        noi = linkuri_articole(pagina, an) - gasite
        if not noi:
            break
        gasite |= noi
    lipsuri, n = 0, 1
    while lipsuri < LIPSURI_MAX:
        url = f"{baza}/a{n}"
        if url not in gasite:
            pagina = descarca(url)
            if pagina is None or "itemprop=\"headline\"" not in pagina:
                lipsuri += 1
            else:
                lipsuri = 0
                gasite.add(url)
                gasite |= linkuri_articole(pagina, an)
        else:
            lipsuri = 0
        n += 1
    return sorted(gasite)


def ordine(r):
    try:
        return (int(r["an"] or 0), int(r["nr"] or 0))
    except ValueError:
        return (int(r["an"] or 0), 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ani", help="ani separați prin virgulă (implicit 2020–anul curent)")
    ap.add_argument("--din-fisiere", type=Path, help="director cu pagini HTML salvate din browser (fără rețea)")
    ap.add_argument("--descarca-pdf", action="store_true", help="salvează și PDF-urile în cache")
    a = ap.parse_args()

    rezultate = {}
    if a.din_fisiere:
        for f in sorted(a.din_fisiere.rglob("*.htm*")):
            r = parseaza_articol(f.read_text("utf-8", "replace"))
            if r:
                rezultate[r["url"] or str(f)] = r
    else:
        ani = [int(x) for x in a.ani.split(",")] if a.ani else list(range(2020, dt.date.today().year + 1))
        for an in ani:
            try:
                urluri = articole_an(an)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                sys.exit(f"mt.ro nu răspunde ({e}). Încercați de pe o conexiune din România sau cu --din-fisiere.")
            print(f"{an}: {len(urluri)} pagini", file=sys.stderr)
            for url in urluri:
                r = parseaza_articol(descarca(url) or "", url)
                if r:
                    rezultate[url] = r

    randuri = sorted(rezultate.values(), key=ordine)
    if a.descarca_pdf:
        for r in randuri:
            for link in [r["pdf_autorizatie"], r["pdf_anexa"], *r["alte_pdf"].split()]:
                if link:
                    descarca(link, binar=True)

    IESIRE_CSV.parent.mkdir(parents=True, exist_ok=True)
    with IESIRE_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPURI)
        w.writeheader()
        w.writerows(randuri)
    IESIRE_JSON.write_text(json.dumps(randuri, ensure_ascii=False, indent=1), "utf-8")
    print(f"{len(randuri)} autorizații → {IESIRE_CSV.relative_to(RADACINA)}, {IESIRE_JSON.relative_to(RADACINA)}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
