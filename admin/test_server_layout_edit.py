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


import math
from server import validate_rect_patch_body


class RectValidationTests(unittest.TestCase):
    def _ok(self):
        return {
            "id": "src#0/Canvas/Foo",
            "rect": {
                "hasAnchoredX": True, "anchoredX": 12.5,
                "hasAnchoredY": True, "anchoredY": -3.0,
                "hasWidth": True,     "width": 240.0,
                "hasHeight": True,    "height": 240.0,
            },
        }

    def test_valid_body(self):
        ok, err = validate_rect_patch_body(self._ok())
        self.assertTrue(ok, err)

    def test_missing_id(self):
        body = self._ok(); body.pop("id")
        ok, err = validate_rect_patch_body(body)
        self.assertFalse(ok); self.assertIn("id", err)

    def test_nan_field(self):
        body = self._ok(); body["rect"]["anchoredX"] = float("nan")
        ok, err = validate_rect_patch_body(body)
        self.assertFalse(ok); self.assertIn("finite", err.lower())

    def test_infinity_field(self):
        body = self._ok(); body["rect"]["width"] = float("inf")
        ok, err = validate_rect_patch_body(body)
        self.assertFalse(ok); self.assertIn("finite", err.lower())

    def test_negative_width(self):
        body = self._ok(); body["rect"]["width"] = -1.0
        ok, err = validate_rect_patch_body(body)
        self.assertFalse(ok); self.assertIn("width", err)

    def test_negative_height(self):
        body = self._ok(); body["rect"]["height"] = -0.001
        ok, err = validate_rect_patch_body(body)
        self.assertFalse(ok); self.assertIn("height", err)

    def test_missing_rect(self):
        body = self._ok(); body.pop("rect")
        ok, err = validate_rect_patch_body(body)
        self.assertFalse(ok); self.assertIn("rect", err)

    def test_negative_anchored_xy_allowed(self):
        body = self._ok()
        body["rect"]["anchoredX"] = -100.0
        body["rect"]["anchoredY"] = -50.0
        ok, err = validate_rect_patch_body(body)
        self.assertTrue(ok, err)

    def test_zero_dimensions_allowed(self):
        body = self._ok()
        body["rect"]["width"] = 0.0
        body["rect"]["height"] = 0.0
        ok, err = validate_rect_patch_body(body)
        self.assertTrue(ok, err)


import threading, http.client, time, os
import server as srv


class RectEndpointHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.data_root = Path(cls.tmp.name)
        cls.repo_root = Path(__file__).parent.parent
        cls.port = 18800 + (os.getpid() % 100)
        cls.server = srv.make_server("127.0.0.1", cls.port, cls.repo_root, data_root=cls.data_root)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.15)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def test_post_valid_rect_writes_pending_changes(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        body = json.dumps({
            "id": "src#0/Canvas/Foo",
            "rect": {
                "hasAnchoredX": True, "anchoredX": 12.5,
                "hasAnchoredY": True, "anchoredY": -3.0,
                "hasWidth":     True, "width":     240.0,
                "hasHeight":    True, "height":    240.0,
            },
        })
        conn.request("POST", "/api/pending-changes/rect", body,
                     {"Content-Type": "application/json"})
        resp = conn.getresponse()
        self.assertEqual(resp.status, 200, resp.read())

        pending = json.loads((self.data_root / "pending-changes.json").read_text())
        self.assertEqual(len(pending["changes"]), 1)
        self.assertEqual(pending["changes"][0]["actionType"], "set_rect_transform")
        self.assertEqual(pending["changes"][0]["rect"]["anchoredX"], 12.5)

    def test_post_invalid_body_returns_400(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        conn.request("POST", "/api/pending-changes/rect", json.dumps({"bogus": True}),
                     {"Content-Type": "application/json"})
        resp = conn.getresponse()
        self.assertEqual(resp.status, 400)


if __name__ == "__main__":
    unittest.main()
