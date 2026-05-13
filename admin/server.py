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
import fcntl
import json
import math
import os
import re
import subprocess
import sys
import urllib.parse
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
V2_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
ADMIN_DIR_NAME = "admin"
PUBLIC_DIR_NAME = "public"
V2_DIR_NAME = "v2"            # admin/v2/ — frontend code
V3_DIR_NAME = "v3"            # admin/v3/ — v3 frontend (parallel to v2; same backend)
V2_DATA_DIR_NAME = "data"     # admin/data/ — Unity ↔ admin exchange
V2_TARGET_PATH_PREFIX = "Assets/Art/"  # write-only allowed prefix in Unity project


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
# Pending-changes helpers


def upsert_pending_change(doc, change):
    """Replace any existing change matching (id, actionType); else append.

    Mutates `doc` in place. Returns the same doc for convenience.
    """
    el_id = change.get("id")
    a_type = change.get("actionType")
    doc["changes"] = [
        c for c in doc.get("changes", [])
        if not (c.get("id") == el_id and c.get("actionType") == a_type)
    ]
    doc["changes"].append(change)
    return doc


def with_pending_changes_lock(pending_path, mutate_fn):
    """Atomic read-mutate-write of pending-changes.json under fcntl.flock.

    `mutate_fn(doc)` is called with the parsed dict and must return the dict
    to write. Creates the file (with empty changes list) if missing.
    """
    pending_path.parent.mkdir(parents=True, exist_ok=True)
    # Open for read+write, create if missing. Lock for the entire operation.
    with open(pending_path, "a+") as fh:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        try:
            fh.seek(0)
            raw = fh.read()
            try:
                doc = json.loads(raw) if raw.strip() else {"changes": []}
            except json.JSONDecodeError:
                doc = {"changes": []}
            doc = mutate_fn(doc)
            fh.seek(0)
            fh.truncate()
            fh.write(json.dumps(doc, indent=2) + "\n")
        finally:
            fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


def validate_rect_patch_body(body):
    """Return (ok: bool, error_message: str). Pure — no I/O."""
    if not isinstance(body, dict):
        return False, "body must be an object"
    if not body.get("id"):
        return False, "id is required"
    rect = body.get("rect")
    if not isinstance(rect, dict):
        return False, "rect is required"
    flag_value_pairs = [
        ("hasAnchoredX", "anchoredX"),
        ("hasAnchoredY", "anchoredY"),
        ("hasWidth",     "width"),
        ("hasHeight",    "height"),
    ]
    for flag, value in flag_value_pairs:
        if flag not in rect:
            return False, f"rect.{flag} missing"
        if value not in rect:
            return False, f"rect.{value} missing"
        v = rect[value]
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            return False, f"rect.{value} must be a number"
        if not math.isfinite(float(v)):
            return False, f"rect.{value} must be finite (no NaN/Inf)"
    if rect["width"] < 0:
        return False, "rect.width must be >= 0"
    if rect["height"] < 0:
        return False, "rect.height must be >= 0"
    return True, ""


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
# v4: Resource state enrichment

def enrich_element_state(element: dict, content_map: dict, public_root: Path, manifest_version: str) -> dict:
    """Compute resourceState + cdn/static asset details for one element.

    Returns a dict with keys: resourceState, cdnAssetPath?, cdnAssetExists?,
    cdnAssetVersion?, staticAssetPath?, staticAssetExists?, warnings?
    """
    tag = (element.get("contentTagKey") or "").strip()
    raw_path = element.get("currentAssetPath") or ""
    out: dict = {}

    # Resolve CDN side. ContentTag uses namespace/key (e.g. "chips/chip_01") but
    # content_map.sprites keys may be just the last segment ("chip_01"). Try full key
    # first, then last segment, then convention fallback.
    cdn_rel = None
    if tag:
        sprites = content_map.get("sprites", {}) or {}
        cdn_rel = sprites.get(tag)
        if not cdn_rel and "/" in tag:
            cdn_rel = sprites.get(tag.rsplit("/", 1)[-1])
        if not cdn_rel:
            cdn_rel = f"assets/{tag}.png"
        out["cdnAssetPath"] = cdn_rel
        cdn_full = (public_root / cdn_rel).resolve()
        out["cdnAssetExists"] = cdn_full.exists() and cdn_full.is_file()
        out["cdnAssetVersion"] = manifest_version

    # Resolve Assets side
    is_static_png = (
        raw_path.startswith("Assets/")
        and raw_path.lower().endswith((".png", ".jpg", ".jpeg"))
    )
    if is_static_png:
        out["staticAssetPath"] = raw_path
        # Note: Assets/ lives in Unity project (cross-repo). We can't always stat it
        # from this server. Trust the Exporter: if Unity wrote this path into snapshot,
        # the file exists at export time.
        out["staticAssetExists"] = True

    # State machine
    if tag and is_static_png:
        out["resourceState"] = "dual"
        out["warnings"] = [
            "该元素既被 ContentTag 接管又有静态 Assets/Art/ PNG · 运行时 ContentTag 优先 · 建议保持单一来源"
        ]
    elif tag:
        out["resourceState"] = "cdn_managed" if out["cdnAssetExists"] else "tagged_unpublished"
    elif is_static_png:
        out["resourceState"] = "static_only"
    else:
        out["resourceState"] = "builtin_placeholder"

    return out


# ────────────────────────────────────────────────────────────────────────────
# HTTP handler

class AdminHandler(BaseHTTPRequestHandler):
    repo_root: Path  # set on subclass
    data_root: Path  # set on subclass — admin/data/ for v2 (Unity exchange)

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

    def _write_path_prefix(self):
        """Read writePathPrefix from manifest at request time. Falls back to
        V2_TARGET_PATH_PREFIX constant if manifest missing/invalid."""
        try:
            m = json.loads((self.data_root / "manifest.json").read_text())
            return m.get("conventions", {}).get("writePathPrefix", V2_TARGET_PATH_PREFIX)
        except Exception:
            return V2_TARGET_PATH_PREFIX

    def log_message(self, format, *args):
        # quieter log; remove default per-request line spam
        sys.stderr.write("[admin] " + format % args + "\n")

    # ── GET ─────────────────────────────────────────────────────────────

    def do_GET(self):
        if self.path.startswith("/api/"):
            return self.handle_api_get()
        if self.path == "/" or self.path == "":
            self.send_response(302)
            self.send_header("Location", "/v3/")
            self.end_headers()
            return
        if self.path.startswith("/admin/") or self.path == "/admin":
            return self.serve_admin_static()
        if self.path.startswith("/v2/") or self.path == "/v2":
            return self.serve_v2_static()
        if self.path.startswith("/v3/") or self.path == "/v3":
            return self.serve_v3_static()
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
        if path == "/api/v2/snapshot":
            return self.serve_v2_snapshot()
        # v6.4: prefab-root thumbnails — must precede the broader /api/v2/thumb prefix below
        if path.startswith("/api/v2/thumbnail/"):
            return self.serve_v2_thumbnail()
        if path == "/api/v2/thumbnails-manifest":
            return self.serve_v2_thumbnails_manifest()
        if path.startswith("/api/v2/thumb"):
            return self.serve_v2_thumb()
        if path.startswith("/api/v2/asset"):
            return self.serve_v2_asset()
        if path == "/api/v2/last-applied":
            return self.serve_v2_last_applied()
        if path == "/api/v2/watch-state":
            return self.serve_v2_watch_state()
        if path == "/api/v2/manifest":
            return self.serve_v2_manifest()
        if path == "/api/v2/prefab-usage":
            return self.serve_v2_prefab_usage()
        if path == "/api/v6/sprite-atlas-membership":
            return self.serve_v6_atlas_membership()
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
        params = dict(urllib.parse.parse_qsl(qs))
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
        params = dict(urllib.parse.parse_qsl(qs))
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

    # ── v2: Unity design-time asset editor ─────────────────────────────

    def serve_v2_static(self):
        sub = self.path[len("/v2"):].lstrip("/").split("?", 1)[0]
        if not sub:
            sub = "index.html"
        if ".." in sub.split("/"):
            return self.send_error(400, "Invalid path")
        v2_root = (self.repo_root / ADMIN_DIR_NAME / V2_DIR_NAME).resolve()
        full = (v2_root / sub).resolve()
        if v2_root not in full.parents and full != v2_root:
            return self.send_error(400, "Invalid path")
        if not full.exists() or full.is_dir():
            return self.send_error(404, f"Not found: {sub}")
        ext = full.suffix.lower()
        mime = {".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".svg": "image/svg+xml"}.get(ext, "application/octet-stream")
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_v3_static(self):
        sub = self.path[len("/v3"):].lstrip("/").split("?", 1)[0]
        if not sub:
            sub = "index.html"
        if ".." in sub.split("/"):
            return self.send_error(400, "Invalid path")
        v3_root = (self.repo_root / ADMIN_DIR_NAME / V3_DIR_NAME).resolve()
        full = (v3_root / sub).resolve()
        if v3_root not in full.parents and full != v3_root:
            return self.send_error(400, "Invalid path")
        if not full.exists() or full.is_dir():
            return self.send_error(404, f"Not found: {sub}")
        ext = full.suffix.lower()
        mime = {".html": "text/html; charset=utf-8",
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".svg": "image/svg+xml"}.get(ext, "application/octet-stream")
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_v2_snapshot(self):
        p = self.data_root / "snapshot.json"
        if not p.exists():
            return self.send_error_json(
                404,
                "snapshot.json missing — run Unity: Tools/Solitaire/Content/Sync to Web Admin",
                "missing_snapshot")
        try:
            data = json.loads(p.read_text())
        except json.JSONDecodeError as e:
            return self.send_error_json(500, f"snapshot.json invalid: {e}", "invalid_json")

        # v4: enrich every element with resourceState + cdn/static metadata
        content_map = self._load_content_map_safely()
        manifest_version = self._load_manifest_version_safely()
        public_root = (self.repo_root / PUBLIC_DIR_NAME).resolve()
        for src in data.get("sources", []):
            for el in src.get("elements", []):
                try:
                    el.update(enrich_element_state(el, content_map, public_root, manifest_version))
                except Exception as e:
                    el["resourceState"] = "builtin_placeholder"
                    el["warnings"] = [f"enrichment failed: {e}"]

        return self.send_json(200, data)

    def _load_content_map_safely(self) -> dict:
        p = self.repo_root / PUBLIC_DIR_NAME / "content_map.json"
        if not p.exists():
            return {"sprites": {}}
        try:
            raw = json.loads(p.read_text())
        except json.JSONDecodeError:
            return {"sprites": {}}
        # Normalize: real content_map.json stores sprites as a list of
        # {"key", "path"} objects; enrich_element_state expects a dict {key: path}.
        sprites = raw.get("sprites")
        if isinstance(sprites, list):
            raw["sprites"] = {
                entry["key"]: entry["path"]
                for entry in sprites
                if isinstance(entry, dict) and "key" in entry and "path" in entry
            }
        elif not isinstance(sprites, dict):
            raw["sprites"] = {}
        return raw

    def _load_manifest_version_safely(self) -> str:
        p = self.repo_root / PUBLIC_DIR_NAME / "manifest.json"
        if not p.exists():
            return "<unknown>"
        try:
            return json.loads(p.read_text()).get("version", "<unknown>")
        except json.JSONDecodeError:
            return "<unknown>"

    def serve_v2_thumb(self):
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = dict(urllib.parse.parse_qsl(qs))
        guid = params.get("guid", "")
        if not re.fullmatch(r"[a-f0-9]{32}", guid):
            return self.send_error_json(400, "invalid guid", "invalid_guid")
        full = self.data_root / "cache" / f"{guid}.png"
        if not full.exists():
            return self.send_error(404, "Not found")
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_v2_thumbnail(self):
        # Prefab-root-level thumbnail; content-addressed, immutable cache.
        name = self.path[len("/api/v2/thumbnail/"):].split("?", 1)[0]
        if not re.fullmatch(r"[a-f0-9]{16}\.png", name):
            return self.send_error_json(400, "invalid filename", "invalid_name")
        full = self.data_root / "thumbnails" / name
        if not full.exists():
            return self.send_error(404, "Not found")
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.send_header("ETag", f'"{name}"')
        self.end_headers()
        self.wfile.write(data)

    def serve_v2_thumbnails_manifest(self):
        p = self.data_root / "thumbnails.json"
        if not p.exists():
            return self.send_json(200, {"thumbnails": {}})
        try:
            return self.send_json(200, json.loads(p.read_text()))
        except json.JSONDecodeError as e:
            return self.send_error_json(500, f"thumbnails.json invalid: {e}", "invalid_json")

    def serve_v2_asset(self):
        # Serve any PNG/JPG under <unityProjectRoot>/Assets/ — used as live preview
        # of the on-disk source (after Apply, this shows the updated bytes).
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = dict(urllib.parse.parse_qsl(qs))
        rel = params.get("path", "")
        if not rel.startswith("Assets/"):
            return self.send_error_json(400, "must start with Assets/", "invalid_path")
        if ".." in rel.split("/"):
            return self.send_error_json(400, "directory traversal forbidden", "invalid_path")
        ext = Path(rel).suffix.lower()
        if ext not in V2_IMAGE_EXTENSIONS:
            return self.send_error_json(400, "extension not allowed", "invalid_extension")

        snap_p = self.data_root / "snapshot.json"
        if not snap_p.exists():
            return self.send_error_json(404, "snapshot.json missing", "missing_snapshot")
        snap = json.loads(snap_p.read_text())
        unity_root_str = snap.get("unityProjectRoot", "")
        if not unity_root_str:
            return self.send_error_json(500, "unityProjectRoot missing in snapshot", "missing_unity_root")

        unity_root = Path(unity_root_str).resolve()
        full = (unity_root / rel).resolve()
        assets_root = (unity_root / "Assets").resolve()
        if assets_root not in full.parents and full != assets_root:
            return self.send_error_json(400, "outside Assets/", "invalid_path")
        if not full.exists():
            return self.send_error(404, "Not found")
        mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg"}[ext]
        data = full.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def serve_v2_last_applied(self):
        p = self.data_root / "last-applied.json"
        if not p.exists():
            return self.send_json(200, {})
        try:
            data = json.loads(p.read_text())
        except json.JSONDecodeError:
            return self.send_json(200, {})
        return self.send_json(200, data)

    def serve_v2_watch_state(self):
        p = self.data_root / "watch-state.json"
        if not p.exists():
            return self.send_json(200, {"watchMode": False})
        try:
            data = json.loads(p.read_text())
        except json.JSONDecodeError:
            return self.send_json(200, {"watchMode": False})
        return self.send_json(200, data)

    def serve_v2_manifest(self):
        """Project config from WebAdminConfig.asset (via ContentManifestExporter).
        Returns graceful empty fallback if no manifest yet (e.g., dev hasn't created
        a WebAdminConfig.asset)."""
        p = self.data_root / "manifest.json"
        if not p.exists():
            return self.send_json(200, {
                "projectName": "(no WebAdminConfig)",
                "projectIcon": "🎮",
                "worlds": [],
                "states": [],
                "components": [],
                "conventions": {
                    "writePathPrefix": V2_TARGET_PATH_PREFIX,
                    "modalRegex": "modal|overlay|popup|toast|dialog",
                    "cdnEnabled": True,
                    "cdnTargetPrefix": "assets/",
                },
            })
        try:
            return self.send_json(200, json.loads(p.read_text()))
        except json.JSONDecodeError as e:
            return self.send_error_json(500, f"manifest.json invalid: {e}", "invalid_json")

    def serve_v2_prefab_usage(self):
        """Prefab→scene usage map written by ContentSnapshotExporter. Empty fallback
        so frontend gracefully handles project where scan wasn't run yet."""
        p = self.data_root / "prefab-usage.json"
        if not p.exists():
            return self.send_json(200, {})
        try:
            return self.send_json(200, json.loads(p.read_text()))
        except json.JSONDecodeError:
            return self.send_json(200, {})

    def serve_v6_atlas_membership(self):
        """Returns the membership map written by Unity. Empty {} if no atlases / file missing."""
        p = self.data_root / "sprite-atlas-membership.json"
        if not p.exists():
            return self.send_json(200, {})
        try:
            return self.send_json(200, json.loads(p.read_text()))
        except json.JSONDecodeError as e:
            return self.send_error_json(500, f"sprite-atlas-membership.json invalid: {e}", "invalid_json")

    def handle_v2_queue_changes(self):
        body = self.read_json_body()
        changes = body.get("changes", [])
        if not isinstance(changes, list):
            return self.send_error_json(400, "changes must be array", "invalid_body")
        write_prefix = self._write_path_prefix()
        for c in changes:
            target = c.get("targetAssetPath", "")
            if not target.startswith(write_prefix):
                return self.send_error_json(
                    400,
                    f"targetAssetPath must start with {write_prefix} (got: {target!r})",
                    "invalid_target")
            if ".." in target.split("/"):
                return self.send_error_json(400, "directory traversal forbidden", "invalid_target")
            if Path(target).suffix.lower() not in V2_IMAGE_EXTENSIONS:
                return self.send_error_json(400, "extension not allowed", "invalid_extension")
            try:
                decoded = base64.b64decode(c.get("newBytesBase64", ""), validate=True)
            except Exception as e:
                return self.send_error_json(400, f"base64 decode: {e}", "invalid_base64")
            if len(decoded) > MAX_UPLOAD_BYTES:
                return self.send_error_json(413, "exceeds 10 MB", "size_too_large")
        # Overwrite pending — frontend sends the full desired pending set
        p = self.data_root / "pending-changes.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"changes": changes}, indent=2) + "\n")
        return self.send_json(200, {"ok": True, "queuedCount": len(changes)})

    def handle_v2_clear_pending(self):
        p = self.data_root / "pending-changes.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"changes": []}, indent=2) + "\n")
        return self.send_json(200, {"ok": True})

    def handle_force_repack_all(self):
        """Writes a flag file; ContentForceRepackMenu (Editor) picks it up and runs PackAllAtlases."""
        flag = self.data_root / "force-repack.flag"
        self.data_root.mkdir(parents=True, exist_ok=True)
        flag.write_text(datetime.utcnow().isoformat() + "Z\n")
        return self.send_json(200, {"ok": True, "flag": str(flag.name)})

    def handle_pending_changes_rect(self):
        """POST /api/pending-changes/rect — queue a set_rect_transform patch."""
        try:
            body = self.read_json_body()
        except ValueError as e:
            return self.send_error_json(413, str(e), "size_too_large")
        except Exception as e:
            return self.send_error_json(400, f"invalid JSON: {e}", "invalid_json")
        ok, err = validate_rect_patch_body(body)
        if not ok:
            return self.send_error_json(400, err, "invalid_rect_patch")
        change = {
            "id": body["id"],
            "actionType": "set_rect_transform",
            "rect": body["rect"],
        }
        pending_path = self.data_root / "pending-changes.json"
        with_pending_changes_lock(pending_path, lambda doc: upsert_pending_change(doc, change))
        return self.send_json(200, {"ok": True, "queued": change["id"]})

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
        if self.path == "/api/v2/queue-changes":
            return self.handle_v2_queue_changes()
        if self.path == "/api/v2/clear-pending":
            return self.handle_v2_clear_pending()
        if self.path == "/api/v4/replace":
            return self.handle_v4_replace()
        if self.path == "/api/v4/publish":
            return self.handle_v4_publish()
        if self.path == "/api/v6/force-repack-all":
            return self.handle_force_repack_all()
        if self.path == "/api/pending-changes/rect":
            return self.handle_pending_changes_rect()
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

    # ── v4: unified resource management ────────────────────────────────

    def handle_v4_replace(self):
        """Route a single element replace by computed state. CDN-managed/tagged_unpublished
        writes to public/assets/...; static_only appends to pending-changes.json."""
        body = self.read_json_body()
        element_id = body.get("elementId", "")
        bytes_b64 = body.get("newBytesBase64", "")
        preferred = body.get("preferredPath")  # "cdn" | "assets" | None

        # Look up element by scanning snapshot
        snap_p = self.data_root / "snapshot.json"
        if not snap_p.exists():
            return self.send_error_json(404, "snapshot missing", "missing_snapshot")
        snap = json.loads(snap_p.read_text())
        content_map = self._load_content_map_safely()
        manifest_version = self._load_manifest_version_safely()
        public_root = (self.repo_root / PUBLIC_DIR_NAME).resolve()

        el = None
        for src in snap.get("sources", []):
            for e in src.get("elements", []):
                if e.get("id") == element_id:
                    el = e
                    break
            if el:
                break
        if not el:
            return self.send_error_json(404, f"element {element_id!r} not found", "element_not_found")

        enrich = enrich_element_state(el, content_map, public_root, manifest_version)
        state = enrich["resourceState"]

        try:
            decoded = base64.b64decode(bytes_b64, validate=True)
        except Exception as e:
            return self.send_error_json(400, f"base64 decode: {e}", "invalid_base64")
        if len(decoded) > MAX_UPLOAD_BYTES:
            return self.send_error_json(413, "exceeds 10 MB", "size_too_large")

        if state == "builtin_placeholder":
            return self.send_error_json(403, "element is locked (builtin placeholder)", "locked")

        if state == "dual" and not preferred:
            return self.send_error_json(409, "dual state — preferredPath required (cdn | assets)", "dual_needs_preference")

        # Decide route
        route = preferred if state == "dual" else ("cdn" if state in ("cdn_managed", "tagged_unpublished") else "assets")

        if route == "cdn":
            cdn_rel = enrich.get("cdnAssetPath")
            if not cdn_rel:
                return self.send_error_json(500, "no cdnAssetPath resolved", "no_cdn_path")
            # Safety: must start with assets/
            if not cdn_rel.startswith("assets/") or ".." in cdn_rel.split("/"):
                return self.send_error_json(400, "unsafe cdn path", "invalid_target")
            target = (self.repo_root / PUBLIC_DIR_NAME / cdn_rel).resolve()
            public_resolved = (self.repo_root / PUBLIC_DIR_NAME).resolve()
            if public_resolved not in target.parents:
                return self.send_error_json(400, "outside public/", "invalid_target")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(decoded)
            return self.send_json(200, {"ok": True, "route": "cdn", "targetPath": cdn_rel, "sizeBytes": len(decoded)})

        if route == "assets":
            static_path = enrich.get("staticAssetPath")
            if not static_path:
                return self.send_error_json(500, "no staticAssetPath resolved", "no_static_path")
            write_prefix = self._write_path_prefix()
            if not static_path.startswith(write_prefix):
                return self.send_error_json(400, f"target must start with {write_prefix}", "invalid_target")
            if ".." in static_path.split("/"):
                return self.send_error_json(400, "directory traversal forbidden", "invalid_target")
            # Append to pending-changes.json (Unity will apply later via watch mode or manual menu)
            pending_path = self.data_root / "pending-changes.json"
            change = {
                "id": element_id,
                "actionType": "replace_asset",
                "targetAssetPath": static_path,
                "newBytesBase64": bytes_b64,
            }
            with_pending_changes_lock(pending_path, lambda doc: upsert_pending_change(doc, change))
            return self.send_json(200, {"ok": True, "route": "assets", "targetPath": static_path, "sizeBytes": len(decoded)})

        return self.send_error_json(500, f"unhandled route {route!r}", "internal")

    def handle_v4_publish(self):
        """Run CDN publish (bump manifest + git add + commit + push) if anything queued
        in public/assets/ since last commit. Assets queue: report count; Unity watch
        mode handles actual write."""
        # CDN: detect dirty in public/
        code, porcelain, _ = run_git(self.repo_root, "status", "--porcelain", "--", str(self.repo_root / PUBLIC_DIR_NAME))
        cdn_dirty = bool(porcelain.strip())

        # Assets: count pending
        pending_path = self.data_root / "pending-changes.json"
        assets_queued = 0
        if pending_path.exists():
            try:
                doc = json.loads(pending_path.read_text())
                assets_queued = len(doc.get("changes", []))
            except json.JSONDecodeError:
                pass

        result = {"cdnPublished": False, "cdnDirty": cdn_dirty, "assetsQueued": assets_queued}

        if cdn_dirty:
            if os.environ.get("CONTENT_ADMIN_DRY_RUN") == "1":
                new_version = bump_manifest_version(self.repo_root / PUBLIC_DIR_NAME / "manifest.json")
                result.update({"cdnPublished": True, "cdnNewCommit": "<dry-run>", "cdnNewVersion": new_version, "dryRun": True})
            else:
                new_version = bump_manifest_version(self.repo_root / PUBLIC_DIR_NAME / "manifest.json")
                code, _, err = run_git(self.repo_root, "add", "public/")
                if code != 0:
                    return self.send_error_json(500, f"git add: {err}", "git_add_failed")
                code, _, _ = run_git(self.repo_root, "diff", "--cached", "--quiet")
                if code == 0:
                    result.update({"cdnPublished": False, "cdnNewVersion": new_version, "noChanges": True})
                else:
                    code, _, err = run_git(self.repo_root, "commit", "-m", f"art: v4 publish · {new_version}")
                    if code != 0:
                        return self.send_error_json(500, f"git commit: {err}", "git_commit_failed")
                    code, _, err = run_git(self.repo_root, "push", "origin", "main")
                    if code != 0:
                        return self.send_error_json(500, f"git push: {err}", "git_push_failed")
                    _, hash_out, _ = run_git(self.repo_root, "rev-parse", "HEAD")
                    result.update({"cdnPublished": True, "cdnNewCommit": hash_out.strip(), "cdnNewVersion": new_version})

        return self.send_json(200, result)


# ────────────────────────────────────────────────────────────────────────────
# Server factory + entrypoint

def make_server(host: str, port: int, repo_root: Path,
                data_root: Path = None) -> ThreadingHTTPServer:
    if data_root is None:
        data_root = repo_root / ADMIN_DIR_NAME / V2_DATA_DIR_NAME
    handler_cls = type("BoundAdminHandler", (AdminHandler,), {
        "repo_root": repo_root,
        "data_root": data_root,
    })
    return ThreadingHTTPServer((host, port), handler_cls)


def main():
    repo_root = detect_repo_root(Path(__file__).parent)
    port = int(os.environ.get("CONTENT_ADMIN_PORT", DEFAULT_PORT))
    host = "127.0.0.1"
    server = make_server(host, port, repo_root)
    url = f"http://{host}:{port}/admin/"
    v2_url = f"http://{host}:{port}/v2/"
    print(f"[admin] serving {repo_root}/admin at {url}")
    print(f"[admin] v2 (Unity design-time editor) at {v2_url}")
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
