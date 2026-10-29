"""Developer-only tests for refreshing the ESDB snapshot (stdlib Python only)."""
import importlib.util
from pathlib import Path
import sqlite3
import unittest

spec = importlib.util.spec_from_file_location("export_spelling", Path(__file__).resolve().parents[1] / "scripts/export-spelling.py")
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class ExportSpellingTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            create table groups(group_id integer, base_pos text, defn_note text, usage_note text, group_rank text);
            create table words_w_variant_info(group_id integer, pos text, word text, spelling text, variant_level integer, entry_rank text);
            create table scowl_data(group_id integer, pos text, size integer, category text, region text, tag text);
        """)
        self.group_id = 0

    def tearDown(self):
        self.db.close()

    def group(self, forms, *, note="", size=35, variant=0):
        self.group_id += 1
        self.db.execute("insert into groups values(?, 'v', ?, '', '')", (self.group_id, note))
        self.db.execute("insert into scowl_data values(?, 'v0', ?, '', '', '')", (self.group_id, size))
        self.db.executemany("insert into words_w_variant_info values(?, 'v0', ?, ?, ?, '')",
                            [(self.group_id, word, code, variant) for word, code in forms])

    def test_exports_only_common_explicit_spelling_families(self):
        self.group([("color", "A"), ("colour", "B")])
        self.group([("organization", "A"), ("organisation", "B")])
        self.group([("center", "A"), ("centre", "B")])
        self.group([("valor", "A"), ("valour", "B")], size=70)
        self.group([("favor", "A"), ("favour", "B")], variant=4)
        self.assertEqual(exporter.export(self.db)[0], [("color", "colour"), ("organization", "organisation")])

    def test_other_senses_and_identity_mappings_block_both_directions(self):
        self.group([("prize", "A"), ("prise", "B")])
        self.group([("prize", "_")])
        self.assertEqual(exporter.export(self.db)[0], [])

    def test_usage_notes_and_multiple_preferred_targets_are_excluded(self):
        self.group([("odor", "A"), ("odour", "B")], note="special sense")
        self.group([("glamorize", "A"), ("glamorise", "B"), ("glamourise", "B")])
        self.assertEqual(exporter.export(self.db)[0], [])


if __name__ == "__main__":
    unittest.main()
