"""Planul de referință al hărții „Sănătatea transportului public” (scripts/transport_sanatate.py), pe feedul GTFS
din depozit. Rulare: python3 -m unittest discover -s test -p 'test_transport*.py'"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import transport_sanatate as S  # noqa: E402


class Simplify(unittest.TestCase):
    def test_keeps_corners_drops_collinear(self):
        line = [[27.5 + i * 1e-4, 47.16] for i in range(10)] + [[27.5009, 47.16 + i * 1e-4] for i in range(1, 10)]
        out = S.simplify(line)
        self.assertEqual(out, [line[0], line[9], line[-1]])
        self.assertAlmostEqual(S.length(line), S.length(out), delta=0.01)


@unittest.skipUnless(S.FEED.exists() and S.SHAPES.exists(), "fără feedul GTFS / formele traseelor")
class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.plan = S.build()

    def test_routes(self):
        rute = self.plan["rute"]
        self.assertGreater(len(rute), 50)
        r = rute["8_1"]                                   # linia 46 spre Păcurari (route_id 8, sensul 1)
        self.assertEqual(r["linie"], "46")
        self.assertGreater(r["lungime"], 5000)
        self.assertGreaterEqual(len(r["forma"]), 2)
        for s, curse in r["curse"].items():
            self.assertIn(s, self.plan["servicii"])
            self.assertTrue(all(a < b for a, b in curse))

    def test_services(self):
        self.assertTrue(all(0 <= d <= 6 for days in self.plan["servicii"].values() for d in days))


if __name__ == "__main__":
    unittest.main()


class Tranzy(unittest.TestCase):
    def test_routes_and_aliases(self):
        import tempfile
        import transport_tranzy as T
        rute = T.routes([{"route_id": 65, "route_short_name": "7", "route_type": 0, "route_long_name": "Canta - Tutora"},
                         {"route_id": 8, "route_short_name": "46", "route_type": 3},
                         {"route_id": 200, "route_short_name": "999", "route_type": 3}])
        self.assertEqual(rute["65"], {"linie": "7", "tip": "tramvai", "nume": "Canta - Tutora"})
        gtfs = {"8": {"route_short_name": "46", "route_type": "3"}, "14": {"route_short_name": "7", "route_type": "0"}}
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "tranzy_rute.json"
            p.write_text(json.dumps({"rute": rute}), encoding="utf-8")
            # 65 (tramvaiul 7 în Tranzy) → ruta 14 din orar; 8 e aceeași linie; 999 nu există în orar
            self.assertEqual(S.aliases(gtfs, p), {"65": "14"})
        self.assertEqual(S.aliases(gtfs, Path(d) / "lipsa.json"), {})
