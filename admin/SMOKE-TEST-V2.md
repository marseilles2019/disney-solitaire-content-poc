# Content Web Admin v2 — Smoke Test (Unity Design-Time Asset Editor)

**Date**: 2026-05-12
**Tester**: Claude Code (agentic worker) + human visual sanity-check
**Spec**: `Solitaire/docs/superpowers/specs/2026-05-12-content-web-admin-v2-unity-design-time-design.md`
**v2 commits**: D-WebAdminV2-1 … D-WebAdminV2-6

This documents the end-to-end verification of v2 (Unity design-time asset editor).
v2 is a separate product from v1 (CDN runtime hot-reload) — see spec.

## Pre-state

- content-poc repo HEAD: `86e33fc` (D-WebAdminV2-4 = v2 frontend committed)
- Solitaire repo HEAD: `c4be7ba` (D-WebAdminV2-5 = Apply menu committed)
- Unity project: `/Volumes/ExtDrive/Works/unitypros/Solitaire/SolitaireUnity`
- Admin server: `python3 server.py` on port 8767
- admin/data/: gitignored runtime exchange dir (created by Unity Sync menu)

## v2 surface

| Layer | Component | Where |
|---|---|---|
| Unity Plugin | `ContentSnapshotExporter.cs` | `SolitaireUnity/Assets/Editor/ContentAudit/` |
| Unity Plugin | `ContentSyncToWebMenu.cs` | `SolitaireUnity/Assets/Editor/ContentAudit/` |
| Unity Plugin | `ContentApplyWebChangesMenu.cs` | `SolitaireUnity/Assets/Editor/ContentAudit/` |
| Unity Tests | `ContentSnapshotExporterTest.cs` | `SolitaireUnity/Assets/Scripts/Tests/EditMode/Content/` |
| Backend | `server.py` (v2 endpoints) | `admin/server.py` |
| Backend Tests | `test_server_v2.py` (6 unittests) | `admin/test_server_v2.py` |
| Frontend | `index.html` / `app.js` / `api.js` / `styles.css` | `admin/v2/` |

## Automated tests

| Suite | Count | Result | Evidence |
|---|---|---|---|
| `admin/test_server_v2.py` | 6/6 | ✅ PASS | `python3 -m unittest test_server_v2 -v` (~3.7s, see commit f93eac1) |
| `admin/test_server.py` (v1 regression) | 6/6 | ✅ PASS | post-v2 changes confirmed no regression |
| Unity EditMode `ContentSnapshotExporterTest` | 2/2 | ✅ PASS | run_tests job c9636cf0 — 0.66s |

## API smoke (curl-driven)

All v2 endpoints exercised against running `python3 server.py`:

| # | Endpoint | Method | Status | Evidence |
|---|---|---|---|---|
| 1 | `/api/v2/snapshot` | GET | ✅ 200 | 31 sources / 113 elements / 78KB JSON |
| 2 | `/api/v2/snapshot` (no snapshot.json) | GET | ✅ 404 | `errorCode=missing_snapshot` |
| 3 | `/v2/` (static) | GET | ✅ 200 | `index.html` served |
| 4 | `/api/v2/queue-changes` (valid `Assets/Art/...png`) | POST | ✅ 200 | `{ok:true, queuedCount:1}` + pending-changes.json written |
| 5 | `/api/v2/queue-changes` (unsafe path) | POST | ✅ 400 | `errorCode=invalid_target` — pending NOT touched |
| 6 | `/api/v2/queue-changes` (traversal) | POST | ✅ 400 | `errorCode=invalid_target` |
| 7 | `/api/v2/clear-pending` | POST | ✅ 200 | `pending-changes.json` emptied |
| 8 | `/api/v2/thumb?guid=<32-hex>` | GET | ✅ 200/404 | PNG bytes or 404 |
| 9 | `/api/v2/thumb?guid=invalid` | GET | ✅ 400 | `errorCode=invalid_guid` |
| 10 | `/api/v2/last-applied` | GET | ✅ 200 | `appliedAt / byUser / appliedChanges / details[]` |

## End-to-end flow verification

Verified by the agent via:
1. Unity `Tools/Solitaire/Content/Sync to Web Admin` (proxied via MCP `execute_code` →
   `ContentSnapshotExporter.Export()`): wrote 78KB snapshot.json with 31 sources / 113 elements.
2. Admin `/v2/` loaded in Playwright headless browser:
   - Sidebar shows 4 scenes + 27 prefabs ✅
   - Main panel shows 16 HomeMap.uGUI elements ✅
   - Element badges (Image / SpriteRenderer / RawImage) + ContentTag chips render ✅
   - read-only label shown for builtin `Resources/unity_builtin_extra:UISprite` ✅
   - Stats line `13 builtin / 0 replaceable / 15 v1-tagged` ✅
3. Simulated replaceable element + Save (Playwright `browser_evaluate`):
   - dirty row gets amber border ✅
   - sidebar shows dirty count badge ✅
   - "💾 全局保存 (1)" enables ✅
   - POST `/api/v2/queue-changes` writes correct schema to pending-changes.json ✅
   - Toast: "Queued 1 change(s). 回 Unity Editor → Tools/Solitaire/Content/Apply Web Changes." ✅
4. Triggered `ContentApplyWebChangesMenu.ApplyChanges()` via MCP `execute_code`:
   - `Assets/Art/UI/Test/test_v2_e2e.png` (68 bytes) written to disk ✅
   - Unity auto-generated `.meta` (TextureImporter) ✅
   - `last-applied.json`: `appliedChanges=1, byUser=Marseille, details=[{id, writtenTo, sizeBytes:68}]` ✅
5. Safety: tried unsafe paths through `ApplyChanges` directly:
   - `Assets/Scenes/HomeMap.uGUI.unity` → rejected ("unsafe path") · HomeMap scene NOT overwritten ✅
   - `Assets/Art/../Editor/evil.png` → rejected (traversal) · `Editor/evil.png` NOT created ✅
   - empty bytes → rejected ("empty bytes") ✅

## Visual UI verification (Playwright + human follow-up)

Agent-driven Playwright screenshots: `Solitaire/v2-initial.png`, `Solitaire/v2-after-save.png`.

The following remain for a human visual sanity check by opening
`http://127.0.0.1:8767/v2/`:

| # | Step | Expected | Status |
|---|---|---|---|
| V1 | Open `/v2/` | Dark theme + "Solitaire · Unity Editor" brand + "Web Admin v2 · design-time asset editor" subtitle | ✅ agent-verified |
| V2 | Sidebar | ▼ Scenes (4) + ▼ Prefabs (27) source-tree, click to switch | ✅ agent-verified |
| V3 | Main panel header | Source type badge (scene/prefab) + path + stats (elements / builtin / replaceable / v1-tagged) | ✅ agent-verified |
| V4 | Element card | thumbnail (PNG or colored placeholder) + component badge + ContentTag chip + GameObject path + asset path | ✅ agent-verified |
| V5 | Read-only element | Replace button hidden, shows "read-only · builtin asset (read-only)" or similar | ✅ agent-verified |
| V6 | Replaceable element → Replace button | File picker opens; pick PNG → element shows dirty (amber border) + "✓ queued · …" | ⏳ human (no replaceable PNG in current project — Phase 4 fully runtime-injected) |
| V7 | 全局保存 (N) | Button enables, click → POST queue-changes → toast + sidebar dirty count badge | ✅ agent-verified (synthetic element) |
| V8 | Refresh button | Re-fetches snapshot.json | ✅ agent-verified |
| V9 | After Unity Apply | last-applied poller catches new appliedAt → clears dirty + auto-refresh snapshot | ⏳ human (needs real Unity menu click) |

## Unity Editor menu verification

All 4 menus driven via Unity MCP `execute_code`. Dialog/folder-picker is modal
(non-headless), so for those menus the verification re-invokes the same
business path the menu uses and reconstructs the dialog text — the dialog
itself is a thin wrapper, not new logic. U2 is fire-and-forget so the actual
`ExecuteMenuItem` was triggered.

| # | Menu | Expected | Status |
|---|---|---|---|
| U1 | Tools/Solitaire/Content/Sync to Web Admin | Modal: "Sync ok · N sources · M elements · …ms" | ✅ agent-verified — dry-run produced `Sync ok · 31 sources · 113 elements · 402ms → /Users/saima/dev/disney-solitaire-content-poc/admin/data` |
| U2 | Tools/Solitaire/Content/Open Web Admin v2 | Opens browser to `http://127.0.0.1:8767/v2/` | ✅ agent-verified — `EditorApplication.ExecuteMenuItem` fired in earnest |
| U3 | Tools/Solitaire/Content/Configure Admin Data Root… | OpenFolderPanel + saves to EditorPrefs key `Solitaire.WebAdminV2.AdminDataRoot` | ✅ agent-verified — wrote probe via EditorPrefs.SetString → `GetAdminDataRoot()` returned probe → restored default |
| U4 | Tools/Solitaire/Content/Apply Web Changes (empty pending) | Modal: "Pending changes are empty." | ✅ agent-verified — File.Exists ✓ + JSON `changes=[]` detected → correct empty-state message |
| U5 | Tools/Solitaire/Content/Apply Web Changes (non-empty) | Confirm dialog "Apply N change(s) under Assets/Art/?" → Apply → result modal | ✅ agent-verified via `ApplyChanges()` direct call (D-WebAdminV2-5 commit) |

## Notes / known caveats

- **No real replaceable PNG in current Unity project**: Phase 4 made all UI fully
  runtime-injected via `ContentTag` + CDN. All 113 elements in snapshot are either
  `builtin` (UISprite color blocks) or `null` (no sprite assigned). v2 frontend's
  replace flow code is correct but cannot be exercised against the current project
  state — synthetic test element used instead. v2 becomes operationally useful once
  the project starts adding real PNG assets under `Assets/Art/`.
- **Thumbnail copy untested in current state**: `ContentSnapshotExporter` PNG bytes
  copy logic is correct (File.Copy when ext in {.png, .jpg, .jpeg}) but the current
  project produces 0 thumbnail cache entries (all sources have `thumbnailGuid=""` due
  to builtin sprites). Sprite atlas / runtime texture fallback paths likewise
  untested. EditMode test passes anyway since it asserts schema, not thumbnails.
- **Cross-repo dependency**: Unity Editor must write to `~/dev/disney-solitaire-content-poc/admin/data/`.
  Default path hardcoded in `ContentSnapshotExporter.DefaultAdminDataRoot()`,
  overridable via EditorPrefs key `Solitaire.WebAdminV2.AdminDataRoot`.
