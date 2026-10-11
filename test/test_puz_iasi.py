"""Teste pentru extragerea indicatorilor din hotărârile PUZ (scripts/puz_iasi.py).
Rulare: python3 -m unittest discover -s test -p 'test_puz*.py'"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import puz_iasi as P  # noqa: E402
import puz_mobilitate as M  # noqa: E402

HCL_497 = (
    "HOTĂRÂRE privind aprobarea Planului urbanistic zonal Iași, Zona Bucium, identificare cadastrala 161244, "
    "elaborat pentru modificare H.C.L. nr. 281/2005 in vederea construirii unui ansamblu de locuinte individuale, "
    "colective, spatii comerciale si dotari, persoana juridica Având în vedere avizul nefavorabil inregistrat sub "
    "nr. 96/17.12.2025 întocmit de Comisia pentru Amenajarea Teritoriului și Urbanism HOTĂRĂȘTE: Art.1 (1) Se aprobă "
    "Planul urbanistic zonal (2) Suprafața terenului reglementat prin PUZ este de 19.085,00mp. (3) INDICATORI "
    "URBANISTICI: UTR1 - Locuințe (Steren = 14530,00mp) • H max = la cornisa/atic de 10.00 m măsurată în punctul cel "
    "mai înalt, numarul de niveluri propuse D+P+2E; • POT max = 18%; • CUT max = 0.72 mp.ADC/mp.teren; • Spatii verzi "
    "minim = 30%. UTR2 • H max = la cornisa/atic de 13.00 m, numarul de niveluri propuse D+P+3E; • POT max = 18%; "
    "• CUT max = 0.72 mp.ADC/mp.teren; Total consilieri locali 27 Prezenți 24 Pentru 15 Împotrivă 0 Abțineri 9")


class PuzParse(unittest.TestCase):
    def test_levels(self):
        cases = {"D+P+4E+5ERETRA": ("D+P+4E+5ER", 6), "P+1EPARTI": ("P+1E", 2), "S+D+P+3E.": ("S+D+P+3E", 4),
                 "2S+P+2M+23E+ETH": ("2S+P+2M+23E+ETH", 26), "D+P+6E+7E": ("D+P+6E+7E", 8), "D+P+E": ("D+P+E", 2)}
        for raw, (norm, n) in cases.items():
            self.assertEqual(P.norm_levels(raw), norm)
            self.assertEqual(P.level_count(norm), n)

    def test_numbers(self):
        self.assertEqual(P.num("19.085,00"), 19085.0)
        self.assertEqual(P.num("0.72"), 0.72)
        self.assertEqual(P.num("1 800"), 1800.0)
        self.assertEqual(P.word_num("opt"), 8)
        self.assertEqual(P.word_num("1.600"), 1600)

    def test_status(self):
        self.assertEqual(P.status_of("HOTĂRÂRE privind respingerea Planului urbanistic zonal"), "respins")
        self.assertEqual(P.status_of("HOTĂRÂRE privind aprobarea modificarii Hotararii Consiliului Local nr. 96"), "modificare")
        self.assertEqual(P.status_of("HOTĂRÂRE privind aprobarea Planului urbanistic zonal Iasi"), "aprobat")

    def test_title_filter(self):
        self.assertTrue(P.PUZ_TITLE.search(P.fold("HOTĂRÂRE privind aprobarea Planului Urbanistic pentru Zona Construita Protejata IASI")))
        self.assertFalse(P.PUZ_TITLE.search(P.fold(
            "HOTĂRÂRE privind aprobarea indicatorilor tehnico - economici și a devizului general al obiectivului de "
            "investiție EXTINDERE CORP LICEU CONFORM PUZ APROBAT")))

    def test_decision(self):
        dec = {"id": "2025/h497", "nr": 497, "data": "2025-12-19", "titlu": HCL_497[:260]}
        r = P.parse_decision(dec, HCL_497, "https://www.primaria-iasi.ro/x.pdf")
        self.assertEqual(r["hcl"], "497/2025")
        self.assertEqual(r["statut"], "aprobat")
        self.assertEqual(r["adresa"], "Zona Bucium")
        self.assertEqual(r["cadastral"], "161244")
        self.assertEqual(r["suprafata_mp"], 19085.0)
        self.assertEqual(r["regim_inaltime"], "D+P+3E")
        self.assertEqual(r["niveluri_max"], 4)
        self.assertEqual(r["h_max_m"], 13.0)
        self.assertEqual((r["pot_max"], r["cut_max"], r["spatii_verzi_min"]), (18.0, 0.72, 30.0))
        self.assertEqual((r["vot_pentru"], r["vot_abtineri"], r["vot_prezenti"]), (15, 9, 24))
        self.assertIn("CATU: nefavorabil", r["avize_comisii"])
        self.assertEqual(r["functiune"], "locuințe colective")

    def test_address_queries(self):
        q = P.address_queries("strada Aurel Vlaicu nr. 78")
        self.assertEqual(q[0], ("strada aurel vlaicu 78, Iași", "număr"))
        self.assertEqual(q[1][1], "stradă")
        self.assertEqual(P.address_queries("Zona Moara de Vant")[0], ("Moara De Vant, Iași", "zonă"))
        self.assertEqual(P.split_address("lasi strada Serg. Grigore Ioan nr. 7"), ("strada", "grigore ion", "7", None))
        self.assertEqual(P.split_address("soseaua Iasi - Ungheni nr. 52")[1], "iasi ungheni")
        self.assertEqual(P.split_address("Zona Bucium – Dealul Craitelor (T173)")[3], "bucium")

    def test_homonym_outside_iasi_rejected(self):
        g = P.Geocoder.__new__(P.Geocoder)
        iasi = [ps for k, ps in P.load_polys(P.DATA / "zmi_uat_web.geojson",
                                              lambda p: p.get("canonical_name") or p.get("name")) if k == "Iași"]
        g.iasi = iasi[0]
        self.assertTrue(g.in_iasi({"lat": "47.1624", "lon": "27.5867"}))       # centrul Iașului
        self.assertFalse(g.in_iasi({"lat": "47.179869", "lon": "27.520304"}))  # Valea Lupului

    def test_partial_overpass_is_merged_with_local_network(self):
        from unittest import mock
        partial = [["Strada Lascăr Catargi", 27.585, 47.169]] * 10
        with mock.patch.object(P, "overpass_streets", return_value=partial):
            st = P.OSMStreets()
        self.assertIn("parțial", st.source)
        self.assertIsNotNone(st.find("strada", "lascar catargi"))   # din Overpass
        self.assertIsNotNone(st.find("strada", "otelariei"))        # din rețeaua pietonală

    def test_locate_by_parcels(self):
        sq = {"type": "Polygon", "coordinates": [[[27.6, 47.1], [27.601, 47.1], [27.601, 47.101], [27.6, 47.1]]]}
        parcels = {"161244": (27.6005, 47.1005, 19000.0, sq), "8754": (27.55, 47.17, 460.0, sq)}
        r = {"cadastral": "161244", "suprafata_mp": 19085.0}
        lat, lon, geoms = P.locate_by_parcels(r, parcels)
        self.assertAlmostEqual(lat, 47.1005)
        self.assertEqual(len(geoms), 1)
        # număr cadastral vechi, scurt, care coincide cu o parcelă de altă mărime → respins
        self.assertIsNone(P.locate_by_parcels({"cadastral": "8754", "suprafata_mp": 11932.0}, parcels))
        self.assertIsNone(P.locate_by_parcels({"cadastral": "8754", "suprafata_mp": None}, parcels))
        self.assertIsNone(P.locate_by_parcels({"cadastral": "999999", "suprafata_mp": 500.0}, parcels))

    def test_apix_extraction(self):
        r = {"hcl": "1/2026", "data": "2026-01-30", "statut": "aprobat", "adresa": "strada Cicoarei nr. 3",
             "cadastral": "", "suprafata_mp": 30123.0, "cut_max": 4.0, "functiune": "locuințe colective"}
        post = {"date": "2025-11-01", "link": "https://apix.ro/x/", "title": "Ansamblu pe strada Cicoarei",
                "text": "", "fold": P.fold("Ansamblu pe strada Cicoarei . Pe strada Cicoarei nr. 3 vor fi ridicate "
                                           "blocuri cu circa 1.200 de apartamente și 1.350 de locuri de parcare.")}
        P.enrich_apix([r], [post])
        self.assertEqual(r["apartamente"], 1200)
        self.assertEqual(r["locuri_parcare"], 1350)
        self.assertTrue(r["sursa_apartamente"].startswith("apix.ro (estimare)"))

    def test_capacity_rejects_implausible(self):
        r = {"hcl": "2/2026", "data": "2026-01-30", "statut": "aprobat", "adresa": "strada Aurel Vlaicu nr. 78",
             "cadastral": "", "suprafata_mp": 951.0, "cut_max": 2.0, "functiune": "locuințe colective"}
        post = {"date": "2025-11-01", "link": "https://apix.ro/y/", "title": "Proiecte noi",
                "text": "", "fold": P.fold("Pe strada Aurel Vlaicu nr. 78 se propun 2.200 de apartamente.")}
        P.enrich_apix([r], [post])
        self.assertIsNone(r.get("apartamente"))


class PuzMobilitate(unittest.TestCase):
    cfg = __import__("json").loads((Path(__file__).resolve().parent.parent / "config" / "puz_mobilitate.json").read_text(encoding="utf-8"))

    def test_scenarios(self):
        p = {"hcl": "1/2025", "statut": "aprobat", "functiune": "locuințe colective", "suprafata_mp": 10000.0,
             "cut_max": 2.0, "data": "2025-03-01", "cadastral": "", "_lon": 27.5815, "_lat": 47.1653}
        r = M.model(p, self.cfg, {})
        # maxim: 10000 × 2 × 0,8 ÷ 75 = 213,3 apartamente; realist: 60%
        self.assertAlmostEqual(r["maxim_apartamente"], 213.3, places=1)
        self.assertAlmostEqual(r["realist_apartamente"], 128.0, places=1)
        pers = 2.73 * 0.65
        self.assertEqual(r["maxim_locuitori"], round(213.333 * pers))
        self.assertEqual(r["maxim_PMUD_deplasari_zi"], round(213.333 * pers * 1.61))
        self.assertGreater(r["maxim_RPL_deplasari_zi"], r["maxim_PMUD_deplasari_zi"])
        self.assertFalse(r["periferie"])
        self.assertEqual(r["maxim_atractie_deplasari_zi"], 0)

    def test_known_apartments_and_periphery(self):
        p = {"hcl": "2/2025", "statut": "aprobat", "functiune": "locuințe colective", "suprafata_mp": 10000.0,
             "cut_max": 2.0, "apartamente": 100, "_lon": 27.65, "_lat": 47.11}
        r = M.model(p, self.cfg, {})
        self.assertEqual(r["realist_apartamente"], 100.0)
        self.assertEqual(r["maxim_apartamente"], 100.0)
        self.assertTrue(r["periferie"])
        self.assertEqual(r["pondere_auto"], 0.40)

    def test_rejected_and_attraction(self):
        self.assertIsNone(M.model({"statut": "respins", "functiune": "locuințe colective"}, self.cfg, {}))
        p = {"hcl": "3/2025", "statut": "aprobat", "functiune": "comerț / servicii / birouri", "suprafata_mp": 5000.0,
             "cut_max": 1.0}
        r = M.model(p, self.cfg, {})
        self.assertEqual(r["maxim_locuitori"], 0)
        self.assertEqual(r["maxim_atractie_deplasari_zi"], 1000)   # 5000 mp ÷ 100 × 20

    def test_built_after_approval(self):
        parcels = {"161244": {"constructii_mp_pe_an": {"2015": 100.0, "2026": 250.0}}}
        self.assertEqual(M.built_after({"cadastral": "161244", "data": "2025-12-19"}, parcels), 250.0)
        self.assertIsNone(M.built_after({"cadastral": "999", "data": "2025-12-19"}, parcels))


if __name__ == "__main__":
    unittest.main()
