"""Teste pentru agregarea chestionarului velo (scripts/chestionar_velo.py): împărțirea textului liber și
potrivirea cu denumirile străzilor din OSM. Rulare: python3 -m unittest discover -s test -p 'test_chestionar*.py'"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import chestionar_velo as Q  # noqa: E402

NAMES = {"Bulevardul Carol I": 3000, "Strada Carol": 200, "Bulevardul Ștefan cel Mare și Sfânt": 900,
         "Șoseaua Nicolina": 2500, "Strada Nicolina": 400, "Bulevardul Profesor Dimitrie Mangeron": 1800,
         "Bulevardul Poitiers": 1500, "Splai Bahlui Mal Stâng": 2500, "Strada Ion C. Brătianu": 700,
         "Bulevardul Tudor Vladimirescu": 2000, "Strada Palat": 600, "Bulevardul Independenței": 1500}


class FragmentsTest(unittest.TestCase):
    def test_split(self):
        self.assertEqual(Q.fragments("Str. Cuza Vodă. Splai Bahlui. Bulevardul Ștefan cel Mare și Sfânt"),
                         ["Str  Cuza Vodă", "Splai Bahlui", "Bulevardul Ștefan cel Mare și Sfânt"])
        self.assertEqual(Q.fragments("Copou si Tudor"), ["Copou", "Tudor"])
        self.assertEqual(Q.fragments("Bld. Prof. D. Mangeron"), ["Bld  Prof  D  Mangeron"])
        self.assertEqual(Q.fragments("Stefan cel Mare pana in Piata Unirii"), ["Stefan cel Mare"])
        self.assertEqual(Q.fragments("-"), [])
        self.assertEqual(Q.fragments(None), [])
        self.assertEqual(Q.fragments("Str."), [])


class MatchTest(unittest.TestCase):
    idx = Q.StreetIndex(list(NAMES), list(NAMES.values()))

    def test_aliases_and_types(self):
        m = self.idx.match
        self.assertEqual(m("Copou"), "Bulevardul Carol I")
        self.assertEqual(m("Bd. Carol"), "Bulevardul Carol I")
        self.assertEqual(m("Str Carol"), "Strada Carol")          # tipul scris are prioritate
        self.assertEqual(m("Nicolina"), "Șoseaua Nicolina")        # fără tip: șoseaua
        self.assertEqual(m("str Nicolina"), "Strada Nicolina")
        self.assertEqual(m("Bld  Prof  D  Mangeron"), "Bulevardul Profesor Dimitrie Mangeron")
        self.assertEqual(m("Stefan cel Mare"), "Bulevardul Ștefan cel Mare și Sfânt")
        self.assertEqual(m("bd T Vladimirescu"), "Bulevardul Tudor Vladimirescu")
        self.assertEqual(m("Ic Bratianu"), "Strada Ion C. Brătianu")
        self.assertEqual(m("Splai Bahlui"), "Splai Bahlui Mal Stâng")

    def test_typos_and_misses(self):
        m = self.idx.match
        self.assertEqual(m("Poaitiers"), "Bulevardul Poitiers")
        self.assertEqual(m("independentei"), "Bulevardul Independenței")
        self.assertIsNone(m("centrul orasului"))
        self.assertIsNone(m("toate"))


if __name__ == "__main__":
    unittest.main()
