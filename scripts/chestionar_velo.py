#!/usr/bin/env python3
"""Chestionarul Masterplanului pentru biciclete (Iași, 04.2022–2023) → agregatele hărții „15 minute pe două roți”.

Intrare: exportul răspunsurilor din Google Forms (xlsx, foaia „Răspunsuri la formular 1”). Fișierul cu răspunsurile
individuale NU se publică (data/chestionar_velo/ este în .gitignore); în repository intră doar agregatele:

    public/micromobilitate/data/chestionar.json
      strazi   – pentru fiecare stradă din rețeaua OSM: de câte ori a fost numită ca parcursă cel mai des cu bicicleta
                 (întrebarea 11) și ca stradă dorită exclusiv pentru biciclete și pietoni (întrebarea 12);
      zone     – pe cele 17 zone MVA–MVI (după zona de domiciliu, întrebarea 3): respondenți, cât folosesc bicicleta;
      zm       – respondenții din comunele Zonei Metropolitane;
      sumar    – distribuțiile răspunsurilor închise (vârstă, mod, distanță, siguranță, mulțumire, acord …);
      nepotrivite – fragmentele de text din întrebările 11–12 numite de cel puțin 3 ori și negăsite în OSM
                 (pentru completarea aliasurilor de mai jos).

Potrivirea străzilor: textul se împarte la virgule / punct și virgulă / „și”; tipul (bulevard, stradă, șosea …) și
diacriticele se ignoră; cuvintele rămase trebuie să se regăsească toate în denumirea OSM („Bd. Carol” → „Bulevardul
Carol I”, „Mangeron” → „Bulevardul Profesor Dimitrie Mangeron”); greșelile mici se corectează („Poaitiers”).
Când mai multe străzi au același nume, se alege cea de tipul scris, altfel bulevardul / șoseaua / calea (cea mai
lungă). Denumirile populare sunt în ALIASES.

Rulare (doar biblioteca standard + openpyxl):
    python scripts/chestionar_velo.py data/chestionar_velo/chestionar_MasterPlanBiciclete_Iasi.xlsx
    python scripts/chestionar_velo.py … --pana-la toate      # și răspunsurile venite după încheierea anchetei
"""
import argparse
import collections
import difflib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import elevatie_15min as E  # noqa: E402  (citirea graph.bin)

DATA = ROOT / "public" / "micromobilitate" / "data"
OUT = DATA / "chestionar.json"

# coloanele exportului Google Forms
COL = {"varsta": 2, "ocupatie": 3, "zona": 4, "scop": 5, "distanta": 6, "mod": 7, "renunta": 8, "bicicleta": 9,
       "frecventa": 10, "destinatii": 11, "parcurse": 12, "dorite": 13, "aspecte": 14, "multumit": 15, "probleme": 16,
       "siguranta": 17, "vreme": 18, "zgomot": 19, "poluare": 20, "redimensionare": 21, "parcare": 22}
FRECVENT = {"Zilnic", "De mai multe ori pe săptămână", "O dată pe săptămână"}
# variantele de răspuns cu bife multiple (conțin virgule, deci se caută ca subșiruri)
OPTIONS = {
    "scop": ["Serviciu / Locul de muncă", "Creșă / Grădiniță / Școală / Liceu", "Universitate", "Cumpărături",
             "Activități socio-culturale", "Recreere și sport", "Sănătate"],
    "aspecte": ["Siguranța în deplasare", "Continuitate în deplasare", "Traseele trebuie să fie cât mai directe",
                "Multi-modalitate", "Confortul în deplasare"],
    "probleme": ["Nu există o rețea de piste pentru biciclete", "Pista nu are o lățime corespunzătoare",
                 "Pista nu este marcată și delimitată corespunzător", "Obstacole pe pistă", "Pista trece printr-o stație de autobuz",
                 "Bordurile sunt prea înalte", "Lipsa / număr insuficient rasteluir", "Lipsa / număr insuficient de centre de închiriat",
                 "Piste lipsite de conectivitate", "Stații de închiriere puține", "Lipsă semnalistică specifică"],
}

TYPES = {  # cuvânt din text → tipul normalizat
    "bulevardul": "bd", "bulevard": "bd", "bd": "bd", "bld": "bd", "blvd": "bd", "b-dul": "bd", "bdul": "bd", "bv": "bd",
    "strada": "str", "str": "str", "soseaua": "sos", "sos": "sos", "sosea": "sos", "calea": "calea", "cale": "calea",
    "aleea": "aleea", "alee": "aleea", "al": "aleea", "splaiul": "splai", "splai": "splai", "piata": "piata", "pta": "piata",
    "p-ta": "piata", "pasajul": "pasaj", "pasaj": "pasaj", "drumul": "drum", "intrarea": "intr", "stradela": "stradela",
    "bvd": "bd", "blv": "bd", "bul": "bd", "bulv": "bd", "b": "bd", "dul": "bd", "s": "sos",
}
TYPE_RANK = {"bd": 0, "sos": 1, "calea": 2, "splai": 3, "str": 4, "piata": 5, "pasaj": 6, "aleea": 7}
STOP = {"si", "de", "la", "din", "spre", "pe", "in", "zona", "iasi", "prof", "profesor", "dr", "doctor", "sf", "sfantul",
        "sfanta", "regele", "general", "gral", "mihai", "vasile", "mihail", "dimitrie", "nicolae"}
# denumiri populare → denumirea (fără tip) din OSM
ALIASES = {"copou": "carol i", "carol": "carol i", "bd copou": "carol i", "tudor": "tudor vladimirescu",
           "stefan": "stefan cel mare si sfant", "stefan cel mare": "stefan cel mare si sfant", "ferdinand": "regele ferdinand",
           "podu ros": "podu ros", "pod ros": "podu ros", "independentei": "independentei", "cuza": "cuza voda",
           "chimiei": "chimiei", "palas": "palas", "sadoveanu": "mihail sadoveanu", "podul ros": "podu ros",
           "spali bahlui": "bahlui", "malul bahluiului": "bahlui", "bahlui": "bahlui", "palatului": "palat",
           "esplanada palat": "palat", "stefan ce mare": "stefan cel mare si sfant"}

# zona de domiciliu → zona MVA–MVI; textul normalizat se caută ca subșir, în ordinea listei
ZONE_RULES = [
    ("moara de vant", "IAS-Z03"), ("moara de foc", "IAS-Z07"), ("bularga", "IAS-Z01"), ("baza 3", "IAS-Z01"),
    ("aviatiei", "IAS-Z02"), ("aeroport", "IAS-Z02"), ("ticau", "IAS-Z04"), ("sararie", "IAS-Z04"),
    ("copou", "IAS-Z05"), ("sadoveanu", "IAS-Z05"), ("dacia", "IAS-Z06"), ("zimbru", "IAS-Z06"),
    ("pacurari", "IAS-Z07"), ("canta", "IAS-Z07"), ("galata", "IAS-Z08"), ("mircea", "IAS-Z08"),
    ("cug", "IAS-Z09"), ("c.u.g", "IAS-Z09"), ("bucium", "IAS-Z10"), ("visan", "IAS-Z10"),
    ("nicolina", "IAS-Z11"), ("frumoasa", "IAS-Z12"), ("alexandru", "IAS-Z13"), ("cantemir", "IAS-Z14"),
    ("socola", "IAS-Z14"), ("podu ros", "IAS-Z14"), ("podul ros", "IAS-Z14"), ("pod ros", "IAS-Z14"),
    ("tudor", "IAS-Z16"), ("studentesc", "IAS-Z16"), ("tatarasi", "IAS-Z17"), ("metalurgie", "IAS-Z17"),
    ("centru", "IAS-Z15"), ("unirii", "IAS-Z15"), ("independentei", "IAS-Z15"), ("palas", "IAS-Z15"),
    ("targu cucu", "IAS-Z15"), ("tg cucu", "IAS-Z15"), ("gara", "IAS-Z15"),
]


def plain(s):
    s = unicodedata.normalize("NFD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", s).strip()


def parse_name(text):
    """(tip sau None, cuvintele denumirii) dintr-un fragment de text sau o denumire OSM."""
    s = plain(text).replace("b-dul", "bdul ").replace("p-ta", "pta ")
    words = [w for w in re.split(r"[^a-z0-9]+", s) if w]
    kind = None
    while words and words[0] in TYPES:
        kind = kind or TYPES[words[0]]
        words = words[1:]
    return kind, words


def core(words):
    return " ".join(words)


class StreetIndex:
    """Denumirile din rețeaua OSM (edges.json) cu tipul, cuvintele și lungimea totală."""

    def __init__(self, names, lengths):
        self.items = []
        self.vocab = set()
        for name, length in zip(names, lengths):
            kind, words = parse_name(name)
            if not words:
                continue
            key = [w for w in words if w not in STOP and len(w) > 1]
            self.items.append({"name": name, "kind": kind, "words": set(words), "key": set(key), "core": core(words), "len": length})
            self.vocab.update(words)
        self.vocab = sorted(self.vocab)

    def fix(self, w):
        if w in self.vocab or len(w) < 4:
            return w
        m = difflib.get_close_matches(w, self.vocab, n=1, cutoff=0.84)
        return m[0] if m else w

    def match(self, text):
        kind, words = parse_name(text)
        if not words:
            return None
        c = core(words)
        if c in ALIASES:
            words = ALIASES[c].split()
        words = [self.fix(w) for w in words]
        need = {w for w in words if w not in STOP and len(w) > 2} or {w for w in words if len(w) > 1} or set(words)
        if not need:
            return None
        cands = [it for it in self.items if need <= it["words"]]
        if not cands:
            return None
        exact = core(words)

        def rank(it):
            return (0 if kind and it["kind"] == kind else 1, 0 if it["core"] == exact else 1,
                    TYPE_RANK.get(it["kind"], 9), len(it["key"] - need), -it["len"])
        return min(cands, key=rank)["name"]


def fragments(text):
    if text is None:
        return []
    s = str(text)
    if plain(s) in ("-", "nu", "niciuna", "nici una", "none", "nu stiu", ""):
        return []
    parts = re.split(r"[,;\n/+]|\s+(?:si|și)\s+(?![sS][fF])", s)
    out = []
    for p in parts:
        # „Str. Cuza Vodă. Splai Bahlui” – punctul separă două străzi doar dacă după el urmează un tip de stradă
        pieces = re.split(r"\.", p)
        cur = pieces[0]
        for piece in pieces[1:]:
            nxt = plain(piece).split()
            if nxt and nxt[0] in TYPES and len(nxt[0]) > 1 and plain(cur).split() and plain(cur).split()[-1] not in TYPES:
                out.append(cur); cur = piece
            else:
                cur = cur + " " + piece
        out.append(cur)
    clean = []
    for f in out:
        f = re.split(r"\s+(?:pana|până|intre|între|de la|ambele|integral|\()", f)[0]
        f = f.strip(" .-:()")
        if len(f) >= 3 and any(w not in STOP and w not in TYPES for w in parse_name(f)[1]):
            clean.append(f)
    return clean


def count_options(values, options):
    c = collections.Counter()
    for v in values:
        v = str(v or "")
        for o in options:
            if o.lower() in v.lower():
                c[o] += 1
    return dict(c.most_common())


def main():
    ap = argparse.ArgumentParser(description="Agregatele chestionarului velo pentru harta micromobilității.")
    ap.add_argument("xlsx", help="exportul Google Forms (xlsx)")
    ap.add_argument("--data", default=str(DATA / "iasi"), help="directorul cu graph.bin și edges.json")
    ap.add_argument("--pana-la", default="2023-01-31",
                    help="ultima zi inclusă (implicit 2023-01-31: eșantionul Masterplanului, 1413 chestionare; 'toate' = fără limită)")
    args = ap.parse_args()
    import openpyxl

    rows = [r for r in list(openpyxl.load_workbook(args.xlsx, read_only=True).worksheets[0].iter_rows(values_only=True))[1:]
            if r and r[0] is not None]
    total = len(rows)
    if args.pana_la != "toate":
        rows = [r for r in rows if str(r[0])[:10] <= args.pana_la]
    print("Răspunsuri: %d (din %d în fișier, până la %s)" % (len(rows), total, args.pana_la))

    # rețeaua: denumirile, lungimile și centrul fiecărei străzi
    d = Path(args.data)
    g = E.read_graph(d / "graph.bin")
    info = json.loads((d / "edges.json").read_text(encoding="utf-8"))
    length = collections.defaultdict(float)
    for e, k in info["name"]:
        length[info["names"][k]] += float(g["len"][e])
    idx = StreetIndex(list(length), [length[n] for n in length])

    # străzile parcurse (11) și dorite (12): fiecare respondent contează o singură dată pe stradă
    streets = collections.defaultdict(lambda: {"parcurse": 0, "dorite": 0})
    missing = collections.Counter()
    for r in rows:
        for col, key in ((COL["parcurse"], "parcurse"), (COL["dorite"], "dorite")):
            seen = set()
            for frag in fragments(r[col]):
                name = idx.match(frag)
                if name:
                    seen.add(name)
                else:
                    missing[plain(frag)] += 1
            for name in seen:
                streets[name][key] += 1
    street_list = sorted(({"nume": n, **v} for n, v in streets.items()), key=lambda x: -(x["parcurse"] + x["dorite"]))
    mentioned = sum(1 for r in rows if fragments(r[COL["parcurse"]]))
    print("Străzi găsite în OSM: %d; respondenți cu cel puțin o stradă parcursă: %d" % (len(street_list), mentioned))
    for s in street_list[:12]:
        print("  %-45s parcurse %4d  dorite %4d" % (s["nume"], s["parcurse"], s["dorite"]))

    # zona de domiciliu
    zones = json.loads((ROOT / "public" / "data" / "iasi_17_zone_mva_mvi.geojson").read_text(encoding="utf-8"))
    zone_name = {f["properties"]["zone_id"]: f["properties"]["zone_name"] for f in zones["features"]}
    loc = json.loads((ROOT / "public" / "data" / "zmi_localitati_siruta_2025.json").read_text(encoding="utf-8"))
    loc_uat = {plain(x["locality_name"]): x["uat_name"] for x in loc if x["uat_name"] != "Iași"}
    loc_uat.update({plain(x["uat_name"]): x["uat_name"] for x in loc if x["uat_name"] != "Iași"})
    loc_keys = sorted(loc_uat, key=len, reverse=True)

    def zone_of(text):
        s = plain(text or "")
        if not s or s in ("iasi", "none"):
            return None, None
        for k in loc_keys:   # localitățile ZM întâi („Valea Lupului”, „Lunca Cetățuii” …)
            if len(k) >= 4 and re.search(r"\b%s\b" % re.escape(k), s):
                return None, loc_uat[k]
        for k, z in ZONE_RULES:
            if k in s:
                return z, None
        return None, None

    zstat = collections.defaultdict(lambda: collections.Counter())
    zm = collections.Counter()
    unalloc = 0
    for r in rows:
        z, uat = zone_of(r[COL["zona"]])
        if uat:
            zm[uat] += 1
            continue
        if not z:
            unalloc += 1
            continue
        c = zstat[z]
        c["n"] += 1
        c["bicicleta"] += r[COL["bicicleta"]] == "DA"
        c["frecvent"] += r[COL["frecventa"]] in FRECVENT
        c["mod_bicicleta"] += r[COL["mod"]] == "Bicicletă/trotinetă"
        c["sigur"] += r[COL["siguranta"]] == "DA"
    zone_out = {}
    for z, c in sorted(zstat.items()):
        n = c["n"]
        zone_out[z] = {"zona": zone_name.get(z, z), "respondenti": n,
                       "bicicleta_pct": round(c["bicicleta"] / n * 100, 1), "frecvent_pct": round(c["frecvent"] / n * 100, 1),
                       "mod_bicicleta_pct": round(c["mod_bicicleta"] / n * 100, 1), "sigur_pct": round(c["sigur"] / n * 100, 1)}
    print("Zona de domiciliu: %d în cele 17 zone, %d în ZM, %d nealocați" % (sum(c["n"] for c in zstat.values()), sum(zm.values()), unalloc))

    def dist(key):
        return dict(collections.Counter(str(r[COL[key]]).strip() for r in rows if r[COL[key]] is not None).most_common())

    dates = sorted(str(r[0])[:10] for r in rows)
    out = {
        "sursa": "Chestionar Masterplan piste pentru biciclete, municipiul Iași",
        "perioada": [dates[0], dates[-1]], "raspunsuri": len(rows), "raspunsuri_in_fisier": total, "pana_la": args.pana_la,
        "respondenti_cu_strazi": mentioned,
        "sumar": {k: dist(k) for k in ("varsta", "ocupatie", "distanta", "mod", "bicicleta", "frecventa", "multumit",
                                       "siguranta", "vreme", "zgomot", "poluare", "redimensionare", "parcare")},
        "sumar_multiplu": {k: count_options([r[COL[k]] for r in rows], v) for k, v in OPTIONS.items()},
        "strazi": street_list,
        "zone": zone_out, "zm": dict(zm.most_common()), "nealocati": unalloc,
        "nepotrivite": [[k, v] for k, v in missing.most_common() if v >= 3],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("Scris:", OUT)


if __name__ == "__main__":
    main()
