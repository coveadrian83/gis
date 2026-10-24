"""Teste pentru exportul hărții micromobilității (scripts/export_micro15.py), pe un fișier OSM XML sintetic.
Rulare: python3 -m unittest discover -s test -p 'test_micro15*.py'
(testul exportului complet necesită osmnx și se omite fără el)"""
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import export_micro15 as M  # noqa: E402

try:
    import osmnx  # noqa: F401
    HAVE_OSMNX = True
except ImportError:
    HAVE_OSMNX = False

LAT0, LON0 = 47.16, 27.58
STEP = 0.001   # ≈ 76 m pe longitudine, 111 m pe latitudine

# noduri pe o linie de la vest la est: id → (lon, lat)
NODES = {i: (LON0 + i * STEP, LAT0) for i in range(1, 17)}
NODES[2] = (LON0 + 2 * STEP, LAT0 + 0.0003)   # punct intermediar pe strada A (dispare la simplificare)
# căi: (id, noduri, etichete)
WAYS = [
    (101, [1, 2, 3], {"highway": "residential", "name": "Strada A", "maxspeed": "50"}),
    (102, [3, 4], {"highway": "primary", "name": "Bulevardul B", "maxspeed": "60", "lanes": "4"}),
    (103, [4, 5], {"highway": "primary", "name": "Bulevardul C", "maxspeed": "60", "cycleway:right": "track"}),
    (104, [5, 6], {"highway": "residential", "oneway": "yes"}),
    (105, [6, 7], {"highway": "residential", "oneway": "-1"}),
    (106, [7, 8], {"highway": "residential", "oneway": "yes", "oneway:bicycle": "no"}),
    (107, [8, 9], {"highway": "footway", "footway": "sidewalk"}),
    (108, [9, 10], {"highway": "cycleway"}),
    (109, [10, 11], {"highway": "steps", "step_count": "10", "incline": "up"}),
    (110, [11, 12], {"highway": "motorway"}),
    (111, [12, 13], {"highway": "pedestrian", "bicycle": "yes"}),
    (112, [13, 14], {"highway": "residential", "surface": "sett"}),
    (113, [14, 15], {"highway": "tertiary", "junction": "roundabout"}),
    (114, [15, 16], {"highway": "secondary", "bicycle": "no"}),
]
POIS = [
    (901, LON0 + 1.5 * STEP, LAT0 + 0.0002, {"amenity": "bicycle_parking"}),
    (902, LON0 + 3.5 * STEP, LAT0 + 0.0002, {"amenity": "bicycle_rental"}),
    (903, LON0 + 4.5 * STEP, LAT0 + 0.0002, {"shop": "supermarket"}),
    (904, LON0 + 5.5 * STEP, LAT0 + 0.0002, {"highway": "bus_stop", "name": "Copou"}),
    (905, LON0 + 5.5 * STEP, LAT0 - 0.0002, {"highway": "bus_stop", "name": "Copou"}),
    (906, LON0 + 6.5 * STEP, LAT0 + 0.0002, {"amenity": "bench"}),
]


def osm_xml():
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6" generator="test">']
    for i, (lon, lat) in NODES.items():
        out.append(f'<node id="{i}" lat="{lat:.7f}" lon="{lon:.7f}" version="1"/>')
    for i, lon, lat, tags in POIS:
        out.append(f'<node id="{i}" lat="{lat:.7f}" lon="{lon:.7f}" version="1">')
        out += [f'<tag k="{k}" v="{v}"/>' for k, v in tags.items()]
        out.append("</node>")
    for i, nds, tags in WAYS:
        out.append(f'<way id="{i}" version="1">')
        out += [f'<nd ref="{n}"/>' for n in nds]
        out += [f'<tag k="{k}" v="{v}"/>' for k, v in tags.items()]
        out.append("</way>")
    out.append("</osm>")
    return "\n".join(out)


class ClassifyTest(unittest.TestCase):
    def test_lanes(self):
        self.assertEqual(M.parse_lanes("4"), 4)
        self.assertEqual(M.parse_lanes(["2", "3"]), 3)
        self.assertEqual(M.parse_lanes(None), 0)
        self.assertEqual(M.parse_lanes("2;3"), 2)

    def test_maxspeed(self):
        self.assertEqual(M.parse_maxspeed("50"), 50)
        self.assertEqual(M.parse_maxspeed("RO:urban"), 50)
        self.assertEqual(M.parse_maxspeed("RO:rural"), 90)
        self.assertEqual(M.parse_maxspeed("30 mph"), 48)
        self.assertEqual(M.parse_maxspeed("walk"), 5)
        self.assertEqual(M.parse_maxspeed(""), 0)
        self.assertEqual(M.parse_maxspeed("signals"), 0)

    def test_classes(self):
        c = lambda **t: M.classify(t)
        self.assertEqual(c(highway="cycleway"), (M.CLS_CYCLEWAY, M.F_NOFOOT))
        self.assertEqual(c(highway="footway", bicycle="designated", foot="designated")[0], M.CLS_CYCLEWAY)
        self.assertEqual(c(highway="footway")[0], M.CLS_FOOTWAY)
        self.assertEqual(c(highway="footway", bicycle="yes")[0], M.CLS_SHARED)
        self.assertEqual(c(highway="pedestrian", bicycle="dismount")[0], M.CLS_FOOTWAY)
        self.assertEqual(c(highway="path")[0], M.CLS_PATH)
        self.assertEqual(c(highway="track"), (M.CLS_PATH, M.F_UNPAVED))
        self.assertEqual(c(highway="primary", **{"cycleway:both": "lane"}), (M.CLS_PRIMARY, M.F_LANE))
        self.assertEqual(c(highway="primary", cycleway="shared_lane"), (M.CLS_PRIMARY, 0))
        self.assertEqual(c(highway="secondary", bicycle="no")[0], M.CLS_NOBIKE)
        self.assertEqual(c(highway="trunk", motorroad="yes"), (M.CLS_MOTORWAY, M.F_NOFOOT))
        self.assertEqual(c(highway="residential", surface="sett"), (M.CLS_LOCAL, M.F_SETT))
        self.assertEqual(c(highway="steps")[0], M.CLS_STEPS)

    def test_oneway(self):
        o = lambda **t: M.bike_oneway(t)
        self.assertTrue(o(oneway="yes"))
        self.assertTrue(o(oneway="-1"))
        self.assertTrue(o(junction="roundabout"))
        self.assertFalse(o(oneway="yes", **{"oneway:bicycle": "no"}))
        self.assertFalse(o(oneway="yes", cycleway="opposite_lane"))
        self.assertFalse(o(oneway="yes", **{"cycleway:left:oneway": "-1"}))
        self.assertTrue(o(**{"oneway:bicycle": "yes"}))
        self.assertFalse(o(oneway="no", junction="roundabout"))
        self.assertFalse(o())

    def test_poi_categories(self):
        self.assertEqual(M.categorize({"amenity": "bicycle_parking"})[0], M.BIKE_PARKING)
        self.assertEqual(M.categorize({"amenity": "kick-scooter_rental"})[0], M.RENTAL)
        self.assertEqual(M.categorize({"highway": "bus_stop"})[0], M.STATION)
        self.assertEqual(M.categorize({"shop": "bakery"})[0], 0)
        self.assertIsNone(M.categorize({"amenity": "bench"}))


@unittest.skipUnless(HAVE_OSMNX, "osmnx nu este instalat")
class ExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        (d / "test.osm").write_text(osm_xml(), encoding="utf-8")
        subprocess.run([sys.executable, str(ROOT / "scripts" / "export_micro15.py"), "--xml", str(d / "test.osm"),
                        "--out", str(d / "out")], check=True, capture_output=True)
        cls.out = d / "out"
        buf = (cls.out / "graph.bin").read_bytes()
        _v, nN, nE, _nS = struct.unpack_from("<4I", buf, 0)
        off = 16
        ll = struct.unpack_from("<%di" % (2 * nN), buf, off); off += 8 * nN
        eu = struct.unpack_from("<%dI" % nE, buf, off); off += 4 * nE
        ev = struct.unpack_from("<%dI" % nE, buf, off); off += 4 * nE
        lf = struct.unpack_from("<%dI" % nE, buf, off)
        # nodul din graph.bin → id-ul nodului OSM (după coordonate)
        by_pos = {(round(lon * 1e5), round(lat * 1e5)): i for i, (lon, lat) in NODES.items()}
        osm_id = [by_pos[(ll[2 * k], ll[2 * k + 1])] for k in range(nN)]
        mb = (cls.out / "micro.bin").read_bytes()
        ver, n = struct.unpack_from("<2I", mb, 0)
        assert ver == 2 and n == nE
        cls.edges = {}
        for e in range(nE):
            a, b = osm_id[eu[e]], osm_id[ev[e]]
            cls.edges[(min(a, b), max(a, b))] = {
                "cls": mb[8 + e], "flags": mb[8 + nE + e], "maxspeed": mb[8 + 2 * nE + e], "lanes": mb[8 + 3 * nE + e], "kind": lf[e] & 3,
                # sensul permis vehiculelor, exprimat în id-uri OSM: (de la, la) sau None
                "oneway": None if not (mb[8 + nE + e] >> M.ONEWAY_SHIFT) & 3 else
                ((osm_id[eu[e]], osm_id[ev[e]]) if ((mb[8 + nE + e] >> M.ONEWAY_SHIFT) & 3) == 1 else (osm_id[ev[e]], osm_id[eu[e]])),
            }
        cls.meta = json.loads((cls.out / "meta.json").read_text(encoding="utf-8"))
        cls.pois = json.loads((cls.out / "pois.json").read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_all_ways_kept_and_simplified(self):
        self.assertEqual(len(self.edges), len(WAYS))
        self.assertIn((1, 3), self.edges)   # nodul 2 a dispărut la simplificare

    def test_classes_and_speeds(self):
        e = self.edges
        self.assertEqual(e[(1, 3)]["cls"], M.CLS_LOCAL)
        self.assertEqual(e[(1, 3)]["maxspeed"], 50)
        self.assertEqual((e[(3, 4)]["cls"], e[(3, 4)]["maxspeed"], e[(3, 4)]["flags"] & M.F_LANE), (M.CLS_PRIMARY, 60, 0))
        self.assertEqual(e[(4, 5)]["flags"] & M.F_LANE, M.F_LANE)
        self.assertEqual((e[(3, 4)]["lanes"], e[(4, 5)]["lanes"]), (4, 0))
        self.assertEqual(e[(8, 9)]["cls"], M.CLS_FOOTWAY)
        self.assertEqual(e[(9, 10)]["cls"], M.CLS_CYCLEWAY)
        self.assertEqual((e[(10, 11)]["cls"], e[(10, 11)]["kind"]), (M.CLS_STEPS, 1))
        self.assertEqual(e[(11, 12)]["cls"], M.CLS_MOTORWAY)
        self.assertEqual(e[(12, 13)]["cls"], M.CLS_SHARED)
        self.assertEqual(e[(13, 14)]["flags"] & M.F_SETT, M.F_SETT)
        self.assertEqual(e[(15, 16)]["cls"], M.CLS_NOBIKE)

    def test_oneway_directions(self):
        e = self.edges
        self.assertEqual(e[(5, 6)]["oneway"], (5, 6))    # oneway=yes: în sensul căii
        self.assertEqual(e[(6, 7)]["oneway"], (7, 6))    # oneway=-1: invers
        self.assertIsNone(e[(7, 8)]["oneway"])           # oneway:bicycle=no
        self.assertEqual(e[(14, 15)]["oneway"], (14, 15))   # sens giratoriu
        self.assertIsNone(e[(1, 3)]["oneway"])

    def test_pois_and_meta(self):
        cats = [p[2] for p in self.pois["pts"]]
        self.assertEqual(self.pois["cats"], M.CATS)
        self.assertEqual(cats.count(M.BIKE_PARKING), 1)
        self.assertEqual(cats.count(M.RENTAL), 1)
        self.assertEqual(cats.count(M.STATION), 1)        # cele două sensuri ale stației Copou, unite
        self.assertEqual(cats.count(0), 1)
        self.assertEqual(len(cats), 4)                     # banca nu intră
        self.assertGreater(self.meta["infrastructure"]["km_roads_maxspeed_over_50"], 0)
        self.assertEqual(self.meta["edges"], len(WAYS))


if __name__ == "__main__":
    unittest.main()
