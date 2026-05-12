"""Backend tests for server.py v2 endpoints — stdlib unittest only.

v2 = Unity design-time asset editor: admin/data/ exchange with Unity Editor.
Distinct from v1 (CDN runtime hot-reload) — v1 tests live in test_server.py.
"""

import base64
import http.client
import json
import re
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))


PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009077"
    "53de0000000c4944415478da6300010000000500010d0a2db40000000049454e44ae426082"
)


class V2ServerTestBase(unittest.TestCase):
    """Each test gets its own tmp data_root + fresh server on a free port."""

    port_counter = 8780  # avoid 8767 (prod) and 8768 (v1 tests)

    def setUp(self):
        import server as srv
        self.srv = srv

        self.tmp = tempfile.TemporaryDirectory()
        self.data_root = Path(self.tmp.name)
        (self.data_root / "cache").mkdir()

        self.repo_root = Path(__file__).parent.parent

        V2ServerTestBase.port_counter += 1
        self.port = V2ServerTestBase.port_counter

        self.server = srv.make_server(
            host="127.0.0.1",
            port=self.port,
            repo_root=self.repo_root,
            data_root=self.data_root,
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        time.sleep(0.1)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", path)
        resp = conn.getresponse()
        return resp.status, resp.read(), dict(resp.getheaders())

    def post(self, path, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        body_bytes = json.dumps(body).encode("utf-8")
        conn.request("POST", path, body=body_bytes,
                     headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        return resp.status, resp.read()

    def write_snapshot(self, payload):
        (self.data_root / "snapshot.json").write_text(json.dumps(payload))


class V2Tests(V2ServerTestBase):

    def test_v2_snapshot_returns_404_when_missing(self):
        status, body, _ = self.get("/api/v2/snapshot")
        self.assertEqual(status, 404)
        data = json.loads(body)
        self.assertFalse(data["ok"])
        self.assertEqual(data["errorCode"], "missing_snapshot")

    def test_v2_snapshot_returns_data_when_present(self):
        payload = {
            "generatedAt": "2026-05-12T20:00:00Z",
            "unityProjectRoot": "/tmp/fake-unity",
            "sources": [{"type": "scene", "path": "Assets/Scenes/X.unity",
                         "displayName": "X", "elements": []}],
        }
        self.write_snapshot(payload)
        status, body, _ = self.get("/api/v2/snapshot")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["generatedAt"], "2026-05-12T20:00:00Z")
        self.assertEqual(len(data["sources"]), 1)

    def test_v2_queue_changes_writes_to_json(self):
        change = {
            "id": "abc:123",
            "actionType": "replace_asset",
            "targetAssetPath": "Assets/Art/UI/Chips/chip_01.png",
            "newBytesBase64": base64.b64encode(PNG_1x1).decode(),
        }
        status, body = self.post("/api/v2/queue-changes", {"changes": [change]})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["queuedCount"], 1)

        on_disk = json.loads((self.data_root / "pending-changes.json").read_text())
        self.assertEqual(len(on_disk["changes"]), 1)
        self.assertEqual(on_disk["changes"][0]["targetAssetPath"],
                         "Assets/Art/UI/Chips/chip_01.png")

    def test_v2_queue_changes_rejects_unsafe_target_path(self):
        # outside Assets/Art/ → must reject
        bad = {
            "id": "x:1",
            "actionType": "replace_asset",
            "targetAssetPath": "Assets/Scenes/HomeMap.uGUI.unity",
            "newBytesBase64": base64.b64encode(PNG_1x1).decode(),
        }
        status, body = self.post("/api/v2/queue-changes", {"changes": [bad]})
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertEqual(data["errorCode"], "invalid_target")

        # traversal → must reject
        traversal = {
            "id": "x:2",
            "actionType": "replace_asset",
            "targetAssetPath": "Assets/Art/../../../etc/passwd.png",
            "newBytesBase64": base64.b64encode(PNG_1x1).decode(),
        }
        status, body = self.post("/api/v2/queue-changes", {"changes": [traversal]})
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["errorCode"], "invalid_target")

        # pending-changes.json must NOT have been written
        self.assertFalse((self.data_root / "pending-changes.json").exists())

    def test_v2_thumb_serves_png_or_404(self):
        guid_ok = "0123456789abcdef0123456789abcdef"
        (self.data_root / "cache" / f"{guid_ok}.png").write_bytes(PNG_1x1)

        status, body, headers = self.get(f"/api/v2/thumb?guid={guid_ok}")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(body, PNG_1x1)

        guid_missing = "deadbeefdeadbeefdeadbeefdeadbeef"
        status, _, _ = self.get(f"/api/v2/thumb?guid={guid_missing}")
        self.assertEqual(status, 404)

        # bad guid format → 400
        status, body, _ = self.get("/api/v2/thumb?guid=not-a-guid")
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(body)["errorCode"], "invalid_guid")

    def test_v2_clear_pending_empties_file(self):
        # Pre-populate
        (self.data_root / "pending-changes.json").write_text(json.dumps({
            "changes": [{"id": "x", "targetAssetPath": "Assets/Art/x.png",
                         "newBytesBase64": ""}]
        }))
        status, _ = self.post("/api/v2/clear-pending", {})
        self.assertEqual(status, 200)

        on_disk = json.loads((self.data_root / "pending-changes.json").read_text())
        self.assertEqual(on_disk["changes"], [])


if __name__ == "__main__":
    unittest.main()
