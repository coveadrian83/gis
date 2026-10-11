#!/usr/bin/env python3
"""PUZ-urile aprobate / respinse de Consiliul Local Iași, cu localizare pe hartă.

Sursa principală: textul integral al hotărârilor (HCL) din registrul https://hcl.usr.ro/iasi/<an>
(oglindă a hotărârilor publicate de Primăria Iași; fiecare fișă are linkul către PDF-ul oficial
de pe www.primaria-iasi.ro). Din fiecare HCL se extrag: număr, dată, statut (aprobat/respins),
adresă, identificare cadastrală, funcțiune, suprafața reglementată, regim de înălțime, H max,
POT/CUT, spații verzi, voturi și – unde textul le conține – numărul de apartamente și de locuri
de parcare. Unde hotărârea nu le conține, apartamentele și locurile de parcare se caută în articolele
apix.ro despre PUZ-uri (API-ul WordPress al site-ului), potrivite după identificarea cadastrală, adresă și
suprafață; valorile preluate din presă poartă sursa (link) și mențiunea „estimare” când textul o indică.
Corecturile și completările manuale se pun în data/puz_iasi_completari.csv și au prioritate.

Localizare: Nominatim (OpenStreetMap), cel mult o cerere pe secundă, cu cache; dacă numărul
poștal nu e găsit se folosește strada, apoi zona. Fiecare punct primește zona MVA–MVI,
cartierul (OSM) și UAT-ul ZMI.

Rulare (doar biblioteca standard Python):
    python scripts/puz_iasi.py                 # toți anii 2016–anul curent
    python scripts/puz_iasi.py --ani 2024,2025 # doar anumiți ani
    python scripts/puz_iasi.py --fara-geocodare --fara-apix
Rezultate: public/data/puz_iasi.geojson, public/data/puz_iasi.csv,
           public/data/puz_iasi_de_verificat.csv (PUZ-uri nelocalizate sau localizate aproximativ).
Cache (nu se publică): cache/puz/.
"""
import argparse
import csv
import datetime as dt
import html
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "puz"
DATA = ROOT / "public" / "data"
COMPLETARI = ROOT / "data" / "puz_iasi_completari.csv"
AUTOR = "Prelucrarea și integrarea datelor: dr. geogr. Adrian Covăsnianu"
PARCELE = ROOT / "data" / "puz_parcele.geojson"   # extras din parcelarul OCPI cu scripts/puz_parcele.py

USR = "https://hcl.usr.ro"
NOMINATIM = "https://nominatim.openstreetmap.org"
UA = "gis-iasi-puz/1.0 (+https://github.com/coveadrian83/gis)"
# Cutia de căutare pentru geocodare: municipiul Iași și comunele limitrofe (lon_min, lat_max, lon_max, lat_min)
VIEWBOX = "27.40,47.28,27.80,47.05"


# ---------------------------------------------------------------- descărcare

_last = {}


def http_get(url, *, pause=1.0, tries=4, timeout=60):
    """GET cu pauză între cereri către același host și reîncercări (serverele resetează uneori conexiunea)."""
    host = urllib.parse.urlsplit(url).netloc
    for attempt in range(tries):
        wait = _last.get(host, 0) + pause - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ro"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 – orice eroare de rețea se reîncearcă
            if attempt == tries - 1:
                raise
            print(f"  reîncerc ({e}) {url}", file=sys.stderr)
            time.sleep(3 * (attempt + 1))


def cached(path, url, **kw):
    if path.exists() and path.stat().st_size:
        return path.read_text(encoding="utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    text = http_get(url, **kw).decode("utf-8", errors="replace")
    path.write_text(text, encoding="utf-8")
    return text


# hotărâre al cărei obiect este un PUZ (nu doar o mențiune „conform PUZ aprobat”)
NOT_PUZ = re.compile(r"deviz|indicator\w*\s+tehnico|implementar|proiect\w*\s+european|cofinant|finantar|asociere|concesion|inchiriere|vanzare")
PUZ_TITLE = re.compile(r"privind\s+(?:\S+\s+){0,10}?(?:planul\w*\s+urbanistic\w*(?:\s+zonal|\s+pentru\s+zona)|p\.?u\.?z\b)", re.I)


def list_decisions(year, refresh):
    """Lista hotărârilor PUZ dintr-un an: (id, număr, dată, titlu)."""
    path = CACHE / "usr" / f"{year}.html"
    if refresh and path.exists():
        path.unlink()
    page = cached(path, f"{USR}/iasi/{year}")
    out = []
    for hid, h3, title in re.findall(
            rf'<a href="/iasi/{year}/(h\d+)"[^>]*><h3>([^<]*)</h3></a>([^<]*)', page):
        title = clean(title)
        m = PUZ_TITLE.search(fold(title))
        if not m or NOT_PUZ.search(fold(title)[:m.end()]):
            continue
        m = re.search(r"(\d+)/(\d{4})", h3)
        nr = int(m.group(1)) if m else None
        m = re.search(r"(\d{2})\.(\d{2})\.(\d{4})", h3)
        date = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None   # lipsește uneori: se ia din text
        out.append({"id": f"{year}/{hid}", "nr": nr, "data": date, "titlu": title})
    return out


def decision_text(dec):
    page = cached(CACHE / "usr" / f"{dec['id']}.html", f"{USR}/iasi/{dec['id']}")
    pdf = re.search(r'href="(https?://[^"]*primaria-iasi\.ro[^"]*\.pdf[^"]*)"', page, re.I)
    body = re.sub(r"<script.*?</script>|<style.*?</style>", " ", page, flags=re.S)
    text = clean(re.sub(r"<[^>]+>", " ", body))
    i = text.find("HOTĂRÂRE")
    text = text[i:] if i >= 0 else text
    j = text.find("Informații GDPR")
    text = text[:j] if j >= 0 else text
    if pdf:
        pdf = urllib.parse.quote(html.unescape(pdf.group(1)), safe=":/?&=$%+#~,;@!*()'")
        pdf = pdf.replace("://primaria-iasi.ro", "://www.primaria-iasi.ro")
    return text, pdf


# ---------------------------------------------------------------- extragere

def clean(s):
    s = html.unescape(s or "")
    s = s.replace(" ", " ").replace("ş", "ș").replace("ţ", "ț").replace("Ş", "Ș").replace("Ţ", "Ț")
    return re.sub(r"\s+", " ", s).strip()


def fold(s):
    """Fără diacritice, litere mici – pentru căutări tolerante."""
    s = unicodedata.normalize("NFKD", s or "")
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def num(s):
    """'19.085,00' / '19085.00' / '1 800' → 19085.0"""
    s = s.strip().replace(" ", "")
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", s):
        s = s.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d+,\d+", s):
        s = s.replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(,\d{3})+(\.\d+)?", s):
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


STATUS = [
    (re.compile(r"privind\s+respingerea", re.I), "respins"),
    (re.compile(r"privind\s+(?:aprobarea\s+)?(?:modificar|completar|rectificar|indreptar|actualizar)\w*", re.I), "modificare"),
    (re.compile(r"privind\s+(?:abrogar|revocar|incetar)\w*", re.I), "abrogare"),
    (re.compile(r"privind\s+(?:aprobarea\s+)?prelungir\w*", re.I), "prelungire"),
    (re.compile(r"privind\s+aprobarea", re.I), "aprobat"),
]


def status_of(title):
    t = fold(title)
    for rx, st in STATUS:
        if rx.search(t):
            return st
    return "altul"


# Adresa: tot ce urmează după „zonal (Iași)” până la „identificare cadastrală” / „elaborat”
ADDR = re.compile(
    r"(?:zonal\w*|protejat\w*)\s*(?:,\s*)?(?:(?:municipiul\s+)?ia[sș]i\s*,?\s*)?(.*?)\s*,?\s*"
    r"(?=identificar|nr\.?\s*cadastral|numar\s+cadastral|cad\.|cartea\s+funciara|elaborat|intocmit|pentru\s+|in\s+vederea|persoan|$)",
    re.I)
CAD = re.compile(r"(?:identificare\s+cadastral\w*|nr\.?\s*cadastral\w*|numar\w*\s+cadastral\w*|cadastral\w*)"
                 r"\s*(?:nr\.?\s*)?:?\s*((?:\d{4,7}\s*(?:,|si|și|\s)\s*)*\d{4,7})", re.I)
PURPOSE = re.compile(r"(?:elaborat\w*|intocmit)\s+(.*?)(?:,?\s*persoan\w+\s+(fizic\w*|juridic\w*)|$)", re.I)


def parse_address(title):
    m = ADDR.search(fold(title).replace("ş", "s"))
    if not m:
        return None
    # recuperez forma cu diacritice din titlul original, pe aceeași poziție
    start, end = m.span(1)
    raw = title[start:end] if len(fold(title)) == len(title) else m.group(1)
    raw = re.sub(r"\(([^)]*)\)?", r" \1 ", raw)
    raw = re.sub(r"\s+", " ", raw)
    raw = re.sub(r"^\W+|\W+$", "", raw)
    return raw or None


def parse_cadastral(text):
    ids = []
    for m in CAD.finditer(text[:3000]):
        ids += re.findall(r"\d{4,7}", m.group(1))
    return sorted(set(ids), key=ids.index)


def parse_purpose(title):
    m = PURPOSE.search(title)
    if not m:
        return None, None
    p = re.sub(r"^(?:pentru|in vederea|în vederea)\s+", "", m.group(1).strip(" ,"), flags=re.I)
    who = m.group(2)
    return p, ("fizică" if who and fold(who).startswith("fizic") else "juridică" if who else None)


FUNCTII = [  # ordinea contează: prima potrivire dă funcțiunea principală
    ("modificare PUZ anterior", r"^(?:\w+\s+){0,3}?(?:modificar|actualizar|reactualizar)\w*\s+(?:partial\w*\s+)?(?:a\s+)?(?:puz|planului|indicator|regulament|conformatie|hcl|hotarar)"),
    ("mixt (locuire + servicii)", r"regenerar\w*\s+urban"),
    ("locuințe colective", r"ansamblu\w*\s+re[sz]idential|locuinte\s+cu\s+functiuni|locuint\w*[^.;]{0,40}?colectiv|bloc|ansamblu\s+rezidential|complex\s+rezidential|imobil\w*\s+de\s+locuint|apartament"),
    ("mixt (locuire + servicii)", r"functiun\w*\s+mixt|ansamblu\s+mixt|multifunctional"),
    ("locuințe individuale", r"\bunei\s+locuint|locuinta\s+(?:pe|si|anexe|unifamiliala|p\+)|locuint\w*\s+individual|locuint\w*\s+unifamilial|locuint\w*\s+cuplat|locuint\w*\s+insiruit|locuinta\b|case\b|vil[ae]\b|lotizare|parcelare"),
    ("industrie / depozitare", r"\bhal[ae]\b|depozit|productie|industrial|logistic|atelier|fabric"),
    ("echipamente publice", r"scoal|gradinit|spital|clinic|medical|terapie|biseric|lacas\s+de\s+cult|sport|universit|cresa|educat|sanatate|cimitir|parc\b|adapost|neuro|camin|centru\s+social|casa\s+social|muzeu|arhiv|pangar|eparhi|manastir|monument|liceu|administrativ|primari|sala\s+polivalent|formare"),
    ("comerț / servicii / birouri", r"comert|comercial|servicii|birou|office|hotel|cazare|showroom|statie\s+(?:de\s+)?(?:carburant|distributie)|spalatorie|restaurant|service\s+auto|economic|sediu|afaceri|conferint"),
    ("infrastructură / transport", r"drum|strada\s+noua|parcaj|parcare|statie|retea|pod\b|acces\s+rutier"),
    ("introducere în intravilan", r"intravilan"),
    ("extindere / transformare clădiri", r"extinder|supraetaj|reabilitar|schimbar\w*\s+(?:de\s+)?destinat|modernizar|consolidar|restaurar|recompartiment|mansard"),
]


def classify(text):
    t = fold(text or "")
    for name, rx in FUNCTII:
        if re.search(rx, t):
            return name
    return "altele"


def parse_area(text):
    """Suprafața terenului reglementat (mp)."""
    t = fold(text)
    pats = [
        r"suprafat\w*\s+(?:totala\s+)?(?:a\s+)?(?:terenului\s+)?(?:reglementat\w*|studiat\w*|care\s+a\s+generat)[^0-9]{0,60}?([\d\.\s,]+)\s*(mp|m2|m²|ha)",
        r"suprafat\w*\s+(?:totala\s+)?(?:a\s+)?terenului[^0-9]{0,40}?([\d\.\s,]+)\s*(mp|m2|m²|ha)",
        r"\bs\s*teren\w*\s*=\s*([\d\.\s,]+)\s*(mp|m2|m²|ha)",
    ]
    for p in pats:
        m = re.search(p, t)
        if m:
            v = num(m.group(1))
            if v:
                return round(v * 10000 if m.group(2) == "ha" else v, 2)
    return None


def norm_levels(s):
    """Regim de înălțime normalizat: '2s + p + 6e + e retras' → '2S+P+6E+ER'."""
    s = re.sub(r"\s+", "", s).upper().replace("ET.", "E").replace("ETAJE", "E").replace("ETAJ", "E")
    s = re.sub(r"E?RETRA\w*", "ER", s)
    parts = []
    for part in s.strip(".+").split("+"):
        m = re.match(r"(\d*)(ETH|ETR|ER|E|R|M|PD|P|DS|D|S)", part)
        if m:
            parts.append(m.group(1) + {"ETR": "ER"}.get(m.group(2), m.group(2)))
    return "+".join(parts)


def level_count(rh):
    """Niveluri supraterane din regimul de înălțime: P+4E+5ER → 6 (subsolul, demisolul și etajul tehnic nu se numără)."""
    if not rh:
        return None
    n, seen_e = 0, False
    for part in rh.split("+"):
        m = re.fullmatch(r"(\d*)(ETH|ER|E|R|M|PD|P|DS|D|S)", part)
        if not m or m.group(2) in ("S", "D", "DS", "ETH"):
            continue
        k, t = m.group(1), m.group(2)
        if t in ("ER", "R"):          # etaj retras: „5ER” = al 5-lea etaj, retras → un nivel
            n += 1
        elif t == "E":
            n += 1 if (seen_e or not k) else int(k)   # „6E+7E” → 7 etaje, nu 13
            seen_e = True
        elif t == "M":
            n += int(k) if k else 1
        else:                          # parter
            n += 1
    return n or None


def parse_heights(text):
    """Toate regimurile de înălțime și H max; întoarce (regim maxim, nr. niveluri, H max m, lista)."""
    regs = []
    for m in re.finditer(
            r"(?:regim\w*\s+de\s+inaltime|numar\w*\s+(?:maxim\s+)?de\s+niveluri(?:\s+propuse)?|niveluri\s+propuse|rh\s*max\w*|r\.h\.)"
            r"\s*(?:maxim\w*|max\.?|propus\w*)?\s*[:=]?\s*([^;•\n]{3,40})", fold(text)):
        frag = m.group(1)
        lm = re.search(r"((?:\d?[sd]\s*\+\s*)*p\w?\s*(?:\+\s*\d*\s*[a-z\.]{1,6}\s*)*)", frag)
        if lm:
            r = norm_levels(lm.group(1))
            if r and "P" in r.split("+")[0:4] + [""] and r not in regs:
                regs.append(r)
    hs = []
    for m in re.finditer(r"h\s*max\w*\s*(?:=|:)?\s*(?:la\s+\w+(?:/\w+)?\s+de\s+)?([\d,\.]+)\s*m\b", fold(text)):
        v = num(m.group(1))
        if v and 2 < v < 250:
            hs.append(v)
    best = max(regs, key=lambda r: level_count(r) or 0) if regs else None
    return best, level_count(best), (max(hs) if hs else None), regs


def parse_pot_cut(text):
    t = fold(text)
    pots = [num(x) for x in re.findall(r"p\.?o\.?t\.?\s*(?:max\w*|propus\w*)?\s*[=:]?\s*([\d,\.]+)\s*%", t)]
    cuts = [num(x) for x in re.findall(r"c\.?u\.?t\.?\s*(?:max\w*|propus\w*)?\s*[=:]?\s*([\d,\.]+)", t)]
    green = [num(x) for x in re.findall(r"spati\w*\s+verz\w*[^0-9%]{0,30}?([\d,\.]+)\s*%", t)]
    pots = [p for p in pots if p is not None and 0 < p <= 100]
    cuts = [c for c in cuts if c is not None and 0 < c <= 20]
    green = [g for g in green if g is not None and 0 < g <= 100]
    return (max(pots) if pots else None, max(cuts) if cuts else None, min(green) if green else None)


def parse_counts(text):
    """Număr de apartamente / unități locative și locuri de parcare, dacă apar în text."""
    t = fold(text)
    ap = None
    for p in [r"(\d{1,4})\s*(?:de\s+)?(?:apartamente|unitati\s+locative|unitati\s+de\s+locuit)",
              r"(?:numar\w*|nr\.?)\s+(?:maxim\s+)?(?:de\s+)?(?:apartamente|unitati\s+locative)\s*[:=]?\s*(\d{1,4})"]:
        vals = [int(x) for x in re.findall(p, t)]
        if vals:
            ap = max(vals)
            break
    pk = None
    for p in [r"(\d{1,4})\s*(?:de\s+)?locuri\s+de\s+(?:parcare|parcaj)",
              r"(?:numar\w*|nr\.?)\s+(?:minim\s+|total\s+)?(?:de\s+)?locuri\s+(?:de\s+)?(?:parcare|parcaj)\s*[:=]?\s*(\d{1,4})",
              r"(\d{1,4})\s*locuri\s+(?:auto|parcare)"]:
        vals = [int(x) for x in re.findall(p, t)]
        if vals:
            pk = max(vals)
            break
    return ap, pk


def parse_votes(text):
    m = re.search(r"total\s+consilieri\s+locali\s*:?\s*(\d+)\s*prezen\w*\s*:?\s*(\d+)\s*pentru\s*:?\s*(\d+)\s*"
                  r"impotriva\s*:?\s*(\d+)\s*abtineri\s*:?\s*(\d+)", fold(text))
    if not m:
        return {}
    k = ["total", "prezenti", "pentru", "impotriva", "abtineri"]
    return dict(zip(k, map(int, m.groups())))


ANON = re.compile(r"\bX[x]{2,}\b")


def official_title(pdf_url, hid):
    """Titlul din PDF-ul oficial (registrul USR anonimizează uneori numele de persoane, inclusiv în numele străzilor)."""
    if not pdf_url or not shutil.which("pdftotext"):
        return None
    path = CACHE / "pdf" / (hid.replace("/", "_") + ".pdf")
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = pdf_url
        try:
            path.write_bytes(http_get(url, pause=1.5, timeout=120))
        except Exception as e:  # noqa: BLE001
            print(f"  PDF indisponibil: {url} ({e})", file=sys.stderr)
            return None
    try:
        out = subprocess.run(["pdftotext", "-l", "2", str(path), "-"], capture_output=True, text=True, timeout=60).stdout
    except Exception:  # noqa: BLE001
        return None
    m = re.search(r"(privind\s.*?)(?:Consiliul\s+Local\s+al\s+Municipiului|Având|Avand)", clean(out), re.S | re.I)
    return clean(m.group(1)) if m else None


MONTHS = {"ianuarie": 1, "februarie": 2, "martie": 3, "aprilie": 4, "mai": 5, "iunie": 6, "iulie": 7,
          "august": 8, "septembrie": 9, "octombrie": 10, "noiembrie": 11, "decembrie": 12}


def date_from_text(text, year):
    t = fold(text)
    m = re.search(r"\bnr\.?\s*\d+\s+din\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})", t)
    if m and m.group(2) in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"sedint\w*\s+\w+\s+din\s+(?:data\s+de\s+)?(\d{1,2})\.(\d{1,2})\.(\d{4})", t)
    if m and m.group(3) == str(year):
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def capacity_apartments(func, area, cut):
    """Capacitate teoretică (apartamente) din indicatori: ADC max = suprafață × CUT; 80% din ADC locuibil,
    75 mp ADC pe apartament; la funcțiunile mixte jumătate din ADC se consideră locuire. Doar pentru locuințe colective /
    mixte – este un plafon, nu numărul din proiect."""
    if not area or not cut:
        return None
    share = {"locuințe colective": 1.0, "mixt (locuire + servicii)": 0.5}.get(func)
    return int(area * cut * share * 0.8 / 75) if share else None


def parse_decision(dec, text, pdf):
    title = dec["titlu"]
    if not dec.get("data"):
        dec = {**dec, "data": date_from_text(text, dec["id"].split("/")[0])}
    if ANON.search(title):
        better = official_title(pdf, dec["id"])
        if better and not ANON.search(better):
            title = "HOTĂRÂRE " + better
    purpose, who = parse_purpose(title)
    art1 = text[text.find("HOTĂRĂȘTE"):] if "HOTĂRĂȘTE" in text else text
    rh, niv, hmax, regs = parse_heights(art1)
    pot, cut, green = parse_pot_cut(art1)
    area = parse_area(art1)
    func = classify(purpose or title)
    ap, pk = parse_counts(art1)
    aviz = []
    for which in ("Comisia pentru Amenajarea Teritoriului", "Comisia Juridic"):
        m = re.search(r"avizul\s+(favorabil|nefavorabil)[^;]{0,120}?" + which, text, re.I)
        if m:
            aviz.append(("CATU" if "Amenajarea" in which else "juridică") + ": " + m.group(1).lower())
    year = dec["id"].split("/")[0]
    return {
        "hcl": f"{dec['nr']}/{year}" if dec["nr"] else dec["id"],
        "nr": dec["nr"],
        "data": dec["data"],
        "an": int(year),
        "statut": status_of(title),
        "adresa": parse_address(title),
        "cadastral": ", ".join(parse_cadastral(title + " " + text)),
        "scop": purpose,
        "beneficiar": who,
        "functiune": func,
        "suprafata_mp": area,
        "regim_inaltime": rh,
        "niveluri_max": niv,
        "h_max_m": hmax,
        "regimuri_utr": "; ".join(regs),
        "pot_max": pot,
        "cut_max": cut,
        "spatii_verzi_min": green,
        "adc_max_mp": round(area * cut) if area and cut else None,
        "apartamente_capacitate": capacity_apartments(func, area, cut),
        "apartamente": ap,
        "locuri_parcare": pk,
        "sursa_apartamente": "HCL" if ap else None,
        "sursa_parcare": "HCL" if pk else None,
        "avize_comisii": "; ".join(aviz),
        **{f"vot_{k}": v for k, v in parse_votes(text).items()},
        "titlu": title,
        "url_usr": f"{USR}/iasi/{dec['id']}",
        "url_pdf": pdf,
    }


# ---------------------------------------------------------------- completări manuale

def apply_completari(rows):
    if not COMPLETARI.exists():
        return 0
    by = {r["hcl"]: r for r in rows}
    n = 0
    with COMPLETARI.open(encoding="utf-8") as f:
        for c in csv.DictReader(f):
            r = by.get((c.get("hcl") or "").strip())
            if not r:
                continue
            for k, src in (("apartamente", "sursa_apartamente"), ("locuri_parcare", "sursa_parcare")):
                v = (c.get(k) or "").strip()
                if v.isdigit():
                    r[k] = int(v)
                    r[src] = (c.get("sursa") or "completare").strip()
            for k in ("lat", "lon"):
                v = (c.get(k) or "").strip()
                if v:
                    r["_" + k] = float(v)
            if (c.get("nota") or "").strip():
                r["nota"] = c["nota"].strip()
            n += 1
    return n


# ---------------------------------------------------------------- apix.ro

APIX = "https://apix.ro/wp-json/wp/v2/posts"
APIX_QUERIES = ["PUZ", "plan urbanistic zonal"]

NUM_WORDS = {
    "un": 1, "una": 1, "unu": 1, "o": 1, "doi": 2, "doua": 2, "trei": 3, "patru": 4, "cinci": 5, "sase": 6,
    "sapte": 7, "opt": 8, "noua": 9, "zece": 10, "unsprezece": 11, "doisprezece": 12, "douasprezece": 12,
    "treisprezece": 13, "paisprezece": 14, "patrusprezece": 14, "cincisprezece": 15, "saisprezece": 16,
    "saptesprezece": 17, "optsprezece": 18, "nouasprezece": 19, "douazeci": 20, "treizeci": 30,
    "patruzeci": 40, "cincizeci": 50, "saizeci": 60, "saptezeci": 70, "optzeci": 80, "nouazeci": 90, "o suta": 100,
}
NUMW = r"(\d{1,3}(?:[\.\s]\d{3})+|\d{1,5}|" + "|".join(sorted(NUM_WORDS, key=len, reverse=True)) + r")"
AP_RX = re.compile(NUMW + r"\s+(?:de\s+)?(?:noi\s+)?(?:apartamente|unitati\s+locative|unitati\s+de\s+locuit|locuinte(?!\s+individuale))\b")
PK_RX = re.compile(NUMW + r"\s+(?:de\s+)?(?:locuri\s+de\s+(?:parcare|parcaj)|locuri\s+(?:auto|parcare)|parcari|parcaje)\b")


def word_num(s):
    s = s.strip()
    if s in NUM_WORDS:
        return NUM_WORDS[s]
    v = num(s.replace(" ", "."))
    return int(v) if v is not None else None


def apix_posts(refresh=False):
    """Toate articolele apix.ro care conțin „PUZ” / „plan urbanistic zonal” (text + dată + link), cu cache pe pagini."""
    posts = {}
    for q in APIX_QUERIES:
        page = 1
        while True:
            path = CACHE / "apix" / f"{fold(q).replace(' ', '_')}_{page:03d}.json"
            if refresh and path.exists():
                path.unlink()
            url = APIX + "?" + urllib.parse.urlencode({
                "search": q, "per_page": 100, "page": page, "orderby": "date", "order": "desc",
                "_fields": "id,date,link,title,content"})
            try:
                data = json.loads(cached(path, url, pause=1.5, timeout=120))
            except Exception as e:  # noqa: BLE001 – pagina de după ultima întoarce 400
                if page == 1:
                    print(f"apix.ro indisponibil ({e})", file=sys.stderr)
                break
            if not isinstance(data, list) or not data:
                break
            for p in data:
                text = clean(re.sub(r"<[^>]+>", " ", p["content"]["rendered"]))
                posts[p["id"]] = {"date": p["date"][:10], "link": p["link"],
                                  "title": clean(p["title"]["rendered"]), "text": text,
                                  "fold": fold(clean(p["title"]["rendered"]) + " . " + text)}
            if len(data) < 100:
                break
            page += 1
    return list(posts.values())


STOP_NAMES = {"iasi", "zona", "strada", "nr", "fundac", "intrarea", "aleea", "soseaua", "bulevardul", "calea",
              "drumul", "tarla", "parcela", "municipiul"}


def match_keys(r):
    """Cheile după care un articol se leagă de PUZ: (regex, scor, descriere)."""
    keys = []
    for cad in (r.get("cadastral") or "").split(", "):
        if len(cad) >= 5:
            keys.append((re.compile(rf"\b{cad}\b"), 3, f"cadastral {cad}", cad))
    a = fold(r.get("adresa") or "")
    a = re.sub(r"\b(?:str|sos|bd|b-dul|al|intr|nr)\b\.?", " ", a)
    a = re.sub(STREET_TYPES, " ", a)
    first = re.split(r",|\s+si\s+", a)[0]
    m = re.match(r"\s*(.*?\D)\s+(\d+[a-z]?)\b", first)
    name = (m.group(1) if m else first).strip(" .")
    name_words = [w for w in re.findall(r"[a-z0-9\-]+", name) if w not in STOP_NAMES]
    if name_words:
        nrx = r"\b" + r"\W+".join(map(re.escape, name_words)) + r"\b"
        if m:
            nr_ = m.group(2)
            pre = r"[^.;]{0,20}?\bnr\.?\s*" if nr_.isdigit() and int(nr_) < 10 else r"[^.;]{0,20}?\b(?:nr\.?\s*)?"
            keys.append((re.compile(nrx + pre + re.escape(nr_) + r"\b(?!\s*(?:ha|hectare|mp|etaj|blocuri|%))"), 3,
                         f"adresă {name} {m.group(2)}", name_words[-1]))
        if len(" ".join(name_words)) >= 6:
            keys.append((re.compile(nrx), 1, f"nume {name}", name_words[-1]))
    return keys


def area_variants(mp):
    """Formele în care o suprafață apare în presă: 19.085 mp, 19085 mp, 1,9 ha, 1,91 hectare.
    Suprafețele rotunde (5.000 mp, 2 ha) apar prea des ca să identifice un proiect și nu se folosesc."""
    if not mp or mp % 500 == 0:
        return []
    out = {f"{int(round(mp)):,}".replace(",", "."), str(int(round(mp)))}
    ha = mp / 10000
    if ha >= 0.5:
        for d in (1, 2):
            out.add(f"{ha:.{d}f}".replace(".", ","))
    return [re.compile(rf"(?<![\d,\.]){re.escape(v)}\s*(?:mp|m2|metri|ha|hectare)") for v in out]


def capacity(r):
    """Valori maxime plauzibile (apartamente, locuri de parcare) pentru un PUZ, din suprafață și CUT.
    0 = indicatorul nu se aplică funcțiunii (ex. apartamente într-o hală); None = fără limită cunoscută."""
    area, cut = r.get("suprafata_mp"), r.get("cut_max")
    func = r.get("functiune")
    adc = area * (cut or 4.0) if area else None          # aria desfășurată maximă
    cap_ap = None if adc is None else int(adc / 35) + 1    # ≥ 35 mp ADC pe apartament
    cap_pk = None if adc is None else int((adc + area) / 25) + 1  # supraterane + un nivel subteran pe tot terenul
    if func in ("industrie / depozitare", "comerț / servicii / birouri", "echipamente publice", "infrastructură / transport"):
        cap_ap = 0
    if func == "locuințe individuale":
        cap_ap = 0 if area and area < 3000 else cap_ap
    return cap_ap, cap_pk


def enrich_apix(rows, posts):
    """Caută fiecare PUZ în articolele apix.ro și preia apartamente / parcări din vecinătatea mențiunii."""
    n_ap = n_pk = n_art = 0
    for r in rows:
        if r["statut"] == "respins" and not r.get("adresa"):
            continue
        keys = match_keys(r)
        areas = area_variants(r.get("suprafata_mp"))
        d0 = dt.date.fromisoformat(r["data"]) if r.get("data") else None
        found = []
        for p in posts:
            if d0:
                dp = dt.date.fromisoformat(p["date"])
                if not (d0 - dt.timedelta(days=4 * 365) <= dp <= d0 + dt.timedelta(days=545)):
                    continue
            t = p["fold"]
            score, spans, why = 0, [], []
            for rx, s, desc, needle in keys:
                if needle not in t:
                    continue
                hits = [mm.span() for mm in rx.finditer(t)]
                if hits:
                    score += s
                    spans += hits
                    why.append(desc)
            # suprafața contează doar lângă o mențiune a adresei (≤ 400 de caractere)
            near = [mm.span() for rx in areas for mm in rx.finditer(t)
                    if any(abs(mm.start() - a0) <= 400 for a0, _ in spans)] if score else []
            if near:
                score += 2
                why.append("suprafață")
                spans += near
            if score < 3:
                continue
            # articol dedicat proiectului (adresa/cadastralul apare în titlu) → tot textul;
            # altfel (liste de proiecte, articole despre mai multe investiții) → doar textul de după mențiune
            title_f = fold(p["title"])
            dedicated = any(needle in title_f for _, sc, _, needle in keys if sc >= 1) and len(t) < 12000
            if dedicated:
                wins = [t]
            else:
                wins = [t[max(0, a0 - 120):a0 + 550] for a0, _ in sorted(spans)]
            aps, pks = [], []
            for w in wins:
                aps += [word_num(mm.group(1)) for mm in AP_RX.finditer(w)][:1]
                pks += [word_num(mm.group(1)) for mm in PK_RX.finditer(w)][:1]
            ctx = " ".join(wins)
            found.append({"score": score, "date": p["date"], "link": p["link"], "title": p["title"], "why": why,
                          "ap": [v for v in aps if v], "pk": [v for v in pks if v], "ctx": ctx})
        if not found:
            continue
        found.sort(key=lambda f: (-f["score"], abs((dt.date.fromisoformat(f["date"]) - d0).days) if d0 else 0))
        r["apix_articole"] = " | ".join(f["link"] for f in found[:5])
        n_art += 1
        cap_ap, cap_pk = capacity(r)
        for key, src, field, cap in (("ap", "sursa_apartamente", "apartamente", cap_ap),
                                     ("pk", "sursa_parcare", "locuri_parcare", cap_pk)):
            if r.get(field) or cap == 0:
                continue
            for f in found:
                ok = [v for v in f[key] if (cap is None or v <= cap) and v >= 2]
                if ok:
                    v = ok[0]
                    est = bool(re.search(r"estim|ar putea|aproximativ|circa|peste\s+" + str(v)[:2] + r"|cel putin", f["ctx"]))
                    r[field] = v
                    r[src] = f"apix.ro{' (estimare)' if est else ''}: {f['link']}"
                    if field == "apartamente":
                        n_ap += 1
                    else:
                        n_pk += 1
                    break
    return n_art, n_ap, n_pk


# ---------------------------------------------------------------- parcele (OCPI / eTerra)

def load_parcels(path=PARCELE):
    """Numărul cadastral → (lon, lat, arie mp, geometrie GeoJSON), din extrasul data/puz_parcele.geojson."""
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {f["properties"]["cad"]: (f["properties"]["lon"], f["properties"]["lat"], f["properties"]["arie_mp"],
                                     f["geometry"]) for f in data["features"]}


def locate_by_parcels(r, parcels):
    """PUZ-ul pe parcelele lui: (lat, lon, geometrii) sau None.
    Se acceptă doar dacă suprafața parcelelor e compatibilă cu suprafața reglementată (0,3–3×): numerele
    cadastrale vechi, scurte, din hotărârile 2016–2017 pot coincide cu alte parcele din numerotarea actuală."""
    cads = [c for c in (r.get("cadastral") or "").split(", ") if c in parcels]
    if not cads:
        return None
    area = sum(parcels[c][2] for c in cads)
    supr = r.get("suprafata_mp")
    if supr:
        if not 0.3 <= area / supr <= 3:
            return None
    elif any(len(c) < 6 for c in cads):
        return None
    big = max(cads, key=lambda c: parcels[c][2])
    lon0, lat0 = parcels[big][0], parcels[big][1]
    near = [c for c in cads if merc_dist(parcels[c][0], parcels[c][1], lon0, lat0) < 1000 ** 2]   # parcelele grupate
    w = sum(parcels[c][2] for c in near) or 1
    lon = sum(parcels[c][0] * parcels[c][2] for c in near) / w
    lat = sum(parcels[c][1] * parcels[c][2] for c in near) / w
    return lat, lon, [parcels[c][3] for c in cads]


# ---------------------------------------------------------------- geocodare

STREET_TYPES = r"(?:strada|str\.?|soseaua|sos\.?|șoseaua|bulevardul|bd\.?|b-dul|calea|aleea|al\.?|fundac\w*|intrarea|intr\.?|drumul|piata|piața|splaiul|ulita|stradela|trecatoarea|trecătoarea)"


TYPE_CANON = [  # forma din HCL → tipul de stradă din OSM
    (r"str(?:ada)?\.?", "strada"), (r"s(?:o|ș)s(?:eaua)?\.?", "soseaua"), (r"b(?:ulevardul|ulervadul|d|-dul|dul)\.?", "bulevardul"),
    (r"calea", "calea"), (r"al(?:eea)?\.?", "aleea"), (r"fundac(?:ul)?|fundatura", "fundacul"), (r"intr(?:area)?\.?", "intrarea"),
    (r"drumul", "drumul"), (r"pia(?:t|ț)a", "piata"), (r"splaiul", "splaiul"), (r"stradela", "stradela"),
    (r"trec(?:a|ă)toarea", "trecatoarea"), (r"ulita", "ulita"), (r"pasajul", "pasajul"), (r"canton(?:ul)?", "cantonul"),
]
TYPE_RX = re.compile(r"^(" + "|".join(t for t, _ in TYPE_CANON) + r")\s+", re.I)
TITLES = r"\b(?:prof|profesor|dr|doc|docent|doctor|serg|sergent|sg|mr|maior|lt|locotenent|cpt|capitan|col|colonel|gen|general|sf|sfantul|sfanta|ing|inginer|pr|preot|acad|academician|av|aviator|cap|slt|plt|mitropolit|poet|pictor|actor|compozitor)\b\.?"


def street_key(s):
    """Cheie de comparare a numelor de străzi: fără tip, titluri, diacritice și cratime; „ioan” = „ion”."""
    s = re.sub(TITLES, " ", fold(s))
    s = re.sub(r"[^a-z0-9 ]", " ", s.replace("-", " "))
    s = re.sub(r"\bioan\b", "ion", s)
    return re.sub(r"\s+", " ", s).strip()


def split_address(addr):
    """'strada Prof. Eduard Caudella nr. 30, ...' → ('strada', 'eduard caudella', '30'); zonele → (None, None, None, 'bucium')."""
    if not addr:
        return None
    a = fold(addr)
    a = re.sub(r"^(?:(?:c\.?\s?p\.?|pentru\s+zona\s+construita\s+protejata)\s+)?(?:(?:municipiul\s+)?[li]a[sș]i\b[\s,\-]*)+", "", a)  # „lasi” = „Iași” citit greșit
    a = re.sub(r"^c\.?\s?p\.?\s+", "", a)
    a = re.sub(r"\b(nr\.?\s*)+", "nr. ", a)
    a = re.sub(r"(\d)\s*bis\b", r"\1", a)
    a = re.sub(r"\b(?:t|tarla)\s*\d+\w*\b|\bp(?:arcela)?\s*\d+\w*\b|\bcf\s*\d+|\bf\.?n\.?\b", " ", a)
    a = re.sub(r"\s+", " ", a).strip(" ,.-")
    zone = None
    zm = re.match(r"(?:zona|extravilan(?:ul)?|intravilan(?:ul)?)\s+(.+)", a)
    if zm:
        zone = re.split(r",|\s+-\s+|\s+–\s+|\(", zm.group(1))[0].strip()
        return None, None, None, zone
    first = re.split(r",|\s+si\s+(?=str|sos|bd|bul|calea|aleea|fundac|intr)", a)[0].strip()
    # a doua stradă sau o paranteză lipită de prima („strada X fn strada Y nr. 3”, „fosta Uzinei”, „zona …”)
    first = re.split(r"\s+(?=(?:strada|str\.|soseaua|sos\.|bulevardul|bd\.|b-dul|aleea|fundac\w*|stradela|intrarea|calea|zona|fosta|carte|cartea|identificar|t\s?\d)\b)", first)[0].strip()
    tm = TYPE_RX.match(first)
    typ = None
    if tm:
        for rx, canon in TYPE_CANON:
            if re.fullmatch(rx, tm.group(1), re.I):
                typ = canon
                break
        first = first[tm.end():]
    nm = re.search(r"\bnr\.?\s*(\d+[a-z]?)\b|\s(\d+[a-z]?)\b(?!\s*(?:mai|iunie|iulie|august|ianuarie|decembrie))", first)
    number = (nm.group(1) or nm.group(2)) if nm else None
    name = street_key(first[:nm.start()] if nm else first)
    if not name:
        return None
    return typ, name, number, None


def address_queries(addr):
    """Interogări Nominatim, de la precis la aproximativ: (interogare, precizie)."""
    sp = split_address(addr)
    if not sp:
        return []
    typ, name, number, zone = sp
    if zone:
        return [(f"{zone.title()}, Iași", "zonă")]
    street = f"{typ + ' ' if typ else ''}{name}"
    out = []
    if number:
        out.append((f"{street} {number.upper()}, Iași", "număr"))
    out.append((f"{street}, Iași", "stradă"))
    return out


def merc_dist(lon1, lat1, lon2, lat2):
    kx = 111320 * __import__("math").cos(__import__("math").radians((lat1 + lat2) / 2))
    return ((lon1 - lon2) * kx) ** 2 + ((lat1 - lat2) * 110540) ** 2


OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]
# toate străzile cu nume din municipiul Iași (cutia UAT-ului, apoi filtrate pe poligon)
OVERPASS_Q = '[out:json][timeout:600][maxsize:536870912];way["highway"]["name"](47.08,27.47,47.24,27.71);out tags center qt;'
OVERPASS_MIN = 3000   # tronsoane cu nume sub care răspunsul e considerat trunchiat (Iașiul are câteva mii de străzi)


def overpass_streets(path):
    """Străzile cu nume din OpenStreetMap (Overpass), cu cache: [(nume, lon, lat), …]. None dacă nu se pot obține
    complet (un răspuns cu „remark” sau cu prea puține tronsoane nu se păstrează)."""
    if path.exists():
        ways = json.loads(path.read_text(encoding="utf-8"))
        if len(ways) >= OVERPASS_MIN:
            return ways
    body = urllib.parse.urlencode({"data": OVERPASS_Q}).encode()
    best = None
    for url in OVERPASS:
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=300) as r:
                data = json.loads(r.read())
            out = [(w["tags"]["name"], w["center"]["lon"], w["center"]["lat"])
                   for w in data.get("elements", []) if w.get("center") and w.get("tags", {}).get("name")]
            print(f"  Overpass ({url}): {len(out)} străzi cu nume"
                  + (f"; mesaj: {data['remark']}" if data.get("remark") else ""), file=sys.stderr)
            if len(out) >= OVERPASS_MIN and not data.get("remark"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
                return out
            if out and (best is None or len(out) > len(best)):
                best = out          # răspuns parțial: folosit în rularea curentă, nesalvat
        except Exception as e:  # noqa: BLE001
            print(f"  Overpass indisponibil ({url}: {e})", file=sys.stderr)
    return best


class OSMStreets:
    """Străzile cu nume din OpenStreetMap din municipiul Iași: nume → puncte pe stradă.
    Sursa: Overpass (toate străzile, cu cache în cache/puz/osm_strazi_v2.json); dacă Overpass nu răspunde, rețeaua
    pietonală a hărții 15 minute (public/15min/data/iasi), unde însă multe străzi centrale apar doar ca trotuare
    fără nume."""

    def __init__(self, base=ROOT / "public" / "15min" / "data" / "iasi", cache=CACHE / "osm_strazi_v2.json"):
        self.idx = {}
        self.source = None
        # PUZ-urile votate de CL Iași sunt pe teritoriul municipiului: se păstrează doar străzile din UAT Iași
        # (altfel strada Crișan din centru ar putea ajunge în Valea Lupului)
        iasi = [ps for key, ps in load_polys(DATA / "zmi_uat_web.geojson",
                                             lambda p: p.get("canonical_name") or p.get("name")) if key == "Iași"]
        inside = (lambda lon, lat: which([("Iași", iasi[0])], lon, lat)) if iasi else (lambda lon, lat: True)
        ways = overpass_streets(cache)
        if ways:
            self.source = "Overpass" + ("" if len(ways) >= OVERPASS_MIN else " (parțial)")
            for name, lon, lat in ways:
                if inside(lon, lat):
                    self._add(name, lon, lat, 1.0)
            if len(ways) >= OVERPASS_MIN:
                return
        # rețeaua pietonală a hărții 15 minute: rezervă sau completare pentru un răspuns Overpass parțial
        try:
            import struct
            raw = (base / "graph.bin").read_bytes()
            ver, n_n, n_e, _ = struct.unpack_from("<4I", raw, 0)
            ll = struct.unpack_from(f"<{2 * n_n}i", raw, 16)
            eu = struct.unpack_from(f"<{n_e}I", raw, 16 + 8 * n_n)
            ev = struct.unpack_from(f"<{n_e}I", raw, 16 + 8 * n_n + 4 * n_e)
            lf = struct.unpack_from(f"<{n_e}I", raw, 16 + 8 * n_n + 8 * n_e)
            names = json.loads((base / "edges.json").read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"rețeaua OSM locală nu e disponibilă ({e})", file=sys.stderr)
            return
        self.source = (self.source + " + " if self.source else "") + "rețeaua pietonală 15 minute"
        for e, ni in names["name"]:
            u, v = eu[e], ev[e]
            lon = (ll[2 * u] + ll[2 * v]) / 2e5
            lat = (ll[2 * u + 1] + ll[2 * v + 1]) / 2e5
            if inside(lon, lat):
                self._add(names["names"][ni], lon, lat, (lf[e] >> 2) / 10)

    def _add(self, raw_name, lon, lat, weight):
        full = fold(raw_name)
        tm = TYPE_RX.match(full)
        typ = None
        if tm:
            for rx, canon in TYPE_CANON:
                if re.fullmatch(rx, tm.group(1), re.I):
                    typ = canon
                    break
            full = full[tm.end():]
        self.idx.setdefault(street_key(full), {}).setdefault(typ, []).append((lon, lat, weight))

    @staticmethod
    def _center(pts):
        """Punctul de pe stradă cel mai apropiat de centrul ponderat cu lungimea tronsoanelor."""
        w = sum(p[2] for p in pts) or 1
        cx = sum(p[0] * p[2] for p in pts) / w
        cy = sum(p[1] * p[2] for p in pts) / w
        best = min(pts, key=lambda p: merc_dist(p[0], p[1], cx, cy))
        return best[1], best[0]

    def find(self, typ, name):
        if not self.idx or not name:
            return None
        cand = self.idx.get(name)
        if not cand:   # potrivire pe cuvinte: „stefan cel mare” ⊂ „stefan cel mare si sfant”
            words = set(name.split())
            if len(name) < 5:
                return None
            keys = [k for k in self.idx if words <= set(k.split())]
            if not keys:
                return None
            cand = self.idx[min(keys, key=lambda k: abs(len(k) - len(name)))]
        pts = cand.get(typ) or (cand.get(None) if typ in (None, "strada") else None) or \
            (max(cand.values(), key=len) if typ in (None, "strada") else None)
        return self._center(pts) if pts else None


def zone_centroids():
    out = {}
    for f in json.loads((DATA / "iasi_17_zone_mva_mvi.geojson").read_text(encoding="utf-8"))["features"]:
        g = f["geometry"]
        ring = (g["coordinates"][0] if g["type"] == "Polygon" else max(g["coordinates"], key=lambda p: len(p[0]))[0])
        lon = sum(p[0] for p in ring) / len(ring)
        lat = sum(p[1] for p in ring) / len(ring)
        for part in re.split(r"\s+[–-]\s+", fold(f["properties"]["zone_name"])):
            out[part.strip()] = (lat, lon)
    return out


class Geocoder:
    """Localizare: număr poștal prin Nominatim (dacă OSM îl are) → strada din rețeaua OSM locală → strada prin
    Nominatim → zona (cele 17 zone MVA–MVI sau Nominatim). La primul refuz (429) Nominatim nu mai e folosit în rularea
    curentă; rezultatele obținute rămân în cache și se completează la rulările următoare."""

    def __init__(self, path):
        self.path = path
        self.cache = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        self.blocked = False
        self.streets = OSMStreets()
        print(f"străzi OSM pentru localizare: {self.streets.source} ({len(self.streets.idx)} denumiri în UAT Iași)",
              file=sys.stderr)
        self.zones = zone_centroids()
        iasi = [ps for key, ps in load_polys(DATA / "zmi_uat_web.geojson",
                                             lambda p: p.get("canonical_name") or p.get("name")) if key == "Iași"]
        self.iasi = iasi[0] if iasi else None

    def in_iasi(self, hit):
        """Rezultatele la nivel de număr / stradă trebuie să fie în municipiu: un PUZ votat de CL Iași nu poate fi pe
        strada omonimă dintr-o comună vecină (ex. Lascăr Catargi din Valea Lupului)."""
        return self.iasi is None or bool(which([("Iași", self.iasi)], float(hit["lon"]), float(hit["lat"])))

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=0), encoding="utf-8")

    def search(self, q):
        if q not in self.cache:
            if self.blocked:
                return None
            url = (f"{NOMINATIM}/search?" + urllib.parse.urlencode({
                "q": q, "format": "jsonv2", "addressdetails": 1, "limit": 1, "countrycodes": "ro",
                "viewbox": VIEWBOX, "bounded": 1}))
            try:
                self.cache[q] = json.loads(http_get(url, pause=1.5, tries=1))
            except Exception as e:  # noqa: BLE001
                if "429" in str(e) or "403" in str(e):
                    self.blocked = True
                    print(f"  Nominatim refuză cererile ({e}); continui cu rețeaua OSM locală", file=sys.stderr)
                else:
                    print(f"  geocodare eșuată: {q} ({e})", file=sys.stderr)
                return None
            if len(self.cache) % 20 == 0:
                self.save()
        res = self.cache[q]
        return res[0] if res else None

    def cartier_at(self, lat, lon):
        """Cartierul OSM (suburb / quarter / neighbourhood) prin geocodare inversă, cu cache."""
        q = f"reverse:{lat:.4f},{lon:.4f}"
        if q not in self.cache:
            if self.blocked:
                return None
            url = f"{NOMINATIM}/reverse?" + urllib.parse.urlencode(
                {"lat": f"{lat:.5f}", "lon": f"{lon:.5f}", "format": "jsonv2", "zoom": 16, "addressdetails": 1})
            try:
                self.cache[q] = [json.loads(http_get(url, pause=1.5, tries=1))]
            except Exception as e:  # noqa: BLE001
                if "429" in str(e) or "403" in str(e):
                    self.blocked = True
                    print(f"  Nominatim refuză cererile ({e}); cartierele rămân necompletate", file=sys.stderr)
                return None
        res = self.cache[q]
        return self._cartier(res[0]) if res and isinstance(res[0], dict) else None

    @staticmethod
    def _cartier(hit):
        a = hit.get("address", {})
        return a.get("suburb") or a.get("quarter") or a.get("neighbourhood") or a.get("city_district")

    def locate(self, addr):
        sp = split_address(addr)
        if not sp:
            return None
        typ, name, number, zone = sp
        qs = dict((p, q) for q, p in address_queries(addr))
        if number:
            hit = self.search(qs["număr"])
            if hit and hit.get("address", {}).get("house_number") and self.in_iasi(hit):
                return float(hit["lat"]), float(hit["lon"]), "număr", self._cartier(hit), qs["număr"]
        if name:
            pt = self.streets.find(typ, name)
            if pt:
                return pt[0], pt[1], "stradă", None, f"OSM: {typ or ''} {name}".strip()
            hit = self.search(qs["stradă"])
            if hit and hit.get("addresstype") not in ("city", "town", "village", "county", "state", "country") \
                    and self.in_iasi(hit):
                return float(hit["lat"]), float(hit["lon"]), "stradă", self._cartier(hit), qs["stradă"]
        if zone:
            for k, (lat, lon) in self.zones.items():
                if k and (re.search(rf"\b{re.escape(k)}\b", zone) or re.search(rf"\b{re.escape(zone)}\b", k)):
                    return lat, lon, "zonă", None, f"zona MVA–MVI {k}"
            hit = self.search(qs["zonă"])
            if hit:
                return float(hit["lat"]), float(hit["lon"]), "zonă", self._cartier(hit), qs["zonă"]
            pt = self.streets.find(None, zone)        # „Zona Moara de Vânt” → strada Moara de Vânt
            if pt:
                return pt[0], pt[1], "zonă", None, f"OSM: {zone}"
        return None


# ---------------------------------------------------------------- încadrare spațială

def load_polys(path, keyf):
    out = []
    for f in json.loads(path.read_text(encoding="utf-8"))["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        out.append((keyf(f["properties"]), polys))
    return out


def in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def which(polys, lon, lat):
    for key, ps in polys:
        for p in ps:
            if in_ring(lon, lat, p[0]) and not any(in_ring(lon, lat, h) for h in p[1:]):
                return key
    return None


# ---------------------------------------------------------------- ieșiri

FIELDS = ["hcl", "nr", "data", "an", "statut", "adresa", "cadastral", "functiune", "scop", "beneficiar",
          "suprafata_mp", "regim_inaltime", "niveluri_max", "h_max_m", "regimuri_utr", "pot_max", "cut_max",
          "spatii_verzi_min", "adc_max_mp", "apartamente_capacitate", "apartamente", "sursa_apartamente", "locuri_parcare", "sursa_parcare",
          "vot_total", "vot_prezenti", "vot_pentru", "vot_impotriva", "vot_abtineri", "avize_comisii",
          "zona_id", "zona", "cartier", "uat", "lat", "lon", "precizie", "interogare", "nota", "apix_articole",
          "titlu", "url_pdf", "url_usr"]


def write_outputs(rows):
    DATA.mkdir(parents=True, exist_ok=True)
    feats = []
    for r in rows:
        props = {k: r.get(k) for k in FIELDS if k not in ("lat", "lon", "interogare")}
        geom = {"type": "Point", "coordinates": [round(r["lon"], 6), round(r["lat"], 6)]} if r.get("lat") else None
        feats.append({"type": "Feature", "geometry": geom, "properties": props})
    gj = {"type": "FeatureCollection",
          "metadata": {"generat": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
                       "autor": AUTOR,
                       "sursa": "Hotărârile Consiliului Local Iași (hcl.usr.ro / primaria-iasi.ro); apix.ro; "
                                "parcelar OCPI Iași (eTerra); localizare © OpenStreetMap (Nominatim)",
                       "total": len(rows), "localizate": sum(1 for r in rows if r.get("lat"))},
          "features": feats}
    (DATA / "puz_iasi.geojson").write_text(json.dumps(gj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # conturul parcelelor fiecărui PUZ localizat pe parcelă (pentru harta la zoom de stradă)
    polys = []
    for r in rows:
        if not r.get("_parcele"):
            continue
        coords = []
        for g in r["_parcele"]:
            coords += g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        polys.append({"type": "Feature", "geometry": {"type": "MultiPolygon", "coordinates": coords},
                      "properties": {"hcl": r["hcl"], "statut": r["statut"], "functiune": r["functiune"]}})
    (DATA / "puz_iasi_parcele.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "metadata": {"autor": AUTOR, "sursa": "parcelar OCPI Iași (eTerra)"},
         "features": polys}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for name, sel in (("puz_iasi.csv", rows),
                      ("puz_iasi_de_verificat.csv",
                       [r for r in rows if r.get("precizie") not in ("parcelă", "număr", "stradă", "manual")])):
        with (DATA / name).open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, FIELDS, extrasaction="ignore")
            w.writeheader()
            w.writerows(sel)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--ani", help="ani separați prin virgulă (implicit 2020–anul curent)")
    ap.add_argument("--fara-geocodare", action="store_true")
    ap.add_argument("--fara-apix", action="store_true", help="fără completarea din articolele apix.ro")
    ap.add_argument("--reimprospateaza", action="store_true",
                    help="descarcă din nou listele anuale și articolele apix.ro (fișele HCL rămân în cache)")
    args = ap.parse_args()
    years = [int(y) for y in args.ani.split(",")] if args.ani else list(range(2016, dt.date.today().year + 1))

    rows = []
    for y in years:
        decs = list_decisions(y, args.reimprospateaza)
        print(f"{y}: {len(decs)} hotărâri PUZ", file=sys.stderr)
        for i, d in enumerate(decs, 1):
            text, pdf = decision_text(d)
            rows.append(parse_decision(d, text, pdf))
            if i % 25 == 0:
                print(f"  {i}/{len(decs)}", file=sys.stderr)
    rows.sort(key=lambda r: (r["data"] or "", r["nr"] or 0), reverse=True)
    n = apply_completari(rows)
    if n:
        print(f"completări aplicate: {n}", file=sys.stderr)
    if not args.fara_apix:
        posts = apix_posts(args.reimprospateaza)
        if posts:
            n_art, n_ap, n_pk = enrich_apix(rows, posts)
            print(f"apix.ro: {len(posts)} articole; PUZ-uri regăsite în presă: {n_art}; "
                  f"apartamente preluate: {n_ap}; locuri de parcare preluate: {n_pk}", file=sys.stderr)

    zones = load_polys(DATA / "iasi_17_zone_mva_mvi.geojson", lambda p: (p.get("zone_id"), p.get("zone_name")))
    uats = load_polys(DATA / "zmi_uat_web.geojson", lambda p: p.get("canonical_name") or p.get("name"))
    geo = None if args.fara_geocodare else Geocoder(CACHE / "nominatim.json")
    parcels = load_parcels()
    if parcels:
        print(f"parcele OCPI pentru localizare: {len(parcels)}", file=sys.stderr)
    for i, r in enumerate(rows, 1):
        on_parcel = locate_by_parcels(r, parcels) if parcels else None
        if r.get("_lat") is not None:
            r["lat"], r["lon"], r["precizie"] = r.pop("_lat"), r.pop("_lon"), "manual"
        elif on_parcel:
            r["lat"], r["lon"], r["_parcele"] = on_parcel
            r["precizie"] = "parcelă"
        elif geo:
            hit = geo.locate(r["adresa"])
            if hit:
                r["lat"], r["lon"], r["precizie"], r["cartier"], r["interogare"] = hit
        if r.get("lat") is not None and geo and not r.get("cartier") and r.get("precizie") != "zonă":
            r["cartier"] = geo.cartier_at(r["lat"], r["lon"])
        if r.get("lat") is not None:
            z = which(zones, r["lon"], r["lat"])
            r["zona_id"], r["zona"] = z if z else (None, None)
            r["uat"] = which(uats, r["lon"], r["lat"])
        if geo and i % 50 == 0:
            print(f"  localizate {i}/{len(rows)}", file=sys.stderr)
    if geo:
        geo.save()
    write_outputs(rows)
    loc = sum(1 for r in rows if r.get("lat"))
    by = {}
    for r in rows:
        by[r.get("precizie") or "nelocalizat"] = by.get(r.get("precizie") or "nelocalizat", 0) + 1
    print(f"{len(rows)} PUZ-uri; localizate {loc} ({by}); fișiere în {DATA.relative_to(ROOT)}", file=sys.stderr)


if __name__ == "__main__":
    main()
