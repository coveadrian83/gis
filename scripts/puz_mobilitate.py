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
  4. autoturismele pe zi și în ora de vârf a dimineții (pondere modală auto, mai mare la periferie; ocupare);
  5. după metodologia din Covăsnianu (2023), Tabelul nr. 4: locurile de muncă (normă pe hectar, după tipul de zonă
     funcțională dedus din obiectul hotărârii), o a doua variantă a deplasărilor atrase (locuri de muncă × 2 ÷ ponderea
     muncii în totalul deplasărilor), densitatea umană totală (locuitori + locuri de muncă la hectar) și accesul la
     transportul public (distanța pe rețeaua pietonală a hărții „15 minute” până la cea mai apropiată stație și
     dacă aceasta e în coridorul de 800 m – izocrona de 10 minute de mers pe jos).
Se marchează și construcțiile înscrise în eTerra după aprobarea PUZ (până la data exportului parcelarului).

Rezultat: public/data/puz_mobilitate.json (pentru hartă) și public/data/puz_mobilitate.csv.
Rulare: python scripts/puz_mobilitate.py   (doar biblioteca standard)
"""
import csv
import heapq
import json
import math
import re
import struct
import unicodedata
from array import array
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
CONFIG = ROOT / "config" / "puz_mobilitate.json"
PARCELE = ROOT / "data" / "puz_parcele.geojson"
STATII = ROOT / "public" / "15min" / "data" / "iasi"   # pois.json + meta.json ale hărții „15 minute”
STATION, TRAIN, TRAM = 6, 1, 2
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


def fold(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()


# tipul de zonă din Tabelul nr. 4 (Covăsnianu 2023), după cuvintele din obiectul hotărârii; ordinea contează
JOB_ZONES = [
    ("hipermarket-uri alimentare", r"hipermarket|supermarket|lidl|kaufland|carrefour|auchan|penny|profi\b|mega image"),
    ("unități mari de retail (complexuri comerciale, mall-uri)", r"centr\w* comercial|complex\w* comercial|mall|retail park|parc comercial"),
    ("activități tehnologice", r"tehnolog|cercetare|inovare|\bit\b|software|fabrica viitorului"),
    ("birouri", r"birou|sediu|office"),
    ("logistică și depozitare", r"depozit|logistic"),
    ("producție industrială", r"productie|industrial|\bhal[aeă]|fabric|atelier|vinificat"),
    ("comerț (magazine mici)", r"comert|comercial|retail|magazin|showroom|service auto|spalatorie|prestari servicii"),
]


def job_zone(p):
    """Tipul de zonă funcțională din Tabelul nr. 4 sau None (funcțiune fără normă – rămâne varianta ITE)."""
    func = p.get("functiune")
    text = fold((p.get("scop") or "") + " " + (p.get("titlu") or ""))
    if func == "industrie / depozitare":
        allowed = ("logistică și depozitare", "producție industrială")
    elif func in ("comerț / servicii / birouri", "mixt (locuire + servicii)"):
        allowed = [z for z, _ in JOB_ZONES if z not in ("logistică și depozitare", "producție industrială")]
    else:
        return None
    for zone, rx in JOB_ZONES:
        if zone in allowed and re.search(rx, text):
            return zone
    if func == "industrie / depozitare":
        return "producție industrială"
    return "comerț (magazine mici)" if func == "mixt (locuire + servicii)" else None


def jobs(p, cfg):
    """(locuri de muncă, tipul de zonă): suprafața (ha) × norma pe ha × ponderea nerezidențială."""
    zone, area = job_zone(p), p.get("suprafata_mp")
    if not zone or not area:
        return None, zone
    share = 1 - cfg["constructie"]["pondere_locuire_mixt"] if p.get("functiune") == "mixt (locuire + servicii)" else 1.0
    return area / 10000 * cfg["locuri_de_munca"]["densitate_pe_ha"][zone] * share, zone


def load_stations(folder=STATII):
    """Stațiile hărții „15 minute”: ([(lon, lat, mod)], (lon, lat centru), raza ariei în m) sau None."""
    try:
        pts = json.loads((folder / "pois.json").read_text(encoding="utf-8"))["pts"]
        meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, KeyError):
        return None
    st = [(x[0], x[1], x[4]) for x in pts if x[2] == STATION]
    return st, (meta["center"][1], meta["center"][0]), meta["radius_m"]


class Network:
    """Rețeaua pietonală a hărții „15 minute” (graph.bin, formatul din scripts/export_15min.py), pe teren plat.

    Distanțele până la stații se calculează o singură dată, cu o căutare pornită din toate stațiile deodată;
    pentru numărul stațiilor din coridor se face, pentru fiecare PUZ, o căutare limitată la raza coridorului.
    Un punct (PUZ sau stație) se leagă de toate nodurile din jurul lui, nu doar de cel mai apropiat: în OSM trotuarele
    sunt linii separate, cu puține treceri, iar cel mai apropiat nod poate fi pe trotuarul opus sau pe o alee izolată."""
    MAX_SNAP_M = 500     # mai departe de atât de cea mai apropiată stradă, punctul nu e legat de rețea
    SNAP_PUZ_M = 150     # nodurile din jurul punctului PUZ-ului (parcelele mari ating mai multe străzi)
    SNAP_STATIE_M = 60   # nodurile din jurul stației (ambele trotuare, trecerea de pietoni)

    def __init__(self, path, stations):
        buf = path.read_bytes()
        _, n_nodes, n_edges, n_shape = struct.unpack_from("<4I", buf, 0)
        off = 16
        ll = array("i"); ll.frombytes(buf[off:off + 8 * n_nodes]); off += 8 * n_nodes
        eu = array("I"); eu.frombytes(buf[off:off + 4 * n_edges]); off += 4 * n_edges
        ev = array("I"); ev.frombytes(buf[off:off + 4 * n_edges]); off += 4 * n_edges
        elf = array("I"); elf.frombytes(buf[off:off + 4 * n_edges])
        self.lon = [ll[2 * i] / 1e5 for i in range(n_nodes)]
        self.lat = [ll[2 * i + 1] / 1e5 for i in range(n_nodes)]
        self.adj = [[] for _ in range(n_nodes)]
        for e in range(n_edges):
            length = (elf[e] >> 2) / 10
            self.adj[eu[e]].append((ev[e], length))
            self.adj[ev[e]].append((eu[e], length))
        self.cell = {}
        for i in range(n_nodes):
            self.cell.setdefault((int(self.lon[i] / 0.003), int(self.lat[i] / 0.002)), []).append(i)
        self.stations = []   # ([(nod, distanța de legătură)], mod)
        for slon, slat, mode in stations:
            links = self.links(slon, slat, self.SNAP_STATIE_M, 150)
            if links:
                self.stations.append((links, mode))
        self.d_any = self.search([l for links, _ in self.stations for l in links])
        self.d_rail = self.search([l for links, m in self.stations if m in (TRAIN, TRAM) for l in links])

    def links(self, lon, lat, radius_m, max_snap_m):
        """Nodurile la cel mult radius_m de punct (cel puțin cel mai apropiat, dacă e la cel mult max_snap_m)."""
        node, d = self.nearest(lon, lat)
        if node is None or d > max_snap_m:
            return []
        cx, cy, out = int(lon / 0.003), int(lat / 0.002), [(node, d)]
        for x in range(cx - 1, cx + 2):
            for y in range(cy - 1, cy + 2):
                for i in self.cell.get((x, y), ()):
                    di = km(lon, lat, self.lon[i], self.lat[i]) * 1000
                    if i != node and di <= radius_m:
                        out.append((i, di))
        return out

    def nearest(self, lon, lat):
        cx, cy = int(lon / 0.003), int(lat / 0.002)
        best, best_d = None, math.inf
        for r in range(0, 4):
            for x in range(cx - r, cx + r + 1):
                for y in range(cy - r, cy + r + 1):
                    if max(abs(x - cx), abs(y - cy)) != r:
                        continue
                    for i in self.cell.get((x, y), ()):
                        d = km(lon, lat, self.lon[i], self.lat[i]) * 1000
                        if d < best_d:
                            best, best_d = i, d
            if best is not None and best_d <= r * 150:   # inelele următoare nu pot avea un nod mai apropiat
                break
        return best, best_d

    def search(self, sources, limit=math.inf):
        """Dijkstra pe lungime (m), din mai multe surse {nod: distanță inițială}; se oprește la `limit`."""
        dist = {}
        heap = [(d, n) for n, d in sources]
        heapq.heapify(heap)
        while heap:
            d, n = heapq.heappop(heap)
            if n in dist or d > limit:
                continue
            dist[n] = d
            for m, length in self.adj[n]:
                if m not in dist:
                    heapq.heappush(heap, (d + length, m))
        return dist

    def access(self, lon, lat, radius_m):
        links = self.links(lon, lat, self.SNAP_PUZ_M, self.MAX_SNAP_M)
        if not links:
            return None
        reach = self.search(links, radius_m)
        n = sum(1 for st_links, _ in self.stations
                if any(sn in reach and reach[sn] + sd <= radius_m for sn, sd in st_links))
        d_any = min(self.d_any.get(nd, math.inf) + d for nd, d in links)
        d_rail = min(self.d_rail.get(nd, math.inf) + d for nd, d in links)
        return d_any, d_rail, n


def transit_access(p, stations, radius_m, network=None):
    """Distanța (m) până la cea mai apropiată stație (oricare / tramvai sau tren) și numărul stațiilor din coridor:
    pe rețeaua pietonală când aceasta există, altfel în linie dreaptă."""
    lon, lat = p.get("_lon"), p.get("_lat")
    if not stations or lon is None or p.get("precizie") == "zonă":
        return None
    st, center, area_m = stations
    if km(lon, lat, *center) * 1000 > area_m:     # în afara ariei pentru care avem stațiile
        return None
    ld_any = ld_rail = math.inf
    n = 0
    for slon, slat, mode in st:
        d = km(lon, lat, slon, slat) * 1000
        ld_any = min(ld_any, d)
        if mode in (TRAIN, TRAM):
            ld_rail = min(ld_rail, d)
        n += d <= radius_m
    net = network.access(lon, lat, radius_m) if network else None
    d_any, d_rail, n = net if net else (ld_any, ld_rail, n)
    rnd = lambda d: None if d == math.inf else round(d)
    return {"dist_statie_m": rnd(d_any), "dist_tramvai_tren_m": rnd(d_rail), "statii_800m": n,
            "acces_tp_800m": d_any <= radius_m, "acces_tramvai_tren_800m": d_rail <= radius_m,
            "acces_metoda": "rețea pietonală" if net else "linie dreaptă",
            "dist_statie_linie_dreapta_m": rnd(ld_any), "dist_tramvai_tren_linie_dreapta_m": rnd(ld_rail)}


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


def model(p, cfg, parcels, stations=None, network=None):
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
    lm_cfg = cfg["locuri_de_munca"]
    n_jobs, zone = jobs(p, cfg)
    out["locuri_munca"] = round(n_jobs) if n_jobs is not None else 0
    out["zona_functionala_lm"] = zone if n_jobs is not None else None
    ha = (p.get("suprafata_mp") or 0) / 10000
    out.update(transit_access(p, stations, cfg["acces_transport_public"]["raza_m"], network) or
               dict.fromkeys(("dist_statie_m", "dist_tramvai_tren_m", "statii_800m", "acces_tp_800m",
                              "acces_tramvai_tren_800m", "acces_metoda", "dist_statie_linie_dreapta_m",
                              "dist_tramvai_tren_linie_dreapta_m")))
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
        # varianta pe locuri de muncă (Tabelul nr. 4); funcțiunile fără normă păstrează valoarea ITE
        if n_jobs is not None:
            out[f"{sc}_atractie_lm_deplasari_zi"] = round(
                n_jobs * lm_cfg["deplasari_pe_loc_de_munca_munca"] / lm_cfg["pondere_munca_in_total"])
            out[f"{sc}_atractie_lm_auto_varf"] = round(
                n_jobs * vf["pondere_obligatorii_ora_varf"] * auto / mod["ocupare_auto"])
        else:
            out[f"{sc}_atractie_lm_deplasari_zi"] = out[f"{sc}_atractie_deplasari_zi"]
            out[f"{sc}_atractie_lm_auto_varf"] = out[f"{sc}_atractie_auto_varf"]
        # densitatea umană totală: locuitori + locuri de muncă la hectarul reglementat
        out[f"{sc}_densitate_umana"] = round((res + (n_jobs or 0)) / ha, 1) if ha else None
    return out


def density_access_totals(rows, cfg):
    """Densitatea umană pe ansamblul PUZ-urilor și ponderea locuitorilor / locurilor de muncă din coridorul de 800 m."""
    out = {}
    with_area = [r for r in rows if r.get("suprafata_mp")]
    ha = sum(r["suprafata_mp"] for r in with_area) / 10000
    known = [r for r in rows if r.get("acces_tp_800m") is not None]
    for sc in cfg["constructie"]["scenarii"]:
        people = sum((r.get(f"{sc}_locuitori") or 0) + (r.get("locuri_munca") or 0) for r in with_area)
        out[f"{sc}_densitate_umana"] = round(people / ha, 1) if ha else None
        res = sum(r.get(f"{sc}_locuitori") or 0 for r in known)
        for key, ld in (("acces_tp_800m", "dist_statie_linie_dreapta_m"),
                        ("acces_tramvai_tren_800m", "dist_tramvai_tren_linie_dreapta_m")):
            near = sum(r.get(f"{sc}_locuitori") or 0 for r in known if r[key])
            out[f"{sc}_locuitori_{key}_pct"] = round(100 * near / res, 1) if res else None
            # aceeași pondere în linie dreaptă: limita superioară (rețeaua OSM are goluri, trotuare fără treceri)
            near = sum(r.get(f"{sc}_locuitori") or 0 for r in known
                       if r.get(ld) is not None and r[ld] <= cfg["acces_transport_public"]["raza_m"])
            out[f"{sc}_locuitori_{key}_linie_dreapta_pct"] = round(100 * near / res, 1) if res else None
    lm = sum(r.get("locuri_munca") or 0 for r in known)
    for key in ("acces_tp_800m", "acces_tramvai_tren_800m"):
        near = sum(r.get("locuri_munca") or 0 for r in known if r[key])
        out[f"locuri_munca_{key}_pct"] = round(100 * near / lm, 1) if lm else None
    out["puz_cu_acces_calculat"] = len(known)
    return out


def main():
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    puz = json.loads((DATA / "puz_iasi.geojson").read_text(encoding="utf-8"))
    parcels = {}
    if PARCELE.exists():
        parcels = {f["properties"]["cad"]: f["properties"]
                   for f in json.loads(PARCELE.read_text(encoding="utf-8"))["features"]}
    stations = load_stations()
    network = None
    if not stations:
        print("Atenție: stațiile hărții 15 minute lipsesc – accesul la transportul public nu se calculează")
    elif (STATII / "graph.bin").exists():
        network = Network(STATII / "graph.bin", stations[0])
        print(f"Rețeaua pietonală: {len(network.lon)} noduri, {len(network.stations)} stații legate de rețea")
    else:
        print("Atenție: graph.bin lipsește – accesul se calculează în linie dreaptă")
    rows, result = [], {}
    for f in puz["features"]:
        p = dict(f["properties"])
        if f["geometry"]:
            p["_lon"], p["_lat"] = f["geometry"]["coordinates"]
        r = model(p, cfg, parcels, stations, network)
        if r is None:
            continue
        result[p["hcl"]] = r
        rows.append({"hcl": p["hcl"], "data": p.get("data"), "adresa": p.get("adresa"), "functiune": p.get("functiune"),
                     "zona": p.get("zona"), "cartier": p.get("cartier"), "suprafata_mp": p.get("suprafata_mp"),
                     "cut_max": p.get("cut_max"), "apartamente_proiect": p.get("apartamente"), **r})
    keys = [k for k in rows[0] if k not in ("periferie",)] + ["periferie"] if rows else []
    totals = {}
    for k in keys:
        if any(k.endswith(s) for s in ("_zi", "_varf", "_locuitori", "_apartamente")) or k == "locuri_munca":
            totals[k] = round(sum(r.get(k) or 0 for r in rows))
    totals.update(density_access_totals(rows, cfg))
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
              "realist_atractie_lm_deplasari_zi", "locuri_munca", "realist_densitate_umana",
              "realist_locuitori_acces_tramvai_tren_800m_pct", "realist_locuitori_acces_tp_800m_pct",
              "realist_locuitori_acces_tramvai_tren_800m_linie_dreapta_pct",
              "realist_locuitori_acces_tp_800m_linie_dreapta_pct",
              "locuri_munca_acces_tramvai_tren_800m_pct", "puz_cu_acces_calculat",
              "maxim_locuitori", "maxim_PMUD_auto_varf", "maxim_RPL_auto_varf"):
        print(f"  {k}: {totals.get(k)}")


if __name__ == "__main__":
    main()
