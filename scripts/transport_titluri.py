#!/usr/bin/env python3
"""Titlurile de călătorie vândute de CTP Iași în Zona Metropolitană (centralizatoarele „pentru PMI”).

Intrare: unul sau mai multe fișiere Excel „Titluri de călătorie <an> – Zona Metropolitană pentru PMI”
(CTP Iași), în formatul din 2023 (foaia „zona metropolitana 2023”, cu „UAT ARONEANU” …, și foaia
„2023 - Iasi” pentru municipiu) sau 2024–2025 (foaia unică, cu „ARONEANU” …). Anul se citește din titlul
„CENTRALIZATOR … IANUARIE – DECEMBRIE <an>”. Foile contabile (balanță, fișe de cont) sunt ignorate.

Ieșire (fișierele Excel nu se publică – conțin și foi contabile; se publică doar agregatele):
  public/data/transport/titluri_zm.json  – pe UAT × lună × categorie, citit de harta /transport/
  public/data/transport/titluri_zm.csv   – același conținut în format lung (pentru Excel / QGIS)

Fiecare rând al centralizatorului este încadrat într-o categorie (bilete, abonamente, elevi și studenți) și
într-o componentă: „d” = vândute în UAT (tonete, casierie) și „r” = repartizate pe UAT din vânzările
centralizate (rândurile „REPARTIZARE DIN TOATE UAT-URILE” și „… de la Iași”). Călătoriile se estimează cu
numărul de călătorii pe titlu folosit de CTP (foaia „ZM - unite 2023”): bilet 1, bilet 2 călătorii = 2,
abonament 30 de zile UAT = 60, ZM + Iași = 135 (60 ZM + 75 IS), 6 luni = 360 / 810, 12 luni = 1620,
abonament studenți 50 % = 120. Rândurile în lei, suprataxele și dublurile contabile („(-)”, „Primărie”)
nu se numără.

Necesită: pip install openpyxl
Rulare:   python scripts/transport_titluri.py fisier2023.xlsx fisier2024.xlsx fisier2025.xlsx
"""
import argparse
import csv
import datetime as dt
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "data" / "transport"
UAT_GEO = ROOT / "public" / "data" / "zmi_uat_web.geojson"
LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie",
        "octombrie", "noiembrie", "decembrie"]
CATS = {
    "bilete": "Bilete",
    "abonamente": "Abonamente",
    "elevi": "Elevi și studenți",
}


def norm(s):
    """Text fără diacritice (inclusiv ş/ţ cu sedilă), litere mici, spații simple."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip().lower()


def classify(name, tarif):
    """(categorie, călătorii pe titlu, componentă) pentru un rând al centralizatorului ZM sau None dacă
    rândul nu se numără (lei, suprataxe, dubluri contabile)."""
    n = norm(name)
    if isinstance(tarif, str) and "lei" in norm(tarif):
        return None
    if re.search(r"-\s*lei\b|\blei\b|\(-\)|primarie|taxa|repartizat pe iasi", n):
        return None
    comp = "r" if ("repartizare" in n or "de la iasi" in n) else "d"
    zm_plus = "municipiul" in n or re.search(r"zm\s*\+", n) is not None
    if re.search(r"\bbi[lt]et 1\b", n):
        return "bilete", 1, comp
    if re.search(r"\bbilet 2\b", n):
        return "bilete", 2, comp
    if "student" in n:
        return "elevi", 120, comp
    if "elevi" in n:
        if "municipiu" in n and not zm_plus:      # abonament elevi doar pentru Iași, plătit de UAT
            return "elevi", 120, comp
        return "elevi", 135 if zm_plus else 60, comp
    if "12 luni" in n:
        return "abonamente", 1620, comp
    if "6 luni" in n:
        return "abonamente", 810 if zm_plus else 360, comp
    if "7 zile" in n:
        return "abonamente", 28 if zm_plus else 14, comp
    if "handicap" in n or "30 zile" in n or "abonament" in n:
        return "abonamente", 135 if zm_plus else 60, comp
    return None


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    return 0.0


def sheet_year(rows):
    for r in rows[:15]:
        for v in r:
            m = re.search(r"centralizator.*?(20\d\d)", norm(v))
            if m:
                return int(m.group(1))
    return None


def header_row(rows):
    """Indexul rândului de antet (cu „ianuarie” în coloana D) sau None."""
    for i, r in enumerate(rows[:20]):
        if len(r) > 3 and norm(r[3]) == "ianuarie":
            return i
    return None


def uat_key(s):
    return re.sub(r"^uat ", "", norm(s)).upper()


def parse_zm(rows, start, year, out, warnings):
    """Rândurile pe UAT (formatul ZM). out[uat][(an, luna, cat, comp)] = [titluri, călătorii]."""
    uat, prev = None, None
    for r in rows[start + 1:]:
        r = list(r) + [None] * 20
        if r[0] and isinstance(r[0], str) and norm(r[0]) not in ("uat", "total"):
            uat = uat_key(r[0])
        name, tarif = r[1], r[2]
        if not uat or not name or norm(name) in ("total",):
            continue
        n = norm(name)
        if n.startswith("repartizare din toate"):       # 2024: rândul de repartizare al titlului de deasupra
            c = (prev[0], prev[1], "r") if prev else None
        else:
            c = classify(name, tarif)
            prev = c if c and c[2] == "d" else prev
        if not c:
            continue
        cat, factor, comp = c
        months = [num(v) for v in r[3:15]]
        total = r[15]
        if isinstance(total, (int, float)) and abs(sum(months) - total) > 1:
            warnings.append(f"{year} {uat} „{name}”: suma lunilor {sum(months):.0f} ≠ TOTAL {total:.0f}")
        d = out.setdefault(uat, {})
        for i, q in enumerate(months):
            if q:
                cell = d.setdefault((year, i + 1, cat, comp), [0.0, 0.0])
                cell[0] += q
                cell[1] += q * factor


def classify_iasi(name, factor):
    """Foaia „2023 - Iasi”: categoria unui rând sau None (dubluri PMI, titluri din ZM, diferențe)."""
    n = norm(name)
    if re.search(r"\(pmi\)|facturati la pmi|din zm|diferenta|suprataxa|zona 2|2 zone|zm\+uat", n):
        return None
    if "elevi" in n or "student" in n or "stud " in n or "orfani" in n:
        return "elevi"
    if "bilet" in n:
        return "bilete"
    return "abonamente"


def parse_iasi(rows, start, year, out):
    """Municipiul Iași (doar în centralizatorul 2023): out[(an, luna, cat)] = [titluri, călătorii]."""
    for r in rows[start + 1:]:
        r = list(r) + [None] * 20
        name = r[1]
        if not name or not isinstance(name, str) or norm(name) == "total":
            continue
        cat = classify_iasi(name, r[16])
        if not cat:
            continue
        factor = r[16] if isinstance(r[16], (int, float)) and r[16] > 0 else (1 if cat == "bilete" else 75)
        for i, v in enumerate(r[3:15]):
            q = num(v)
            if q:
                cell = out.setdefault((year, i + 1, cat), [0.0, 0.0])
                cell[0] += q
                cell[1] += q * factor


def uat_lookup():
    """Denumire normalizată → (siruta, denumire canonică, [lng, lat] punct reprezentativ)."""
    out = {}
    if not UAT_GEO.exists():
        return out
    g = json.loads(UAT_GEO.read_text(encoding="utf-8"))
    for f in g["features"]:
        p = f["properties"]
        name = p.get("canonical_name") or p.get("name")
        out[norm(name).upper()] = (str(p.get("siruta_uat") or ""), name)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("xlsx", nargs="+", help="centralizatoarele CTP (unul pe an)")
    ap.add_argument("--out", default=str(OUT_DIR))
    a = ap.parse_args()
    import openpyxl

    zm, iasi, warnings, sources = {}, {}, [], []
    for path in a.xlsx:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for ws in wb.worksheets:
            rows = [tuple(r) for r in ws.iter_rows(values_only=True)]
            year, h = sheet_year(rows), header_row(rows)
            if not year or h is None:
                continue
            if norm(rows[h][0]).startswith("nr. crt"):     # foaia municipiului (doar 2023)
                parse_iasi(rows, h, year, iasi)
                sources.append(f"{Path(path).name} / {ws.title} ({year}, municipiul Iași)")
            else:                                           # pe UAT: antetul are „UAT” (2023–2024) sau nimic (2025)
                parse_zm(rows, h, year, zm, warnings)
                sources.append(f"{Path(path).name} / {ws.title} ({year}, ZM)")
    if not zm:
        sys.exit("Nu am găsit niciun centralizator pe UAT în fișierele date.")

    years = sorted({k[0] for d in zm.values() for k in d})
    months = [f"{y}-{m:02d}" for y in years for m in range(1, 13)]
    idx = {m: i for i, m in enumerate(months)}
    look = uat_lookup()
    uats = {}
    for key, d in sorted(zm.items()):
        siruta, name = look.get(key, ("", key.title()))
        if not siruta:
            warnings.append(f"UAT negăsit în zmi_uat_web.geojson: {key}")
        present = sorted({k[0] for k in d})
        series = {}
        for comp in ("d", "r"):
            for cat in CATS:
                t = [None if int(m[:4]) not in present else 0 for m in months]
                c = list(t)
                for (y, mo, ct, cp), (q, trips) in d.items():
                    if ct == cat and cp == comp:
                        i = idx[f"{y}-{mo:02d}"]
                        t[i] += round(q)
                        c[i] += round(trips)
                series[f"{comp}_{cat}"] = [t, c]
        uats[siruta or key] = {"name": name, "siruta": siruta, "years": present, "s": series}

    iasi_out = None
    if iasi:
        iy = sorted({k[0] for k in iasi})
        iasi_out = {"months": [f"{y}-{m:02d}" for y in iy for m in range(1, 13)], "s": {}}
        for cat in CATS:
            t = [round(iasi.get((y, m, cat), [0, 0])[0]) for y in iy for m in range(1, 13)]
            c = [round(iasi.get((y, m, cat), [0, 0])[1]) for y in iy for m in range(1, 13)]
            iasi_out["s"][cat] = [t, c]

    out = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source": "Compania de Transport Public Iași – centralizatoare titluri de călătorie vândute, ZM (pentru PMI)",
        "inputs": sources,
        "months": months,
        "cats": CATS,
        "uat": uats,
        "iasi": iasi_out,
    }
    od = Path(a.out)
    od.mkdir(parents=True, exist_ok=True)
    (od / "titluri_zm.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    with open(od / "titluri_zm.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["siruta", "uat", "an", "luna", "categorie", "componenta", "titluri", "calatorii_estimate"])
        for key, u in uats.items():
            for sk, (t, c) in u["s"].items():
                comp, cat = sk.split("_", 1)
                for i, m in enumerate(months):
                    if t[i]:
                        w.writerow([u["siruta"], u["name"], m[:4], m[5:], CATS[cat],
                                    "vândute în UAT" if comp == "d" else "repartizate", t[i], c[i]])
    for wmsg in warnings:
        print("atenție:", wmsg, file=sys.stderr)
    tot = sum(sum(x or 0 for x in u["s"][f"d_{c}"][0]) for u in uats.values() for c in CATS)
    print(f"{len(uats)} UAT-uri, {len(months)} luni ({years[0]}–{years[-1]}), {tot:,.0f} titluri vândute în UAT"
          f"{' + municipiul Iași ' + str(iasi_out['months'][0][:4]) if iasi_out else ''} → {od}")


if __name__ == "__main__":
    main()
