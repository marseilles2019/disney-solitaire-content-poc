import unittest, sys, tempfile, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

# Tests import the *pure* helpers from server.py — no real HTTP.
from server import upsert_pending_change


class DedupeTests(unittest.TestCase):
    def test_replace_asset_and_rect_on_same_id_coexist(self):
        doc = {"changes": []}
        # First: sprite replace
        upsert_pending_change(doc, {
            "id": "el-1",
            "actionType": "replace_asset",
            "targetAssetPath": "Assets/Art/foo.png",
            "newBytesBase64": "AAA=",
        })
        # Second: rect patch on the SAME id
        upsert_pending_change(doc, {
            "id": "el-1",
            "actionType": "set_rect_transform",
            "rect": {"hasAnchoredX": True, "anchoredX": 12.0,
                     "hasAnchoredY": False, "anchoredY": 0.0,
                     "hasWidth": False, "width": 0.0,
                     "hasHeight": False, "height": 0.0},
        })
        self.assertEqual(len(doc["changes"]), 2, "both patches must coexist")
        types = sorted(c["actionType"] for c in doc["changes"])
        self.assertEqual(types, ["replace_asset", "set_rect_transform"])

    def test_same_id_and_actionType_overwrites(self):
        doc = {"changes": [{
            "id": "el-2", "actionType": "set_rect_transform",
            "rect": {"hasAnchoredX": True, "anchoredX": 1.0},
        }]}
        upsert_pending_change(doc, {
            "id": "el-2",
            "actionType": "set_rect_transform",
            "rect": {"hasAnchoredX": True, "anchoredX": 99.0,
                     "hasAnchoredY": False, "anchoredY": 0.0,
                     "hasWidth": False, "width": 0.0,
                     "hasHeight": False, "height": 0.0},
        })
        self.assertEqual(len(doc["changes"]), 1)
        self.assertEqual(doc["changes"][0]["rect"]["anchoredX"], 99.0)


if __name__ == "__main__":
    unittest.main()
