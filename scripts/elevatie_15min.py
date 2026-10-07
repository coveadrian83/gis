#!/usr/bin/env python3
"""Adaugă panta la rețeaua pietonală a hărții „15 minute. Pentru cine?” – Iași.

Citește public/15min/data/<slug>/graph.bin (și edges.json, dacă există), modelul de elevație
Copernicus GLO-30 (30 m, descărcat automat din AWS Open Data) și scrie elev.bin, pe care pagina îl
folosește pentru opțiunea „Ține cont de pantă”.

    pip install rasterio scipy numpy
    python scripts/elevatie_15min.py                 # după scripts/export_15min.py

Modelul (detalii în public/15min/metodologie.html):
  * GLO-30 este un model al suprafeței (include clădiri și copaci). O deschidere morfologică (minim, apoi
    maxim, pe o fereastră de 5 × 5 pixeli ≈ 150 m) îndepărtează majoritatea clădirilor și păstrează pantele
    naturale (o rampă liniară rămâne neschimbată); o netezire gaussiană ușoară elimină treptele rămase.
  * Elevația se citește biliniar la fiecare 15 m de-a lungul fiecărei muchii.
  * Viteza pe pantă: funcția lui Tobler, normalizată ca terenul plat să dea viteza aleasă de utilizator:
    f(s) = exp(-3,5 |s + 0,05|) / exp(-3,5 · 0,05). Panta străzilor se limitează la ±35 % (zgomotul modelului).
  * Scări: viteza orizontală este 45 % din viteza de mers la urcare și 55 % la coborâre (ordinul de mărime
    din Fruin, 1971); înălțimea vine din step_count × 0,16 m, din incline, sau din modelul de elevație.
  * Etichetele OSM au prioritate: incline numeric (ex. „12%”) înlocuiește panta din model pe toată muchia,
    incline=up/down stabilește sensul urcării.

elev.bin, little endian: antet 3 × uint32 (versiune 1, noduri, muchii), apoi
  lfw  float32[muchii]  „lungimea echivalentă pe teren plat” (m) de la nodul mic la cel mare
  lbw  float32[muchii]  aceeași, de la nodul mare la cel mic        → timp = lungime echivalentă / viteză
  ele  int16[noduri]    elevația nodurilor, decimetri
  up   uint16[muchii]   urcarea totală de la nodul mic la cel mare, decimetri
  dn   uint16[muchii]   coborârea totală în același sens, decimetri
  grd  uint8[muchii]    panta maximă (în valoare absolută) pe muchie, procente; 255 = scări
"""
import argparse
import json
import math
import struct
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DEM_URL = ("https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
           "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif")
STEP_M = 15.0           # pasul de eșantionare de-a lungul muchiilor
MAX_STREET_GRADE = 0.35
STAIR_UP, STAIR_DOWN, STAIR_RISER = 0.45, 0.55, 0.16
R_LAT, R_LON = 110540.0, 111320.0


def tobler(s):
    """Factorul de viteză față de terenul plat, pentru panta s (urcare > 0), după Tobler (1993)."""
    return np.exp(-3.5 * np.abs(s + 0.05)) / math.exp(-3.5 * 0.05)


def read_graph(path):
    buf = Path(path).read_bytes()
    version, nN, nE, nS = struct.unpack_from("<4I", buf, 0)
    if version != 1:
        raise SystemExit("graph.bin: versiune necunoscută %d" % version)
    off = 16
    ll = np.frombuffer(buf, "<i4", 2 * nN, off).reshape(-1, 2) / 1e5; off += 8 * nN
    eu = np.frombuffer(buf, "<u4", nE, off); off += 4 * nE
    ev = np.frombuffer(buf, "<u4", nE, off); off += 4 * nE
    lf = np.frombuffer(buf, "<u4", nE, off); off += 4 * nE
    sst = np.frombuffer(buf, "<u4", nE + 1, off); off += 4 * (nE + 1)
    sp = np.frombuffer(buf, "<i4", 2 * nS, off).reshape(-1, 2) / 1e5
    return {"lonlat": ll, "eu": eu, "ev": ev, "len": (lf >> 2) / 10.0, "flag": lf & 3, "sst": sst, "sp": sp}


def load_dem(bbox, cache_dir, opening=5, sigma=1.0):
    """Mozaicul GLO-30 pentru bbox (lon0, lat0, lon1, lat1), curățat de clădiri. Întoarce (grid, lon0, lat1, dlon, dlat)."""
    import rasterio
    from rasterio.windows import from_bounds
    from scipy import ndimage

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    pad = 0.01
    lon0, lat0, lon1, lat1 = bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad
    tiles = [(la, lo) for la in range(math.floor(lat0), math.floor(lat1) + 1) for lo in range(math.floor(lon0), math.floor(lon1) + 1)]
    if len(tiles) != 1:
        raise SystemExit("Zona acoperă %d plăci GLO-30; scriptul tratează deocamdată o singură placă." % len(tiles))
    la, lo = tiles[0]
    path = cache_dir / ("glo30_%s%02d_%s%03d.tif" % ("N" if la >= 0 else "S", abs(la), "E" if lo >= 0 else "W", abs(lo)))
    if not path.exists():
        url = DEM_URL.format(ns="N" if la >= 0 else "S", lat=abs(la), ew="E" if lo >= 0 else "W", lon=abs(lo))
        print("Descarc modelul de elevație:", url, flush=True)
        urllib.request.urlretrieve(url, path)
    with rasterio.open(path) as ds:
        win = from_bounds(lon0, lat0, lon1, lat1, ds.transform).round_offsets().round_lengths()
        z = ds.read(1, window=win).astype(np.float64)
        t = ds.window_transform(win)
    raw = z.copy()
    if opening > 1:
        z = ndimage.grey_opening(z, size=(opening, opening))
    if sigma > 0:
        z = ndimage.gaussian_filter(z, sigma)
    print("Model de elevație: %d × %d pixeli, %.0f–%.0f m; clădiri/copaci eliminați: medie %.1f m, max %.0f m"
          % (z.shape[1], z.shape[0], z.min(), z.max(), float((raw - z).clip(0).mean()), float((raw - z).max())))
    # centrele pixelilor
    return {"z": z, "lon0": t.c + t.a / 2, "lat0": t.f + t.e / 2, "dlon": t.a, "dlat": t.e}


def sample(dem, lon, lat):
    """Elevația biliniară în punctele (lon, lat) – tablouri numpy."""
    z = dem["z"]
    x = (np.asarray(lon) - dem["lon0"]) / dem["dlon"]
    y = (np.asarray(lat) - dem["lat0"]) / dem["dlat"]
    x = np.clip(x, 0, z.shape[1] - 1.000001)
    y = np.clip(y, 0, z.shape[0] - 1.000001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    return (z[y0, x0] * (1 - fx) * (1 - fy) + z[y0, x0 + 1] * fx * (1 - fy)
            + z[y0 + 1, x0] * (1 - fx) * fy + z[y0 + 1, x0 + 1] * fx * fy)


def edge_points(g, e):
    u, v = g["eu"][e], g["ev"][e]
    pts = [g["lonlat"][u]]
    s0, s1 = g["sst"][e], g["sst"][e + 1]
    if s1 > s0:
        pts.extend(g["sp"][s0:s1])
    pts.append(g["lonlat"][v])
    return np.array(pts)


def densify(pts, step):
    """Puncte la cel mult `step` metri de-a lungul polilinei; întoarce (lon, lat, lungimi segmente)."""
    cos = math.cos(math.radians(float(pts[:, 1].mean())))
    out_lon, out_lat = [pts[0, 0]], [pts[0, 1]]
    for i in range(1, len(pts)):
        dx = (pts[i, 0] - pts[i - 1, 0]) * R_LON * cos
        dy = (pts[i, 1] - pts[i - 1, 1]) * R_LAT
        n = max(1, int(math.ceil(math.hypot(dx, dy) / step)))
        for k in range(1, n + 1):
            out_lon.append(pts[i - 1, 0] + (pts[i, 0] - pts[i - 1, 0]) * k / n)
            out_lat.append(pts[i - 1, 1] + (pts[i, 1] - pts[i - 1, 1]) * k / n)
    lon, lat = np.array(out_lon), np.array(out_lat)
    seg = np.hypot(np.diff(lon) * R_LON * cos, np.diff(lat) * R_LAT)
    return lon, lat, seg


def edge_profile(g, dem, e, info):
    """(lungime echivalentă înainte, înapoi, urcare, coborâre, panta maximă %) pentru muchia e, de la nodul mic la cel mare."""
    L = float(g["len"][e])
    lon, lat, seg = densify(edge_points(g, e), STEP_M)
    # lungimile geometrice se scalează la lungimea OSM a muchiei (geometria e ușor simplificată)
    if seg.sum() > 0:
        seg = seg * (L / seg.sum())
    h = sample(dem, lon, lat)
    dh = np.diff(h)
    inc = info.get("incline")
    is_steps = g["flag"][e] != 0
    if is_steps:
        dem_rise = float(h[-1] - h[0])
        rise = info["step_count"] * STAIR_RISER if info.get("step_count") else abs(dem_rise)
        if inc is not None and abs(inc) == 1000:
            sign = 1 if inc > 0 else -1
        elif inc is not None and abs(inc) < 1000:
            sign = 1 if inc > 0 else -1
            if not info.get("step_count"):
                rise = abs(inc) / 100 * L
        else:
            sign = 1 if dem_rise >= 0 else -1
        if abs(rise) < 0.3:   # scări fără diferență de nivel cunoscută: același timp în ambele sensuri
            fw = bw = L / ((STAIR_UP + STAIR_DOWN) / 2)
        else:
            fw = L / (STAIR_UP if sign > 0 else STAIR_DOWN)
            bw = L / (STAIR_DOWN if sign > 0 else STAIR_UP)
        up, dn = (rise, 0.0) if sign > 0 else (0.0, rise)
        return fw, bw, up, dn, 255
    if inc is not None and abs(inc) < 1000:   # pantă etichetată în OSM: uniformă pe toată muchia
        s = np.full(len(seg), inc / 100.0)
    else:
        s = np.divide(dh, seg, out=np.zeros_like(dh), where=seg > 0.5)
        if inc is not None:   # doar sensul este cunoscut
            want = 1 if inc > 0 else -1
            if np.sign(s.sum()) == -want:
                s = -s
    s = np.clip(s, -MAX_STREET_GRADE, MAX_STREET_GRADE)
    fw = float((seg / tobler(s)).sum())
    bw = float((seg / tobler(-s)).sum())
    climb = s * seg
    up, dn = float(climb[climb > 0].sum()), float(-climb[climb < 0].sum())
    # panta maximă pe o fereastră de minimum 30 m (un singur pas de 15 m este prea zgomotos)
    if len(seg) >= 2:
        w = (climb[:-1] + climb[1:]) / np.maximum(seg[:-1] + seg[1:], 1e-6)
        gmax = float(np.abs(w).max())
    else:
        gmax = float(np.abs(s).max()) if len(s) else 0.0
    return fw, bw, up, dn, min(254, int(round(gmax * 100)))


def load_edge_info(path, n_edges):
    info = [dict() for _ in range(n_edges)]
    if not Path(path).exists():
        print("edges.json lipsește: se folosește doar modelul de elevație.")
        return info, None
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    if d.get("edges") != n_edges:
        raise SystemExit("edges.json nu corespunde cu graph.bin (%s vs %d muchii)" % (d.get("edges"), n_edges))
    for e, v in d.get("incline", []):
        info[e]["incline"] = v
    for e, v in d.get("step_count", []):
        info[e]["step_count"] = v
    return info, d


def main():
    ap = argparse.ArgumentParser(description="Adaugă panta (elev.bin) la datele hărții 15 minute.")
    ap.add_argument("--slug", default="iasi")
    ap.add_argument("--opening", type=int, default=5, help="fereastra deschiderii morfologice, pixeli (1 = fără)")
    args = ap.parse_args()
    out = ROOT / "public" / "15min" / "data" / args.slug
    g = read_graph(out / "graph.bin")
    nN, nE = len(g["lonlat"]), len(g["eu"])
    info, _ = load_edge_info(out / "edges.json", nE)
    ll = g["lonlat"]
    bbox = [ll[:, 0].min(), ll[:, 1].min(), ll[:, 0].max(), ll[:, 1].max()]
    dem = load_dem(bbox, ROOT / "cache" / "dem", opening=args.opening)

    ele = sample(dem, ll[:, 0], ll[:, 1])
    lfw = np.zeros(nE, "<f4"); lbw = np.zeros(nE, "<f4")
    up = np.zeros(nE, "<u2"); dn = np.zeros(nE, "<u2"); grd = np.zeros(nE, "u1")
    for e in range(nE):
        a, b, c, d, gm = edge_profile(g, dem, e, info[e])
        lfw[e], lbw[e] = a, b
        up[e], dn[e] = min(65535, int(round(c * 10))), min(65535, int(round(d * 10)))
        grd[e] = gm
    with open(out / "elev.bin", "wb") as f:
        f.write(struct.pack("<3I", 1, nN, nE))
        for arr in (lfw, lbw, np.round(ele * 10).astype("<i2"), up, dn, grd):
            f.write(arr.tobytes())

    streets = grd < 255
    total = float(g["len"][streets].sum())
    shares = {k: round(float(g["len"][streets & (grd >= lo) & (grd < hi)].sum()) / total * 100, 1)
              for k, lo, hi in (("0-3", 0, 3), ("3-5", 3, 5), ("5-8", 5, 8), ("8-12", 8, 12), ("12+", 12, 255))}
    tagged = sum(1 for i in info if "incline" in i)
    summary = {"source": "Copernicus GLO-30 (DSM), deschidere morfologică %d px + gauss σ=1" % args.opening,
               "min_m": round(float(ele.min()), 1), "max_m": round(float(ele.max()), 1),
               "street_length_share_by_grade_pct": shares, "osm_incline_edges": tagged,
               "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
    print("Elevație noduri: %.0f–%.0f m" % (ele.min(), ele.max()))
    print("Lungimea străzilor pe clase de pantă (%):", shares)
    print("Muchii cu incline în OSM:", tagged, "· scări cu step_count:", sum(1 for i in info if "step_count" in i))
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["elevation"] = summary
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print("elev.bin: %.2f MB" % ((out / "elev.bin").stat().st_size / 1e6))


if __name__ == "__main__":
    main()
