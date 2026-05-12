"""Backend tests for content admin server.py — stdlib unittest only."""

import unittest
import threading
import urllib.request
import urllib.error
import json
import base64
import http.client
import time
import os
import sys
from pathlib import Path

# Allow importing server.py from same dir
sys.path.insert(0, str(Path(__file__).parent))


class ServerTestBase(unittest.TestCase):
    """Boots server on free port for each test; tears down cleanly."""

    @classmethod
    def setUpClass(cls):
        import server as srv
        cls.srv_module = srv
        cls.port = 8768  # avoid 8767 prod default
        cls.repo_root = Path(__file__).parent.parent  # admin/.. = content repo
        cls.server = srv.make_server(host="127.0.0.1", port=cls.port, repo_root=cls.repo_root)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.2)  # let server bind

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        conn.request("GET", path)
        resp = conn.getresponse()
        return resp.status, resp.read()

    def post(self, path, body):
        conn = http.client.HTTPConnection("127.0.0.1", self.port)
        body_bytes = json.dumps(body).encode("utf-8")
        conn.request("POST", path, body=body_bytes,
                     headers={"Content-Type": "application/json"})
        resp = conn.getresponse()
        return resp.status, resp.read()


class ServerTests(ServerTestBase):

    def test_get_manifest_returns_current(self):
        status, body = self.get("/api/manifest")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertIn("version", data)
        self.assertIn("content_map", data)

    def test_upload_rejects_path_traversal(self):
        status, body = self.post("/api/upload", {
            "targetPath": "../etc/passwd",
            "bytesBase64": base64.b64encode(b"x").decode(),
        })
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertFalse(data["ok"])
        self.assertEqual(data.get("errorCode"), "invalid_path")

    def test_upload_rejects_path_outside_assets(self):
        status, body = self.post("/api/upload", {
            "targetPath": "manifest.json",  # not under assets/
            "bytesBase64": base64.b64encode(b"x").decode(),
        })
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertEqual(data.get("errorCode"), "invalid_path")

    def test_upload_rejects_bad_extension(self):
        status, body = self.post("/api/upload", {
            "targetPath": "assets/bad.exe",
            "bytesBase64": base64.b64encode(b"x").decode(),
        })
        self.assertEqual(status, 400)
        data = json.loads(body)
        self.assertEqual(data.get("errorCode"), "invalid_extension")

    def test_upload_size_cap_10mb(self):
        # 11 MB blob -- base64 encoded ~ 14.7 MB string
        big = b"\x00" * (11 * 1024 * 1024)
        status, body = self.post("/api/upload", {
            "targetPath": "assets/big.png",
            "bytesBase64": base64.b64encode(big).decode(),
        })
        self.assertEqual(status, 413)
        data = json.loads(body)
        self.assertEqual(data.get("errorCode"), "size_too_large")

    def test_publish_bumps_version_format(self):
        # Read current version
        _, body = self.get("/api/manifest")
        before = json.loads(body)["version"]

        # Stub the git steps via env var so test doesn't actually push
        os.environ["CONTENT_ADMIN_DRY_RUN"] = "1"
        try:
            status, body = self.post("/api/publish", {
                "commitMessage": "test publish",
                "bumpVersion": True,
            })
        finally:
            os.environ.pop("CONTENT_ADMIN_DRY_RUN", None)

        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertTrue(data["ok"])
        # newVersion format: YYYY-MM-DD-NN
        import re
        self.assertRegex(data["newVersion"], r"^\d{4}-\d{2}-\d{2}-\d{2}$")
        # Manifest should have been updated
        _, body2 = self.get("/api/manifest")
        after = json.loads(body2)["version"]
        self.assertNotEqual(before, after)
        self.assertEqual(after, data["newVersion"])


if __name__ == "__main__":
    unittest.main()
