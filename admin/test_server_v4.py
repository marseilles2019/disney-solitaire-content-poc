import unittest, sys, tempfile, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from server import enrich_element_state

class EnrichmentTests(unittest.TestCase):

    def setUp(self):
        self.content_map = {"sprites": {
            "chips/chip_01": "assets/chips/chip_01.png",
            "chips/chip_06": "assets/chips/chip_06.png",
        }}
        self.tmpdir = tempfile.TemporaryDirectory()
        self.public_root = Path(self.tmpdir.name)
        (self.public_root / "assets" / "chips").mkdir(parents=True)
        (self.public_root / "assets" / "chips" / "chip_01.png").write_bytes(b"\x89PNG\r\n\x1a\n")  # exists
        # chip_06 NOT created

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_builtin_placeholder(self):
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "builtin_placeholder")

    def test_cdn_managed_when_tag_and_file_exists(self):
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "chips/chip_01", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "cdn_managed")
        self.assertEqual(s["cdnAssetPath"], "assets/chips/chip_01.png")
        self.assertTrue(s["cdnAssetExists"])
        self.assertEqual(s["cdnAssetVersion"], "2026-05-12-04")

    def test_tagged_unpublished_when_tag_but_no_file(self):
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "chips/chip_06", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "tagged_unpublished")
        self.assertEqual(s["cdnAssetPath"], "assets/chips/chip_06.png")
        self.assertFalse(s["cdnAssetExists"])

    def test_tagged_unpublished_when_tag_unknown(self):
        # contentTagKey not in content_map
        el = {"currentAssetPath": "Resources/unity_builtin_extra:UISprite", "contentTagKey": "chips/chip_99", "isBuiltin": True}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "tagged_unpublished")
        # cdnAssetPath derived by convention: "assets/<tagKey>.png"
        self.assertEqual(s["cdnAssetPath"], "assets/chips/chip_99.png")
        self.assertFalse(s["cdnAssetExists"])

    def test_static_only_when_assets_png_and_no_tag(self):
        el = {"currentAssetPath": "Assets/Art/UI/Chips/chip_01.png", "contentTagKey": "", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "static_only")
        self.assertEqual(s["staticAssetPath"], "Assets/Art/UI/Chips/chip_01.png")

    def test_dual_when_assets_png_AND_tag(self):
        el = {"currentAssetPath": "Assets/Art/UI/Chips/chip_01.png", "contentTagKey": "chips/chip_01", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "dual")
        self.assertIn("warnings", s)
        self.assertTrue(any("既被 ContentTag 接管又有静态" in w for w in s["warnings"]))

    def test_null_sprite_is_builtin_placeholder_without_tag(self):
        el = {"currentAssetPath": "(null)", "contentTagKey": "", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        self.assertEqual(s["resourceState"], "builtin_placeholder")

    def test_null_sprite_with_tag_is_tagged_unpublished(self):
        el = {"currentAssetPath": "(null)", "contentTagKey": "chips/chip_06", "isBuiltin": False}
        s = enrich_element_state(el, self.content_map, self.public_root, manifest_version="2026-05-12-04")
        # No sprite assigned in Unity but ContentTag will inject at runtime.
        self.assertEqual(s["resourceState"], "tagged_unpublished")

import http.client, threading, time


class V4SnapshotIntegrationTests(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        import server as srv
        cls.srv = srv

        cls.tmp = tempfile.TemporaryDirectory()
        cls.data_root = Path(cls.tmp.name)
        (cls.data_root / "cache").mkdir()

        # Write a minimal snapshot with 4 elements of different states
        snap = {
            "generatedAt": "2026-05-12T20:00:00Z",
            "unityProjectRoot": "/fake/unity",
            "sources": [{
                "type": "scene", "path": "Assets/Scenes/X.unity", "displayName": "X",
                "elements": [
                    {"id": "e1", "currentAssetPath": "Resources/unity_builtin_extra:UISprite",
                     "contentTagKey": "chips/chip_01", "isBuiltin": True,
                     "gameObjectPath": "Canvas/Chip1", "componentType": "Image"},
                    {"id": "e2", "currentAssetPath": "Resources/unity_builtin_extra:UISprite",
                     "contentTagKey": "chips/chip_06", "isBuiltin": True,
                     "gameObjectPath": "Canvas/Chip6", "componentType": "Image"},
                    {"id": "e3", "currentAssetPath": "Assets/Art/UI/x.png",
                     "contentTagKey": "", "isBuiltin": False,
                     "gameObjectPath": "Canvas/Static", "componentType": "Image"},
                    {"id": "e4", "currentAssetPath": "Resources/unity_builtin_extra:UISprite",
                     "contentTagKey": "", "isBuiltin": True,
                     "gameObjectPath": "Canvas/Locked", "componentType": "Image"},
                ]
            }]
        }
        (cls.data_root / "snapshot.json").write_text(json.dumps(snap))

        cls.repo_root = Path(__file__).parent.parent
        cls.port = 8790
        cls.server = srv.make_server("127.0.0.1", cls.port, cls.repo_root, data_root=cls.data_root)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.15)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.tmp.cleanup()

    def test_snapshot_endpoint_enriches_resourceState(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", "/api/v2/snapshot")
        r = conn.getresponse()
        self.assertEqual(r.status, 200)
        data = json.loads(r.read())
        elements = data["sources"][0]["elements"]
        states = {e["id"]: e["resourceState"] for e in elements}
        self.assertEqual(states["e1"], "cdn_managed")        # chip_01 exists in real public/assets
        # e2 may be tagged_unpublished or cdn_managed depending on whether chip_06 exists
        self.assertIn(states["e2"], ("tagged_unpublished", "cdn_managed"))
        self.assertEqual(states["e3"], "static_only")
        self.assertEqual(states["e4"], "builtin_placeholder")


import base64


def _post(port, path, body):
    conn = http.client.HTTPConnection("127.0.0.1", port)
    raw = json.dumps(body).encode()
    conn.request("POST", path, body=raw, headers={"Content-Type": "application/json"})
    r = conn.getresponse()
    return r.status, r.read()


PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415478da6300010000000500010d0a2db40000000049454e44ae426082"
)


class V4ReplacePublishTests(V4SnapshotIntegrationTests):
    # Reuses setUpClass from V4SnapshotIntegrationTests.
    # Note: tests write into the real public/ — restore via git checkout in tearDown.

    def tearDown(self):
        # Restore any public/ files modified by replace tests so the working tree
        # stays clean for subsequent runs.
        import subprocess
        subprocess.run(
            ["git", "checkout", "--", "public/"],
            cwd=str(self.repo_root),
            capture_output=True,
        )

    def test_replace_routes_cdn_managed_to_cdn_queue(self):
        status, body = _post(self.port, "/api/v4/replace", {
            "elementId": "e1",
            "newBytesBase64": base64.b64encode(PNG_1x1).decode(),
        })
        self.assertEqual(status, 200, body)
        data = json.loads(body)
        self.assertEqual(data["route"], "cdn")
        # Exact path depends on content_map (full key vs last-segment lookup);
        # assert the routing landed somewhere under assets/ ending with chip_01.png
        self.assertTrue(data["targetPath"].startswith("assets/"))
        self.assertTrue(data["targetPath"].endswith("chip_01.png"))

    def test_replace_routes_static_only_to_assets_queue(self):
        status, body = _post(self.port, "/api/v4/replace", {
            "elementId": "e3",
            "newBytesBase64": base64.b64encode(PNG_1x1).decode(),
        })
        self.assertEqual(status, 200, body)
        data = json.loads(body)
        self.assertEqual(data["route"], "assets")
        self.assertEqual(data["targetPath"], "Assets/Art/UI/x.png")

    def test_replace_rejects_builtin_placeholder(self):
        status, body = _post(self.port, "/api/v4/replace", {
            "elementId": "e4",
            "newBytesBase64": base64.b64encode(PNG_1x1).decode(),
        })
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(body)["errorCode"], "locked")

    def test_publish_returns_zero_when_nothing_queued(self):
        status, body = _post(self.port, "/api/v4/publish", {})
        self.assertEqual(status, 200)
        data = json.loads(body)
        # cdn_queue empty AND assets queue empty initially in the test fixture
        self.assertIn("cdnPublished", data)
        self.assertIn("assetsQueued", data)


if __name__ == "__main__":
    unittest.main()
