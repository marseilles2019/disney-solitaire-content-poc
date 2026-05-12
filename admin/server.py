"""Disney Solitaire Content Admin — local-only HTTP server + git proxy.

Stdlib-only Python 3. Run:
    python3 server.py
Then browse http://127.0.0.1:8767/admin/

Env vars:
- CONTENT_ADMIN_DRY_RUN=1  → publish skips actual git commit + push (for tests)
- CONTENT_ADMIN_PORT       → override default 8767
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Tuple

# ────────────────────────────────────────────────────────────────────────────
# Constants

DEFAULT_PORT = 8767
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".ogg", ".wav", ".json"}
ADMIN_DIR_NAME = "admin"
PUBLIC_DIR_NAME = "public"


# ────────────────────────────────────────────────────────────────────────────
# Repo conventions

def detect_repo_root(start: Path) -> Path:
    """Walk up until we find a dir that has admin/ + public/ siblings."""
    cur = start.resolve()
    while cur != cur.parent:
        if (cur / ADMIN_DIR_NAME).is_dir() and (cur / PUBLIC_DIR_NAME).is_dir():
            return cur
        cur = cur.parent
    raise RuntimeError(f"Cannot find content repo root from {start}")


# ────────────────────────────────────────────────────────────────────────────
# Path validation

def safe_asset_path(repo_root: Path, target: str) -> Path:
    """Validate `target` is inside `public/assets/`. Return absolute Path.

    Raises ValueError on bad input.
    """
    if not target.startswith("assets/"):
        raise ValueError("invalid_path: must start with assets/")
    if ".." in target.split("/"):
        raise ValueError("invalid_path: directory traversal forbidden")
    full = (repo_root / PUBLIC_DIR_NAME / target).resolve()
    public_root = (repo_root / PUBLIC_DIR_NAME).resolve()
    if public_root not in full.parents and full != public_root:
        raise ValueError("invalid_path: outside public/")
    ext = full.suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError("invalid_extension")
    return full


# ────────────────────────────────────────────────────────────────────────────
# Git ops

def run_git(repo_root: Path, *args: str) -> Tuple[int, str, str]:
    """Run git command; return (returncode, stdout, stderr)."""
    proc = subprocess.run(
        ["git", *args],
        cwd=str(repo_root),
        capture_output=True,
        text=True,
        timeout=30,
    )
    return proc.returncode, proc.stdout, proc.stderr


def git_status_snapshot(repo_root: Path) -> dict:
    """Return concise status: branch, ahead/behind, dirty file list, last commit."""
    code, branch_out, _ = run_git(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    branch = branch_out.strip() if code == 0 else "<unknown>"

    code, porcelain, _ = run_git(repo_root, "status", "--porcelain")
    dirty_files = [line[3:] for line in porcelain.splitlines() if line]

    code, last, _ = run_git(repo_root, "log", "-1", "--format=%h %s")
    last_commit = last.strip() if code == 0 else "<empty>"

    code, rev_list, _ = run_git(repo_root, "rev-list", "--left-right", "--count", "@{u}...HEAD")
    if code == 0 and rev_list.strip():
        parts = rev_list.strip().split()
        behind, ahead = int(parts[0]), int(parts[1])
    else:
        behind, ahead = 0, 0

    return {
        "branch": branch,
        "ahead": ahead,
        "behind": behind,
        "dirtyFiles": dirty_files,
        "lastCommit": last_commit,
    }


def bump_manifest_version(manifest_path: Path) -> str:
    """Set manifest.version to YYYY-MM-DD-NN where NN auto-increments same-day.

    Returns the new version string.
    """
    manifest = json.loads(manifest_path.read_text())
    today = datetime.now().strftime("%Y-%m-%d")
    existing = manifest.get("version", "")
    if existing.startswith(today + "-"):
        try:
            n = int(existing.rsplit("-", 1)[-1]) + 1
        except ValueError:
            n = 1
    else:
        n = 1
    new_version = f"{today}-{n:02d}"
    manifest["version"] = new_version
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    return new_version


# ────────────────────────────────────────────────────────────────────────────
# HTTP handler

class AdminHandler(BaseHTTPRequestHandler):
    repo_root: Path  # set on subclass

    # ── helpers ─────────────────────────────────────────────────────────

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status: int, error: str, errorCode: str) -> None:
        self.send_json(status, {"ok": False, "error": error, "errorCode": errorCode})

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_UPLOAD_BYTES * 2:  # base64 inflates ~33%
            raise ValueError("size_too_large")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def log_message(self, format, *args):
        # quieter log; remove default per-request line spam
        sys.stderr.write("[admin] " + format % args + "\n")

    # ── GET ─────────────────────────────────────────────────────────────

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.handle_api_get()
        if self.path == "/" or self.path == "":
            self.send_response(302)
            self.send_header("Location", "/admin/")
            self.end_headers()
            return
        if self.path.startswith("/admin/") or self.path == "/admin":
            return self.serve_admin_static()
        self.send_error(404, "Not found")

    def handle_api_get(self):
        path = self.path
        if path == "/api/manifest":
            return self.serve_manifest()
        if path == "/api/content-map":
            return self.serve_content_map()
        if path.startswith("/api/media-file?"):
            return self.serve_media_file()
        if path.startswith("/api/media"):
            return self.serve_media_list()
        if path == "/api/status":
            return self.serve_status()
        self.send_error(404, "API not found")

    def serve_manifest(self):
        p = self.repo_root / PUBLIC_DIR_NAME / "manifest.json"
        if not p.exists():
            return self.send_error_json(404, "manifest.json missing", "missing_file")
        try:
            data = json.loads(p.read_text())
        except json.JSONDecodeError as e:
            return self.send_error_json(500, f"manifest.json invalid: {e}", "invalid_json")
        return self.send_json(200, data)

    def serve_content_map(self):
        p = self.repo_root / PUBLIC_DIR_NAME / "content_map.json"
        if not p.exists():
            return self.send_error_json(404, "content_map.json missing", "missing_file")
        return self.send_json(200, json.loads(p.read_text()))

    def serve_media_list(self):
        # /api/media?dir=assets/chips
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)
        d = params.get("dir", "assets")
        try:
            root = safe_asset_path(self.repo_root, d + "/dummy.png").parent
        except ValueError as e:
            # special-case the dir-only form (e.g. asset listing root)
            cand = (self.repo_root / PUBLIC_DIR_NAME / d).resolve()
            public_root = (self.repo_root / PUBLIC_DIR_NAME).resolve()
            if public_root not in cand.parents and cand != public_root:
                return self.send_error_json(400, str(e), "invalid_path")
            root = cand
        if not root.exists() or not root.is_dir():
            return self.send_json(200, {"files": []})
        entries = []
        for f in sorted(root.iterdir()):
            if f.is_file() and f.suffix.lower() in ALLOWED_EXTENSIONS:
                rel = f.relative_to(self.repo_root / PUBLIC_DIR_NAME).as_posix()
                entries.append({
                    "path": rel,
                    "size": f.stat().st_size,
                    "mtime": int(f.stat().st_mtime),
                })
        return self.send_json(200, {"files": entries})

    def serve_media_file(self):
        # /api/media-file?path=assets/chips/chip_01.png
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = dict(p.split("=", 1) for p in qs.split("&") if "=" in p)
        p = params.get("path", "")
        try:
            full = safe_asset_path(self.repo_root, p)
        except ValueError as e:
            return self.send_error_json(400, str(e), "invalid_path")
        if not full.exists():
            return self.send_error(404, "Not found")
        ext = full.suffix.lower()
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                ".ogg": "audio/ogg", ".wav": "audio/wav", ".json": "application/json"}.get(ext, "application/octet-stream")
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_status(self):
        return self.send_json(200, git_status_snapshot(self.repo_root))

    def serve_admin_static(self):
        sub = self.path[len("/admin"):].lstrip("/")
        if not sub:
            sub = "index.html"
        # block ..
        if ".." in sub.split("/"):
            return self.send_error(400, "Invalid path")
        full = (self.repo_root / ADMIN_DIR_NAME / sub).resolve()
        admin_root = (self.repo_root / ADMIN_DIR_NAME).resolve()
        if admin_root not in full.parents and full != admin_root / "index.html":
            return self.send_error(400, "Invalid path")
        if not full.exists() or full.is_dir():
            return self.send_error(404, f"Not found: {sub}")
        ext = full.suffix.lower()
        mime = {".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".md": "text/plain; charset=utf-8"}.get(ext, "application/octet-stream")
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ── POST ────────────────────────────────────────────────────────────

    def do_POST(self):
        if self.path == "/api/upload":
            return self.handle_upload()
        if self.path == "/api/save-manifest":
            return self.handle_save_manifest()
        if self.path == "/api/save-content-map":
            return self.handle_save_content_map()
        if self.path == "/api/publish":
            return self.handle_publish()
        self.send_error(404, "API not found")

    def handle_upload(self):
        try:
            body = self.read_json_body()
        except ValueError as e:
            return self.send_error_json(413, str(e), "size_too_large")
        target = body.get("targetPath", "")
        b64 = body.get("bytesBase64", "")
        try:
            full = safe_asset_path(self.repo_root, target)
        except ValueError as e:
            msg = str(e)
            code = "invalid_extension" if "extension" in msg else "invalid_path"
            return self.send_error_json(400, msg, code)
        try:
            data = base64.b64decode(b64)
        except Exception as e:
            return self.send_error_json(400, f"base64 decode: {e}", "invalid_base64")
        if len(data) > MAX_UPLOAD_BYTES:
            return self.send_error_json(413, "exceeds 10 MB", "size_too_large")
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_bytes(data)
        return self.send_json(200, {"ok": True, "sizeBytes": len(data)})

    def handle_save_manifest(self):
        body = self.read_json_body()
        p = self.repo_root / PUBLIC_DIR_NAME / "manifest.json"
        p.write_text(json.dumps(body, indent=2) + "\n")
        return self.send_json(200, {"ok": True})

    def handle_save_content_map(self):
        body = self.read_json_body()
        p = self.repo_root / PUBLIC_DIR_NAME / "content_map.json"
        p.write_text(json.dumps(body, indent=2) + "\n")
        return self.send_json(200, {"ok": True})

    def handle_publish(self):
        body = self.read_json_body()
        commit_msg = body.get("commitMessage", "art: update via admin").strip()
        bump = bool(body.get("bumpVersion", True))

        new_version = None
        if bump:
            manifest_path = self.repo_root / PUBLIC_DIR_NAME / "manifest.json"
            new_version = bump_manifest_version(manifest_path)

        if os.environ.get("CONTENT_ADMIN_DRY_RUN") == "1":
            # Skip git ops (test mode)
            return self.send_json(200, {
                "ok": True,
                "newCommit": "<dry-run>",
                "newVersion": new_version or "<unchanged>",
            })

        # git add public/
        code, _, err = run_git(self.repo_root, "add", "public/")
        if code != 0:
            return self.send_error_json(500, f"git add: {err}", "git_add_failed")
        # commit (allow empty? no -- if nothing changed return ok early)
        code, _, _ = run_git(self.repo_root, "diff", "--cached", "--quiet")
        if code == 0:
            # No staged changes
            return self.send_json(200, {
                "ok": True,
                "newCommit": "<no-op>",
                "newVersion": new_version or "<unchanged>",
                "noChanges": True,
            })
        code, _, err = run_git(self.repo_root, "commit", "-m", commit_msg)
        if code != 0:
            return self.send_error_json(500, f"git commit: {err}", "git_commit_failed")
        code, _, err = run_git(self.repo_root, "push", "origin", "main")
        if code != 0:
            return self.send_error_json(500, f"git push: {err}", "git_push_failed")
        # New commit hash
        _, hash_out, _ = run_git(self.repo_root, "rev-parse", "HEAD")
        return self.send_json(200, {
            "ok": True,
            "newCommit": hash_out.strip(),
            "newVersion": new_version or "<unchanged>",
        })


# ────────────────────────────────────────────────────────────────────────────
# Server factory + entrypoint

def make_server(host: str, port: int, repo_root: Path) -> ThreadingHTTPServer:
    # Create handler subclass with bound repo_root (class-level attribute)
    handler_cls = type("BoundAdminHandler", (AdminHandler,), {"repo_root": repo_root})
    return ThreadingHTTPServer((host, port), handler_cls)


def main():
    repo_root = detect_repo_root(Path(__file__).parent)
    port = int(os.environ.get("CONTENT_ADMIN_PORT", DEFAULT_PORT))
    host = "127.0.0.1"
    server = make_server(host, port, repo_root)
    url = f"http://{host}:{port}/admin/"
    print(f"[admin] serving {repo_root}/admin at {url}")
    print(f"[admin] repo: {repo_root}")
    print(f"[admin] Ctrl-C to stop")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[admin] shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
