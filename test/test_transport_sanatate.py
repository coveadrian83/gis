"""Planul de referință al hărții „Sănătatea transportului public” (scripts/transport_sanatate.py), pe feedul GTFS
din depozit. Rulare: python3 -m unittest discover -s test -p 'test_transport*.py'"""
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
