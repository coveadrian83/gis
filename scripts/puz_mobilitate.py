#!/usr/bin/env python3
"""Deplasările generate de PUZ-urile aprobate în Iași – model de generare în două scenarii de mobilitate.

Intrări: public/data/puz_iasi.geojson (PUZ-urile, scripts/puz_iasi.py), data/puz_parcele.geojson (parcele OCPI și
construcțiile înscrise, scripts/puz_parcele.py), config/puz_mobilitate.json (parametrii, cu sursele lor).

Pentru fiecare PUZ aprobat (inclusiv modificările) se estimează:
  1. ce se poate construi: apartamente (cunoscute din HCL / apix.ro sau din suprafață × CUT) și suprafața
     nerezidențială, în scenariul „realist” (grad de realizare) și „maxim” (capacitatea CUT);
  2. locuitorii: apartamente × persoane pe locuință ocupată × rata de ocupare (RPL 2021);
  3. deplasările zilnice ale locuitorilor, în două scenarii:
       PMUD – locuitori × rata de mobilitate din ancheta PMUD 2021;
       RPL  – structural: deplasări obligatorii (ocupați + elevi/studenți, RPL 2021) extinse la total
              cu ponderea scopurilor muncă + educație din PMUD;
     separat, deplasările ATRASE de suprafețele nerezidențiale (comerț, birouri, echipamente) – nu se adună cu
     cele produse de locuitori, pentru că în bună parte sunt aceleași persoane;
  4. autoturismele pe zi și în ora de vârf a dimineții (pondere modală auto, mai mare la periferie; ocupare).
Se marchează și construcțiile înscrise în eTerra după aprobarea PUZ (până la data exportului parcelarului).

Rezultat: public/data/puz_mobilitate.json (pentru hartă) și public/data/puz_mobilitate.csv.
Rulare: python scripts/puz_mobilitate.py   (doar biblioteca standard)
"""
import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
CONFIG = ROOT / "config" / "puz_mobilitate.json"
PARCELE = ROOT / "data" / "puz_parcele.geojson"
AUTOR = "Prelucrarea și integrarea datelor: dr. geogr. Adrian Covăsnianu"

RESIDENTIAL = {"locuințe colective", "mixt (locuire + servicii)", "locuințe individuale", "introducere în intravilan"}
INDIVIDUAL = {"locuințe individuale", "introducere în intravilan"}
APPROVED = {"aprobat", "modificare"}


def km(lon1, lat1, lon2, lat2):
    kx = 111.32 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot((lon1 - lon2) * kx, (lat1 - lat2) * 110.54)


def dwellings(p, cfg, factor):
    """(apartamente, sursa) pentru un PUZ, la un grad de realizare dat."""
    c = cfg["constructie"]
    func, area, cut = p.get("functiune"), p.get("suprafata_mp"), p.get("cut_max")
    if func not in RESIDENTIAL:
        return 0.0, None
    if p.get("apartamente"):   # numărul din proiect (HCL / apix.ro) – același în ambele scenarii
        return float(p["apartamente"]), "proiect"
    if func in INDIVIDUAL:
        if not area:
            return 1.0, "o locuință"
        houses = max(1.0, area * c["pondere_teren_loturi"] / c["mp_teren_pe_casa"])
        return (houses if houses <= 1 else houses * factor), "loturi"
    if not (area and cut):
        return 0.0, "fără indicatori"
    share = c["pondere_locuire_mixt"] if func == "mixt (locuire + servicii)" else 1.0
    return area * cut * share * c["pondere_locuibila_adc"] / c["mp_adc_pe_apartament"] * factor, "CUT"


def nonres_gfa(p, cfg, factor):
    """Suprafața construită desfășurată nerezidențială (mp) și rata de deplasări pe 100 mp."""
    func, area, cut = p.get("functiune"), p.get("suprafata_mp"), p.get("cut_max")
    rate = cfg["nerezidential"]["deplasari_pe_100mp_zi"].get(func)
    if not rate or not (area and cut):
        return 0.0, 0.0
    share = 1 - cfg["constructie"]["pondere_locuire_mixt"] if func == "mixt (locuire + servicii)" else 1.0
    return area * cut * share * factor, rate


def built_after(p, parcels):
    """Amprenta (mp) construcțiilor înscrise în eTerra în anul aprobării PUZ sau după, pe parcelele lui."""
    year = (p.get("data") or "")[:4] or str(p.get("an") or "")
    total = 0.0
    found = False
    for cad in (p.get("cadastral") or "").split(", "):
        pr = parcels.get(cad)
        if not pr:
            continue
        found = True
        for y, a in (pr.get("constructii_mp_pe_an") or {}).items():
            if y.isdigit() and year.isdigit() and int(y) >= int(year):
                total += a
    return round(total, 1) if found else None


def model(p, cfg, parcels):
    if p.get("statut") not in APPROVED:
        return None
    m, mod, vf = cfg["mobilitate"], cfg["modal"], cfg["varf_dimineata"]
    lon, lat = p.get("_lon"), p.get("_lat")
    far = lon is not None and km(lon, lat, *mod["centru"]) > mod["periferie_km_de_la_centru"]
    auto = mod["pondere_auto_periferie"] if far else mod["pondere_auto"]
    pers = cfg["locuire"]["persoane_pe_locuinta_ocupata"] * cfg["locuire"]["rata_ocupare_locuinte"]
    rpl = m["RPL"]
    oblig_share = rpl["pondere_ocupati"] + rpl["pondere_elevi_studenti"]
    out = {"periferie": far, "pondere_auto": auto, "construit_dupa_hcl_mp": built_after(p, parcels)}
    for sc, sp in cfg["constructie"]["scenarii"].items():
        ap, src = dwellings(p, cfg, sp["grad_realizare"])
        res = ap * pers
        gfa, rate = nonres_gfa(p, cfg, sp["grad_realizare"])
        nonres = gfa / 100 * rate
        out[f"{sc}_apartamente"] = round(ap, 1)
        out[f"{sc}_locuitori"] = round(res)
        out[f"{sc}_adc_nerezidential_mp"] = round(gfa)
        out["sursa_apartamente_model"] = src
        trips = {
            "PMUD": (res * m["PMUD"]["deplasari_pe_persoana_zi"],
                     res * m["PMUD"]["deplasari_pe_persoana_zi"] * vf["pondere_zilnic_PMUD"]),
            "RPL": (res * rpl["deplasari_pe_activitate_obligatorie"] * oblig_share / rpl["pondere_obligatorii_in_total"],
                    res * oblig_share * vf["pondere_obligatorii_ora_varf"]),
        }
        for ms, (day, peak) in trips.items():     # deplasări produse de locuitori
            out[f"{sc}_{ms}_deplasari_zi"] = round(day)
            out[f"{sc}_{ms}_auto_zi"] = round(day * auto / mod["ocupare_auto"])
            out[f"{sc}_{ms}_auto_varf"] = round(peak * auto / mod["ocupare_auto"])
        # deplasări atrase de activitățile nerezidențiale (raportate separat)
        out[f"{sc}_atractie_deplasari_zi"] = round(nonres)
        out[f"{sc}_atractie_auto_varf"] = round(nonres * vf["pondere_nerezidential"] * auto / mod["ocupare_auto"])
    return out


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    puz = json.loads((DATA / "puz_iasi.geojson").read_text(encoding="utf-8"))
    parcels = {}
    if PARCELE.exists():
        parcels = {f["properties"]["cad"]: f["properties"]
                   for f in json.loads(PARCELE.read_text(encoding="utf-8"))["features"]}
    rows, result = [], {}
    for f in puz["features"]:
        p = dict(f["properties"])
        if f["geometry"]:
            p["_lon"], p["_lat"] = f["geometry"]["coordinates"]
        r = model(p, cfg, parcels)
        if r is None:
            continue
        result[p["hcl"]] = r
        rows.append({"hcl": p["hcl"], "data": p.get("data"), "adresa": p.get("adresa"), "functiune": p.get("functiune"),
                     "zona": p.get("zona"), "cartier": p.get("cartier"), "suprafata_mp": p.get("suprafata_mp"),
                     "cut_max": p.get("cut_max"), "apartamente_proiect": p.get("apartamente"), **r})
    keys = [k for k in rows[0] if k not in ("periferie",)] + ["periferie"] if rows else []
    totals = {}
    for k in keys:
        if any(k.endswith(s) for s in ("_zi", "_varf", "_locuitori", "_apartamente")):
            totals[k] = round(sum(r.get(k) or 0 for r in rows))
    meta = {"autor": AUTOR, "puz_modelate": len(rows), "totaluri": totals,
            "parametri": cfg, "nota": "estimări de ordin de mărime; vezi /puz/metodologie.html"}
    (DATA / "puz_mobilitate.json").write_text(json.dumps({"metadata": meta, "puz": result}, ensure_ascii=False,
                                                         separators=(",", ":")), encoding="utf-8")
    with (DATA / "puz_mobilitate.csv").open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, keys, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    print(f"{len(rows)} PUZ-uri modelate → public/data/puz_mobilitate.json / .csv")
    for k in ("realist_apartamente", "realist_locuitori", "realist_PMUD_deplasari_zi", "realist_RPL_deplasari_zi",
              "realist_PMUD_auto_varf", "realist_RPL_auto_varf", "realist_atractie_deplasari_zi",
              "maxim_locuitori", "maxim_PMUD_auto_varf", "maxim_RPL_auto_varf"):
        print(f"  {k}: {totals.get(k)}")


if __name__ == "__main__":
    main()
