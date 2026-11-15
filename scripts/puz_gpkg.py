#!/usr/bin/env python3
"""GeoPackage pentru QGIS cu PUZ-urile din municipiul Iași și impactul lor estimat asupra mobilității.

Intrări: public/data/puz_iasi.geojson (scripts/puz_iasi.py), public/data/puz_mobilitate.json (scripts/puz_mobilitate.py),
public/data/puz_iasi_parcele.geojson, data/puz_parcele.geojson (scripts/puz_parcele.py), zonele MVA–MVI, UAT-urile ZMI,
stațiile și rețeaua pietonală a hărții „15 minute” (public/15min/data/iasi/).

Rezultat, în EPSG:3844 (Stereo 70, ca exporturile OCPI):
  data/puz_iasi_impact_mobilitate.gpkg, cu straturile
    puz_iasi                  – toate PUZ-urile, cu indicatorii urbanistici și de mobilitate (câmpurile m_…);
    puz_parcele_ocpi2023      – parcelele PUZ din extrasul parcelarului OCPI;
    puz_de_verificat          – PUZ-urile aprobate care nu sunt pe parcelă, ordonate după impact;
    zone_mva_mvi_impact       – totaluri pe cele 17 zone MVA–MVI;
    uat_zmi_impact            – totaluri pe UAT-urile ZMI;
    statii_transport_public   – stațiile de tren, tramvai și autobuz;
    izocrone_10min_pe_jos     – zona atinsă în 10 minute (800 m) pe rețeaua pietonală din fiecare PUZ aprobat;
    despre                    – autor, surse, sistem de coordonate;
  data/puz_iasi_verificare_manuala.csv – aceeași listă de verificare, pentru completat (separator „;”, pentru Excel);
    valorile completate în coloanele lat / lon / sursa / nota se păstrează la rulările următoare; pe hartă intră după
    ce sunt copiate în data/puz_iasi_completari.csv.

Rulare: pip install geopandas pyogrio shapely && python scripts/puz_gpkg.py [--out fișier.gpkg]
Lista de verificare (verification_rows) folosește doar biblioteca standard; geopandas e necesar doar pentru GeoPackage.
"""
import argparse
import csv
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import puz_mobilitate as M  # noqa: E402

OUT = ROOT / "data" / "puz_iasi_impact_mobilitate.gpkg"
OUT_CSV = ROOT / "data" / "puz_iasi_verificare_manuala.csv"
CRS = "EPSG:3844"
APPROVED = {"aprobat", "modificare"}
PREC = {"număr": "la număr poștal", "stradă": "pe stradă (centrul străzii)", "zonă": "doar pe zonă (centrul zonei)",
        None: "nelocalizat"}
VER_COLS = ["rang", "prioritate", "hcl", "data_hcl", "adresa", "cadastral", "are_nr_cadastral", "functiune",
            "suprafata_mp", "zona", "cartier", "localizare_actuala", "motiv_fara_parcela", "auto_varf_realist",
            "locuitori_realist", "locuri_munca", "apartamente_proiect", "lat_actual", "lon_actual", "url_hcl_pdf",
            "url_text", "lat", "lon", "sursa", "nota"]


def _num(v):
    return f"{round(v):,}".replace(",", ".")


def verification_rows(features, mob, parcels):
    """PUZ-urile aprobate care nu sunt puse pe parcelă, ordonate după autoturismele din ora de vârf (produse + atrase,
    scenariul realist RPL), cu motivul pentru care parcela nu a fost găsită. parcels: {număr cadastral: suprafață}."""
    rows = []
    for f in features:
        p = f["properties"]
        if p.get("statut") not in APPROVED or p.get("precizie") in ("parcelă", "manual"):
            continue
        m = mob.get(p["hcl"], {})
        auto = (m.get("realist_RPL_auto_varf") or 0) + (m.get("realist_atractie_lm_auto_varf") or 0)
        lon, lat = f["geometry"]["coordinates"] if f.get("geometry") else (None, None)
        cads = [c.strip() for c in (p.get("cadastral") or "").split(",") if c.strip()]
        found = [c for c in cads if c in parcels]
        if not cads:
            why = "fără număr cadastral în hotărâre"
        elif not found:
            why = "numărul cadastral nu e în extrasul parcelarului OCPI (nou sau schimbat)"
        else:
            why = (f"parcelă găsită ({_num(sum(parcels[c] or 0 for c in found))} mp), dar suprafața nu se potrivește "
                   f"cu PUZ-ul ({_num(p.get('suprafata_mp') or 0)} mp)")
            if len(found) < len(cads):
                why += f"; {len(cads) - len(found)} din {len(cads)} numere lipsesc din extras"
        area = p.get("suprafata_mp") or 0
        rows.append({
            "prioritate": "A" if auto >= 20 else ("B" if auto >= 3 or area >= 10000 else "C"),
            "hcl": p["hcl"], "data_hcl": p.get("data"), "adresa": p.get("adresa"), "cadastral": ", ".join(cads),
            "are_nr_cadastral": "da" if cads else "nu", "functiune": p.get("functiune"), "suprafata_mp": p.get("suprafata_mp"),
            "zona": p.get("zona") or "", "cartier": p.get("cartier") or "",
            "localizare_actuala": PREC.get(p.get("precizie"), p.get("precizie")), "motiv_fara_parcela": why,
            "auto_varf_realist": auto, "locuitori_realist": m.get("realist_locuitori") or 0,
            "locuri_munca": m.get("locuri_munca") or 0, "apartamente_proiect": p.get("apartamente") or "",
            "lat_actual": round(lat, 6) if lat is not None else "", "lon_actual": round(lon, 6) if lon is not None else "",
            "url_hcl_pdf": p.get("url_pdf") or "", "url_text": p.get("url_usr") or "",
            "lat": "", "lon": "", "sursa": "", "nota": ""})
    rows.sort(key=lambda r: (-r["auto_varf_realist"], -r["locuitori_realist"], -(r["suprafata_mp"] or 0), r["hcl"]))
    for i, r in enumerate(rows, 1):
        r["rang"] = i
    return rows


def keep_filled(rows, path):
    """Păstrează lat / lon / sursa / nota completate deja în lista de verificare existentă (după HCL)."""
    if not path.exists():
        return rows
    with path.open(encoding="utf-8-sig", newline="") as fh:
        old = {r["hcl"]: r for r in csv.DictReader(fh, delimiter=";")}
    for r in rows:
        for k in ("lat", "lon", "sursa", "nota"):
            if old.get(r["hcl"], {}).get(k):
                r[k] = old[r["hcl"]][k]
    return rows


def write_verification_csv(rows, path):
    with path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, VER_COLS, delimiter=";")
        w.writeheader()
        w.writerows(rows)


def export_gpkg(out, features, mob, ver_rows):
    # date fixe în tabelele GeoPackage: același conținut → același fișier (fără commit-uri automate inutile)
    os.environ.setdefault("OGR_CURRENT_DATE", "2000-01-01T00:00:00Z")
    import geopandas as gpd
    import pandas as pd
    from shapely import concave_hull
    from shapely.geometry import MultiPoint, Point, shape

    if out.exists():
        out.unlink()
    mp = mob["puz"]

    def save(gdf, layer):
        gdf.to_crs(CRS).to_file(out, layer=layer, driver="GPKG")

    rows, geoms = [], []
    for f in features:
        p = dict(f["properties"])
        p.update({f"m_{k}": v for k, v in mp.get(p["hcl"], {}).items()})
        rows.append(p)
        geoms.append(shape(f["geometry"]) if f.get("geometry") else None)
    g_puz = gpd.GeoDataFrame(rows, geometry=geoms, crs="EPSG:4326")
    save(g_puz, "puz_iasi")
    save(gpd.read_file(DATA / "puz_iasi_parcele.geojson"), "puz_parcele_ocpi2023")
    save(gpd.GeoDataFrame(ver_rows, geometry=[Point(r["lon_actual"], r["lat_actual"]) if r["lon_actual"] != "" else None
                                              for r in ver_rows], crs="EPSG:4326"), "puz_de_verificat")

    # totaluri pe zone MVA–MVI și pe UAT-uri ZMI (doar PUZ-urile aprobate)
    appr = g_puz[g_puz["statut"].isin(APPROVED)].copy()
    num = {"puz": ("hcl", "count"), "suprafata_ha": ("suprafata_mp", lambda s: s.sum() / 1e4),
           "locuitori_realist": ("m_realist_locuitori", "sum"), "locuitori_maxim": ("m_maxim_locuitori", "sum"),
           "deplasari_zi_RPL_realist": ("m_realist_RPL_deplasari_zi", "sum"),
           "deplasari_zi_PMUD_realist": ("m_realist_PMUD_deplasari_zi", "sum"),
           "auto_varf_RPL_realist": ("m_realist_RPL_auto_varf", "sum"),
           "auto_varf_PMUD_realist": ("m_realist_PMUD_auto_varf", "sum"),
           "auto_varf_RPL_maxim": ("m_maxim_RPL_auto_varf", "sum"), "locuri_munca": ("m_locuri_munca", "sum"),
           "atrase_zi_locuri_munca": ("m_realist_atractie_lm_deplasari_zi", "sum"),
           "atrase_zi_ITE": ("m_realist_atractie_deplasari_zi", "sum")}

    def totals(key):
        a = appr.groupby(key).agg(**num)
        acc = appr[appr["m_acces_tp_800m"].notna()]
        loc = acc.groupby(key)["m_realist_locuitori"].sum()
        for col, name in (("m_acces_tramvai_tren_800m", "pct_locuitori_tramvai_tren_800m"),
                          ("m_acces_tp_800m", "pct_locuitori_orice_statie_800m")):
            near = acc[acc[col].astype(bool)].groupby(key)["m_realist_locuitori"].sum()
            a[name] = 100 * near.reindex(loc.index).fillna(0) / loc.where(loc > 0)
        a["densitate_umana_realist"] = (a["locuitori_realist"] + a["locuri_munca"]) / a["suprafata_ha"].where(a["suprafata_ha"] > 0)
        return a.round(1).reset_index()

    zones = gpd.read_file(DATA / "iasi_17_zone_mva_mvi.geojson")
    save(zones.merge(totals("zona_id"), left_on="zone_id", right_on="zona_id", how="left"), "zone_mva_mvi_impact")
    uats = gpd.read_file(DATA / "zmi_uat_web.geojson")
    ukey = next(c for c in ("canonical_name", "name", "uat_name") if c in uats.columns)
    u = uats.merge(totals("uat"), left_on=ukey, right_on="uat", how="left")
    u["nota"] = ("PUZ-urile sunt ale municipiului Iași (HCL Iași): totalurile arată unde se generează deplasările. "
                 "Impactul supralocal (deplasări din / spre comunele ZMI) cere distribuția pe destinații – matricea O–D "
                 "a studiului MVA × MVI.")
    save(u, "uat_zmi_impact")

    # stațiile și izocronele de 10 minute pe jos (aceeași rețea și aceleași reguli ca indicatorul de acces)
    stations = M.load_stations()
    if stations and (M.STATII / "graph.bin").exists():
        st = stations[0]
        mode = {1: "tren", 2: "tramvai", 3: "autobuz"}
        save(gpd.GeoDataFrame({"mod": [mode.get(s[2], "") for s in st]},
                              geometry=[Point(s[0], s[1]) for s in st], crs="EPSG:4326"), "statii_transport_public")
        net = M.Network(M.STATII / "graph.bin", st)
        radius = json.loads(M.CONFIG.read_text(encoding="utf-8"))["acces_transport_public"]["raza_m"]
        iso_rows, iso_geoms = [], []
        for _, r in appr.iterrows():
            if r.get("precizie") == "zonă" or r.geometry is None:
                continue
            links = net.links(r.geometry.x, r.geometry.y, net.SNAP_PUZ_M, net.MAX_SNAP_M)
            reach = net.search(links, radius) if links else {}
            if len(reach) < 4:
                continue
            iso_rows.append({"hcl": r["hcl"], "adresa": r["adresa"], "locuitori_realist": r["m_realist_locuitori"],
                             "auto_varf_RPL_realist": r["m_realist_RPL_auto_varf"], "statii_800m": r["m_statii_800m"],
                             "acces_tramvai_tren_800m": r["m_acces_tramvai_tren_800m"]})
            iso_geoms.append(concave_hull(MultiPoint([(net.lon[n], net.lat[n]) for n in sorted(reach)]), ratio=0.3))
        save(gpd.GeoDataFrame(iso_rows, geometry=iso_geoms, crs="EPSG:4326"), "izocrone_10min_pe_jos")

    about = pd.DataFrame([{
        "autor": M.AUTOR, "crs": "EPSG:3844 (Stereo 70)",
        "surse": "HCL Iași (hcl.usr.ro, primaria-iasi.ro); apix.ro; parcelar OCPI Iași 05.2023 (extras PUZ); "
                 "OpenStreetMap; RPL 2021; PMUD Iași 2021; Covăsnianu (2023), Tabelul nr. 4",
        "metodologie": "https://github.com/coveadrian83/gis – public/puz/metodologie.html; scripts/puz_gpkg.py",
        "nota": "estimări de ordin de mărime: scenariile de construire realist / maxim, scenariile de mobilitate PMUD / "
                "RPL; izocronele = înfășurătoarea concavă a nodurilor rețelei pietonale atinse în 800 m"}])
    gpd.GeoDataFrame(about, geometry=[None], crs=CRS).to_file(out, layer="despre", driver="GPKG")
    return [(l.name, len(gpd.read_file(out, layer=l.name))) for l in gpd.list_layers(out).itertuples()]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--csv", type=Path, default=OUT_CSV)
    a = ap.parse_args()
    features = json.loads((DATA / "puz_iasi.geojson").read_text(encoding="utf-8"))["features"]
    mob = json.loads((DATA / "puz_mobilitate.json").read_text(encoding="utf-8"))
    parcels = {}
    if M.PARCELE.exists():
        parcels = {f["properties"]["cad"]: f["properties"].get("arie_mp")
                   for f in json.loads(M.PARCELE.read_text(encoding="utf-8"))["features"]}
    rows = keep_filled(verification_rows(features, mob["puz"], parcels), a.csv)
    write_verification_csv(rows, a.csv)
    print(f"{len(rows)} PUZ-uri de verificat → {a.csv.relative_to(ROOT) if a.csv.is_relative_to(ROOT) else a.csv}")
    for name, n in export_gpkg(a.out, features, mob, rows):
        print(f"  {name}: {n}")
    print(f"→ {a.out}")


if __name__ == "__main__":
    main()
