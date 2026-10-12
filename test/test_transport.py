"""Teste pentru harta transportului public: centralizatoarele CTP (scripts/transport_titluri.py) și conversia
traseelor KML / Shapefile / GeoPackage (scripts/transport_linii.py), pe fișiere sintetice.
Rulare: python3 -m unittest discover -s test -p 'test_transport*.py'
(necesită openpyxl; testele Shapefile / GeoPackage necesită pyshp, pyproj, shapely și se omit fără ele)"""
import json
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import transport_linii as L  # noqa: E402
import transport_titluri as T  # noqa: E402

try:
    import shapefile  # noqa: F401
    import pyproj  # noqa: F401
    import shapely  # noqa: F401
    HAVE_GEO = True
except ImportError:
    HAVE_GEO = False

MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie",
          "octombrie", "noiembrie", "decembrie"]


class Classify(unittest.TestCase):
    def test_tickets(self):
        c = T.classify
        self.assertEqual(c("bitet 1 calatorie UAT", 6), ("bilete", 1, "d"))
        self.assertEqual(c("Bilet 1 calatorie, Zona Metropolitana", 5), ("bilete", 1, "d"))
        self.assertEqual(c("bilet 2 calatorii ZM+UAT", 14), ("bilete", 2, "d"))
        self.assertEqual(c("abonament 30 zile UAT", 200), ("abonamente", 60, "d"))
        self.assertEqual(c("abonament 30 zile ZM+UAT", 300), ("abonamente", 135, "d"))
        self.assertEqual(c("Abonament valabil 30 zile, Zona Metropolitana + Municipiul Iasi", 300), ("abonamente", 135, "d"))
        self.assertEqual(c("ab. 12 luni ZM + UAT", 2400), ("abonamente", 1620, "d"))
        self.assertEqual(c("ab.6 luni UAT", 1000), ("abonamente", 360, "d"))
        self.assertEqual(c("ab.gratuit elevi ZM +UAT", 200), ("elevi", 135, "d"))
        self.assertEqual(c("ab. gratuit elevi UAT", 150), ("elevi", 60, "d"))
        self.assertEqual(c("ab.gratuit elevi ZM +UAT-repartizare", 90), ("elevi", 135, "r"))
        self.assertEqual(c("bilet 1 calatorie ZM+UAT - Repartizare Toate UAT", "bucati"), ("bilete", 1, "r"))
        self.assertEqual(c("bilet 2 calatorii ZM+UAT- de la Iasi", 7), ("bilete", 2, "r"))

    def test_skipped(self):
        for name, tarif in [("repartizat pe Iasi-lei", "lei fara TVA"), ("taxa calatorie", 99),
                            ("Suprataxa calatorie", 99), ("ab.gratuit elevi ZM +UAT-repartizare (-)", 110),
                            ("abonament 30 zile studenti 50% ZM- Primarie", 100),
                            ("Bilet 1 calatorie, Zona Metropolitana (repartizare din toate UAT-urile) -lei", "lei fara TVA")]:
            self.assertIsNone(T.classify(name, tarif), name)


def make_workbook(path):
    """Un centralizator 2024 minimal: 2 UAT-uri, rând de repartizare fără denumire, rând în lei și TOTAL."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["COMPANIA DE TRANSPORT PUBLIC IASI"])
    ws.append(["CENTRALIZATOR TITLURI DE CĂLĂTORIE VÂNDUTE ÎN PERIOADA IANUARIE - DECEMBRIE 2024"])
    ws.append([None, None, None, "Titluri de calatorie vandute"])
    ws.append(["UAT", "Denumire titlu de calatorie", "Tarif - lei - "] + MONTHS + ["TOTAL BUC.", "VALOARE"])
    ws.append(["ARONEANU", "bitet 1 calatorie UAT", 6] + [10] * 12 + [120, 600])
    ws.append([None, "REPARTIZARE DIN TOATE UAT-URILE", "bucati"] + [5] * 12 + [60])
    ws.append([None, "abonament 30 zile ZM+UAT", 300] + [1] + [0] * 11 + [1, 250])
    ws.append([None, "repartizat pe Iasi-lei", "lei fara TVA"] + [154] * 12 + [1848])
    ws.append([None, "taxa calatorie", 99] + [3] * 12 + [36])
    ws.append(["ŢUŢORA", "bilet 2 calatorii ZM+UAT", 14] + [2] * 12 + [24, 280])
    wb.save(path)


class Amtpi(unittest.TestCase):
    def test_parse(self):
        import transport_amtpi as A
        html = """<script>var ZONES = [ { id:"rediu", nr:7, name:"Rediu", color:"#C2185B" } ];
  var ROUTES = [
    // 7. Rediu
    { z:"rediu", nr:"701", stops:["Rond Copou","Breazu"], url:"https://www.amtpi.ro/701/" },
    { z:"rediu", nr:"23 / 23B", stops:["Podu Roș","Proselnici"], url:"https://www.amtpi.ro/23/", proj:true },
  ];</script>"""
        d = A.parse(html)
        self.assertEqual([x["linie"] for x in d["linii"]], ["701", "23", "23B"])
        self.assertTrue(d["linii"][2]["in_proiect"])
        self.assertEqual(d["linii"][0]["url"], "https://www.amtpi.ro/701/")
        self.assertEqual(d["linii"][0]["comuna"], "Rediu")


class Titluri(unittest.TestCase):
    def test_workbook(self):
        with tempfile.TemporaryDirectory() as d:
            x = Path(d) / "t2024.xlsx"
            make_workbook(x)
            r = subprocess.run([sys.executable, str(ROOT / "scripts" / "transport_titluri.py"), str(x), "--out", d],
                               capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            out = json.loads((Path(d) / "titluri_zm.json").read_text(encoding="utf-8"))
            self.assertEqual(out["months"][0], "2024-01")
            self.assertEqual(len(out["months"]), 12)
            aro = out["uat"]["95747"]
            self.assertEqual(aro["name"], "Aroneanu")
            self.assertEqual(aro["s"]["d_bilete"][0], [10] * 12)
            self.assertEqual(aro["s"]["r_bilete"][0], [5] * 12)
            self.assertEqual(aro["s"]["d_abonamente"], [[1] + [0] * 11, [135] + [0] * 11])
            tut = out["uat"]["99922"]                       # Ţuţora (sedilă) → SIRUTA din zmi_uat_web.geojson
            self.assertEqual(tut["s"]["d_bilete"][1], [4] * 12)
            csv = (Path(d) / "titluri_zm.csv").read_text(encoding="utf-8-sig").splitlines()
            self.assertEqual(csv[0].split(",")[:4], ["siruta", "uat", "an", "luna"])


KML = """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>CTP</name>
<Folder><name>Tramvai 9</name>
 <Placemark><name>dus</name><LineString><coordinates>27.56,47.16,0 27.57,47.165,0 27.58,47.166,0</coordinates></LineString></Placemark>
</Folder>
<Placemark><name>Traseul 20</name><ExtendedData><Data name="tip"><value>autobuz</value></Data></ExtendedData>
 <MultiGeometry><LineString><coordinates>27.58,47.16 27.59,47.15</coordinates></LineString>
 <LineString><coordinates>27.59,47.15 27.60,47.14</coordinates></LineString></MultiGeometry></Placemark>
<Placemark><name>Piata Unirii</name><Point><coordinates>27.5797,47.1658,0</coordinates></Point></Placemark>
<Placemark><name>Pe linia 20</name><Point><coordinates>27.5801,47.1601,0</coordinates></Point></Placemark>
<Placemark><name>Pe linia de tramvai</name><Point><coordinates>27.57,47.165,0</coordinates></Point></Placemark>
</Document></kml>"""


class Linii(unittest.TestCase):
    def test_refs_and_modes(self):
        self.assertEqual(L.line_ref({"name": "Traseul 20"}), "20")
        self.assertEqual(L.line_ref({"Name": "1 - Copou – Tg. Cucu"}), "1")
        self.assertEqual(L.line_ref({"nume": "L42b"}), "42B")
        self.assertEqual(L.line_ref({"name": "dus", "_folder": "Linia 36"}), "36")
        self.assertIsNone(L.line_ref({"name": "Copou"}))
        self.assertEqual(L.line_ref({"name": None, "folders": None, "layer": "traseu_TP_502_cu_extensie"}), "502")
        self.assertEqual(L.line_ref({"name": "402-sens2", "layer": "traseu_TP_402"}), "402")
        self.assertIsNone(L.line_ref({"nume": "Rețeaua de tramvai", "_folder": "retea_tramvai"}))
        self.assertEqual(L.line_mode({"tip": "Tramvai"}, "20", set()), "tramvai")
        self.assertEqual(L.line_mode({}, "9", set()), "tramvai")
        self.assertEqual(L.line_mode({}, "9", {"1", "3"}), "autobuz")
        self.assertEqual(L.line_mode({}, "46", set()), "autobuz")
        self.assertEqual(L.line_mode({"route_type": "0"}, "46", set()), "tramvai")
        self.assertEqual(L.line_mode({"route": "bus", "ref": "1"}, "1", set()), "autobuz")
        self.assertEqual(L.osm_name_ref({"name": "Bus 36: Breazu => Rond Dacia", "ref": "6B"}), "36")
        self.assertIsNone(L.osm_name_ref({"name": "Copou – Dacia"}))
        self.assertEqual(L.declared_network("rute_autobuz_local.shp", {}), "local")
        self.assertEqual(L.declared_network("trasee.kml", {"_folder": "Linii metropolitane"}), "metropolitan")
        self.assertEqual(L.declared_network("x.shp", {"network": "ZMI"}), "metropolitan")
        self.assertIsNone(L.declared_network("trasee.kml", {"network": "CTP Iași"}))

    @unittest.skipUnless(HAVE_GEO, "pyshp / pyproj / shapely lipsesc")
    def test_kmz_traseu_cu_statii(self):
        """KMZ în stilul AMTPI: numărul liniei din numele documentului, capetele din descriere, stațiile primesc linia
        fișierului; aceeași stație din două trasee adună liniile."""
        import zipfile
        def kmz(path, nr, desc, line, stops):
            pts = "".join(f"<Placemark><name>{n}</name><Point><coordinates>{x},{y},0</coordinates></Point></Placemark>" for n, x, y in stops)
            kml = (f'<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>{nr}</name><description>{desc}</description>'
                   f'<Folder><name>Sens 1</name><Placemark><LineString><coordinates>{line}</coordinates></LineString></Placemark>{pts}</Folder></Document></kml>')
            with zipfile.ZipFile(path, "w") as z:
                z.writestr("doc.kml", kml)
        with tempfile.TemporaryDirectory() as d:
            sub = Path(d) / "metropolitan_amtpi"
            sub.mkdir()
            kmz(sub / "801.kmz", "801", "Rond Tutora – Tomesti – Goruni", "27.62,47.16 27.66,47.17 27.70,47.18",
                [("Rond Tutora", 27.62, 47.16), ("Tomesti", 27.70, 47.18)])
            kmz(sub / "802.kmz", "802", "Rond Tutora – Tomesti – Chicerea", "27.62,47.16 27.66,47.15",
                [("Rond Tutora", 27.62, 47.16)])
            lines, stops = self.run_script(d, out=d)
            p = {f["properties"]["linie"]: f["properties"] for f in lines}
            self.assertEqual(set(p), {"801", "802"})
            self.assertEqual(p["801"]["retea"], "metropolitan")                  # din numele subdirectorului
            self.assertEqual(p["801"]["nume"], "Rond Tutora – Tomesti – Goruni")
            rond = [s["properties"] for s in stops if s["properties"]["nume"] == "Rond Tutora"]
            self.assertEqual(len(rond), 1)
            self.assertEqual(rond[0]["linii"], "801, 802")

    @unittest.skipUnless(HAVE_GEO, "pyshp / pyproj / shapely lipsesc")
    def test_prioritate_gtfs(self):
        """Traseul cu prioritate „principal” (orarul GTFS) înlocuiește traseele aceleiași linii din alte surse; liniile
        fără orar rămân din sursele alternative, cu stațiile lor."""
        def fc(feats):
            return json.dumps({"type": "FeatureCollection", "features": feats})
        def line(ref, coords, **kw):
            return {"type": "Feature", "properties": {"linie": ref, "tip": "autobuz", **kw},
                    "geometry": {"type": "LineString", "coordinates": coords}}
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "alt.geojson").write_text(fc([line("20", [[27.56, 47.16], [27.57, 47.16]]),
                                                    line("603", [[27.60, 47.20], [27.61, 47.21]])]), encoding="utf-8")
            (Path(d) / "gtfs.geojson").write_text(fc([line("20", [[27.56, 47.17], [27.58, 47.17]], prioritate="principal")]),
                                                  encoding="utf-8")
            lines, _ = self.run_script(d, out=d)
            got = sorted((f["properties"]["linie"], f["properties"]["sursa"]) for f in lines)
            self.assertEqual(got, [("20", "gtfs.geojson"), ("603", "alt.geojson")])

    def test_dedupe_stops(self):
        def st(name, x, y, strat="s"):
            return {"type": "Feature", "properties": {"nume": name, "strat": strat}, "geometry": {"type": "Point", "coordinates": [x, y]}}
        out = L.dedupe_stops([st("Tg. Cucu", 27.59058, 47.16441), st("Tg. Cucu", 27.59058, 47.16441),
                              st("Tg. Cucu", 27.5911, 47.1650), st("Tg. Cucu", 27.59058, 47.16441, "alt")])
        self.assertEqual(len(out), 3)          # dublura exactă dispare; peronul opus și alt strat rămân

    def run_script(self, *inputs, out):
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "transport_linii.py"), *map(str, inputs), "--out", out],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        lines = json.loads((Path(out) / "linii.geojson").read_text(encoding="utf-8"))["features"]
        sp = Path(out) / "statii.geojson"
        stops = json.loads(sp.read_text(encoding="utf-8"))["features"] if sp.exists() else []
        return lines, stops

    @unittest.skipUnless(HAVE_GEO, "pyshp / pyproj / shapely lipsesc")
    def test_kml(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "trasee.kml").write_text(KML, encoding="utf-8")
            lines, stops = self.run_script(d, out=d)
            p = [f["properties"] for f in lines]
            self.assertEqual([(x["linie"], x["tip"]) for x in p], [("9", "tramvai"), ("20", "autobuz")])
            self.assertEqual({x["retea"] for x in p}, {"local"})          # în întregime în municipiul Iași
            self.assertGreater(p[0]["km"], 1)
            self.assertEqual(lines[1]["geometry"]["type"], "LineString")      # bucățile unite (linemerge)
            self.assertEqual(stops[0]["properties"]["nume"], "Piata Unirii")
            self.assertEqual(stops[0]["properties"]["mod"], "autobuz")
            self.assertEqual(stops[1]["properties"]["linii"], "20")       # traseul liniei 20 trece la ~13 m
            self.assertIsNone(stops[2]["properties"]["linii"])            # stație de autobuz: tramvaiul 9 nu se numără

    @unittest.skipUnless(HAVE_GEO, "pyshp / pyproj / shapely lipsesc")
    def test_shapefile_stereo70(self):
        import shapefile
        from pyproj import CRS, Transformer
        tr = Transformer.from_crs("EPSG:4326", "EPSG:3844", always_xy=True)
        pts = [tr.transform(27.56, 47.16), tr.transform(27.60, 47.17)]
        with tempfile.TemporaryDirectory() as d:
            w = shapefile.Writer(str(Path(d) / "linii"), shapeType=shapefile.POLYLINE, encoding="utf-8")
            w.field("LINIE", "C", 10)
            w.field("TIP", "C", 20)
            w.line([[list(p) for p in pts]])
            w.record("36", "Autobuz")
            w.close()
            (Path(d) / "linii.prj").write_text(CRS.from_epsg(3844).to_wkt("WKT1_ESRI"))
            lines, _ = self.run_script(Path(d) / "linii.shp", out=d)
            c = lines[0]["geometry"]["coordinates"]
            self.assertEqual(lines[0]["properties"]["linie"], "36")
            self.assertAlmostEqual(c[0][0], 27.56, places=4)
            self.assertAlmostEqual(c[-1][1], 47.17, places=4)

    @unittest.skipUnless(HAVE_GEO, "pyshp / pyproj / shapely lipsesc")
    def test_geopackage(self):
        from shapely.geometry import LineString
        with tempfile.TemporaryDirectory() as d:
            gp = Path(d) / "retea.gpkg"
            c = sqlite3.connect(gp)
            c.executescript("""
              create table gpkg_spatial_ref_sys (srs_name text, srs_id integer primary key, organization text,
                organization_coordsys_id integer, definition text);
              insert into gpkg_spatial_ref_sys values ('WGS 84', 4326, 'EPSG', 4326, '');
              create table gpkg_contents (table_name text, data_type text, srs_id integer);
              create table gpkg_geometry_columns (table_name text, column_name text);
              insert into gpkg_contents values ('tramvai', 'features', 4326);
              insert into gpkg_geometry_columns values ('tramvai', 'geom');
              create table tramvai (fid integer primary key, geom blob, ref text);""")
            header = b"GP" + bytes([0, 1]) + struct.pack("<i", 4326)   # fără envelope, little-endian
            blob = header + LineString([(27.55, 47.15), (27.6, 47.16)]).wkb
            c.execute("insert into tramvai (geom, ref) values (?, ?)", (blob, "Linia 3"))
            c.commit()
            c.close()
            lines, _ = self.run_script(gp, out=d)
            self.assertEqual((lines[0]["properties"]["linie"], lines[0]["properties"]["tip"]), ("3", "tramvai"))
            self.assertEqual(lines[0]["geometry"]["coordinates"][0], [27.55, 47.15])


if __name__ == "__main__":
    unittest.main()
