# Content Web Admin v3 — Smoke Test (4-Pane Cascade + Layout View)

**Date**: 2026-05-12
**Tester**: Claude Code (agentic worker) + human visual sanity-check
**Spec**: `Solitaire/docs/superpowers/specs/2026-05-12-content-web-admin-v2-unity-design-time-design.md`
**Plan**: `Solitaire/docs/superpowers/plans/2026-05-12-content-web-admin-v3-layout-view.md`
**Predecessor**: v2 SMOKE @ `badbd64` (D-WebAdminV2-6c — Unity menu U1-U5 fully agent-verified)
**v3 commits**: D-WebAdminV3-1 … D-WebAdminV3-11

This documents the end-to-end verification of v3 (4-pane cascade + Layout pane +
drag-to-replace + batch review with matcher chain + optimistic dirty preview +
last-applied poller).

## What v3 ships

- **4-pane cascade**: Sources (left) → Layout + List (middle, stacked) → Detail (right). Selection cascades downstream; upstream panes never re-layout on detail edits.
- **Layout pane**: Canvas viewport renders Unity UI elements at their real `RectTransform` positions and sizes — the source-of-truth visual approximation of the in-Editor scene/prefab.
- **Drag PNG to Detail** → drop-confirm card → "Apply" queues a single change to `pending-changes.json`.
- **Drag folder to List** → Batch Review modal opens, runs the matcher chain across all dropped files, shows per-row matched element + confidence, lets the user accept-all or row-by-row.
- **Inline matcher config**: filename / subpath / ContentTag enabled by default; GameObjectName / manifest-explicit optional and toggleable in the modal footer.
- **Optimistic dirty preview**: queued elements show new thumbnail in both Layout box and List row *before* Unity Apply happens — visual feedback is immediate.
- **last-applied poller**: backend `/api/v2/last-applied` polled every ~2s; when Unity writes a new `appliedAt`, frontend auto-clears matching dirty entries, toasts, and re-fetches snapshot.

## Pre-state

- content-poc repo HEAD before T11: `7606e56` (D-WebAdminV3-10)
- Solitaire repo HEAD before T11: `693a096` (D-WebAdminV3-3)
- Unity project: `/Volumes/ExtDrive/Works/unitypros/Solitaire/SolitaireUnity`
- Admin server: `python3 server.py` on port 8767
- v2 frontend (`/v2/`) remains served alongside v3 (`/v3/`) — non-breaking.

## v3 surface

| Layer | Component | Commit | Where |
|---|---|---|---|
| Unity Plugin | `ContentSnapshotExporter.cs` (+ `RectGeometry`) | D-WebAdminV3-1 `82a472d` | `SolitaireUnity/Assets/Editor/ContentAudit/` |
| Unity Plugin | LayoutGroup rebuild before rect read | D-WebAdminV3-2 `48aa27a` | `SolitaireUnity/Assets/Editor/ContentAudit/` |
| Unity Plugin | `CanvasInfo` per source | D-WebAdminV3-3 `693a096` | `SolitaireUnity/Assets/Editor/ContentAudit/` |
| Frontend | v3 4-pane scaffold | D-WebAdminV3-4 `236999b` | `admin/v3/` |
| Frontend | Sources + List panes | D-WebAdminV3-5 `3b55eaa` | `admin/v3/` |
| Frontend | Layout pane (Canvas viewport) | D-WebAdminV3-6 `7bfde5a` | `admin/v3/` |
| Frontend | Detail pane + drag-to-replace | D-WebAdminV3-7 `963ce6b` | `admin/v3/` |
| Frontend | Matcher engine + 11 unit tests | D-WebAdminV3-8 `4fb070b` | `admin/v3/matchers.js` + `matchers.test.html` |
| Frontend | Batch Review modal + folder drop | D-WebAdminV3-9 `9f2d782` | `admin/v3/` |
| Frontend | last-applied polling + auto-clear | D-WebAdminV3-10 `7606e56` | `admin/v3/` |
| Docs | SMOKE-TEST-V3.md | D-WebAdminV3-11 (this commit) | `admin/SMOKE-TEST-V3.md` |

## Automated tests

| Suite | Count | Result | Evidence |
|---|---|---|---|
| Unity EditMode `ContentSnapshotExporterTest` | 5/5 | ✅ PASS | +3 new tests (rect geometry / canvas info / LayoutGroup rebuild) on top of v2's 2; run via Unity MCP `run_tests` |
| Frontend `admin/v3/matchers.test.html` (browser unit tests) | 11/11 | ✅ PASS | filename, subpath, ContentTag, GameObjectName chains + edge cases; opened in Playwright, all green |
| Backend `admin/test_server_v2.py` (v2 regression) | 6/6 | ✅ PASS | no v3-introduced regression — v3 reuses v2 endpoints |
| Backend `admin/test_server.py` (v1 regression) | 6/6 | ✅ PASS | no regression |

## API smoke (curl-driven)

v3 introduces **no new endpoints** — it consumes the v2 surface plus the
v3-extended snapshot schema (`rect` + `canvas` fields on `ExportedElement` /
`SourceInfo`).

| # | Endpoint | Method | Status | Evidence |
|---|---|---|---|---|
| 1 | `/api/v2/snapshot` | GET | ✅ 200 | objects now contain `rect: {x, y, width, height, anchoredX, anchoredY}` + per-source `canvas: {renderMode, refResolution, scaleFactor}` (T1-T3 schema) |
| 2 | `/v3/` (static) | GET | ✅ 200 | serves `admin/v3/index.html` (4-pane cascade) |
| 3 | `/v3/matchers.test.html` | GET | ✅ 200 | browser test runner shows `11 / 11 PASS` |
| 4 | `/api/v2/queue-changes` | POST | ✅ 200 | v3 queues per-element changes same as v2 |
| 5 | `/api/v2/last-applied` | GET | ✅ 200 | v3 poller hits this every ~2s |

## End-to-end flow verification (agent-verified)

1. **T6 — Layout pane real positions** (Playwright + screenshot `Solitaire/v3-t6.png`):
   - Re-ran `ContentSnapshotExporter.Export()` via MCP `execute_code` → new snapshot.json with `rect` + `canvas` fields.
   - Loaded `/v3/`, selected scene `HomeMap.uGUI` from Sources pane.
   - Layout pane rendered 16 elements at their real Unity positions; `ChapterChip_1` … `ChapterChip_5` horizontally aligned (matches in-Editor HorizontalLayoutGroup output) ✅
   - Canvas viewport scaled to fit pane while preserving aspect (CanvasScaler refResolution honored) ✅

2. **T7 — drag PNG to Detail → confirm → Apply** (Playwright `v3-t7-detail-confirm.png`):
   - Selected a single element in List pane → Detail pane focused on it.
   - Synthetic drag of a PNG `File` object onto Detail pane → drop-confirm card rendered with new thumbnail + filename ✅
   - Clicked Apply → `POST /api/v2/queue-changes` with one entry ✅
   - Layout box + List row showed optimistic new thumbnail with amber dirty border ✅
   - Sidebar "💾 全局保存 (1)" badge enabled ✅

3. **T9 — folder drop → Batch Review modal** (Playwright `v3-t9-batch-modal.png`):
   - Synthetic `DataTransferItemList` with 5 PNG entries dropped on List pane.
   - Batch Review modal opened with 5 rows: each row shows source filename, matched element, confidence + matcher badge (filename / subpath / tag).
   - Footer chips toggle: `filename ✓ subpath ✓ tag ✓ gameObject ✗ manifest ✗` → re-running match updates rows live ✅
   - Accept All button queued 5 changes to `pending-changes.json` ✅

4. **T10 — Unity Apply → poller catches** (Playwright `v3-t10-poller-clear.png`):
   - Synthetic Unity Apply via `execute_code`: wrote a fresh `last-applied.json` with `appliedAt = now`, `appliedChanges = 1`, `details = [{ id: <dirty element id> }]`.
   - Within ~2s the v3 poller fired, toasted "Unity Apply succeeded — cleared 1 dirty", removed amber border from the dirty row + Layout box, auto-refreshed snapshot ✅

## Visual UI verification (Playwright + human follow-up)

| # | Step | Expected | Status |
|---|---|---|---|
| V1 | Open `/v3/` | 4-pane cascade visible: Sources \| Layout/List stacked \| Detail; dark theme + brand header | ✅ agent-verified |
| V2 | Sources pane | Scenes (4) + Prefabs (27) groups; click cascades to middle column | ✅ agent-verified |
| V3 | Layout pane | Canvas viewport with elements drawn at real RectTransform positions; selected element highlighted | ✅ agent-verified (T6) |
| V4 | List pane | Element rows below Layout pane; thumbnails + component badge + ContentTag chip; click syncs Detail + Layout selection | ✅ agent-verified |
| V5 | Detail pane | Selected element: large thumbnail, full path, component info, drop zone for replacement PNG | ✅ agent-verified |
| V6 | Drag PNG to Detail → confirm card | drop-confirm preview + Apply/Cancel; Apply queues + shows optimistic dirty | ⏳ human (synthetic File works; real OS file picker drag-from-Finder not covered by Playwright headless) |
| V7 | Drag folder to List | Batch Review modal: rows + matcher badges + footer chips + Accept All | ✅ agent-verified (T9) |
| V8 | Optimistic dirty preview | Layout box + List row both show new thumbnail with amber border *before* Unity Apply | ✅ agent-verified |
| V9 | After Unity Apply | poller catches new `appliedAt` → toast + amber clears + snapshot auto-refresh | ⏳ human (synthetic Apply verified — real Unity menu click pending) |

Visual references / mockup: `admin/v2/mockup-layout-view.html` (design source-of-truth for v3 layout).

Agent screenshots in Solitaire repo: `v3-t6.png`, `v3-t7-detail-confirm.png`,
`v3-t9-batch-modal.png`, `v3-t10-poller-clear.png`.

## Notes / known caveats

- **Folder drop is Chromium-only**: v3's folder drop uses `webkitGetAsEntry` /
  `FileSystemEntry`. Supported in Chrome, Edge, Brave, and recent Safari.
  **Firefox does NOT support recursive folder reads** via this API, so folder
  drop in Firefox will only see top-level entries (or nothing). Single-file
  drag to Detail still works everywhere. Documented limitation; if Firefox
  support is needed later, fall back to `<input type="file" webkitdirectory>`.

- **v3 snapshot is backward-incompatible with v2 snapshot.json**: v3 *reads*
  `rect` + `canvas` fields that only exist after T1-T3 land in Unity. A v2-era
  snapshot.json loaded into v3 will render an empty Layout pane (no rects) — the
  user must re-run Unity `Tools/Solitaire/Content/Sync to Web Admin` after
  pulling T1-T3 to populate the new fields. v2 frontend tolerates the extra
  fields (it ignores `rect` / `canvas`), so the upgrade is **one-way safe**:
  Unity → v3 schema works for both `/v2/` and `/v3/`.

- **v2 frontend preserved**: `/v2/` continues to serve the v2 single-pane
  editor. Users can opt into v3 via `/v3/` or the Unity menu
  "Open Web Admin v3" (if/when that menu lands — currently menu still points to
  v2; documented as future polish, not a v3-blocking item). Eventual deprecation
  of v2 is left for a future plan once v3 has soaked.

- **No real replaceable PNG in current Unity project**: same caveat as v2 —
  Phase 4 made all UI runtime-injected, so V6/V9 real-flow validation needs a
  human with a fresh Asset/Art/ PNG. The agent verified the v3 logic with
  synthetic File objects + synthetic `last-applied.json` writes.

---

## v3 UX follow-up (post-friction-log)

After the initial v3 ship, a Persona × JTBD UX spike (see `Solitaire/docs/ux/friction-log-v3-2026-05-12.md`)
identified that the artist target user would abandon in 3 steps because:
- 0 replaceable assets in current project (Phase 4 fully runtime-injected) → tool looks broken
- Unity terminology not familiar to non-Unity-savvy artists
- Apply flow required switching to Unity Editor

3 follow-up commits ship the fixes:

### D-WebAdminV3-12 — empty-state + 术语脱敏 + sidebar/list 标 (P0-1 + P0-2 + P1-1 + P1-2)

- **Empty-state banner**: when 0 replaceable globally, layout main pane shows purple guidance card explaining Phase 4 runtime injection + how to add static assets
- **Sidebar replaceable badges**: each source shows green `✓N` badge for replaceable count, 🔒 lock icon when zero
- **Auto-pick-replaceable**: page loads selecting first source with `replaceable > 0`
- **List row indicator**: `.list-row-status-repl` (✓ emerald) / `.list-row-status-lock` (🔒 dim) per row, hover tooltip explains
- **Detail terminology**: friendly title (last GameObject segment) + breadcrumb subtitle + `friendlyAssetLabel()` (e.g. "Unity 自带占位图（不可直接替换）" instead of `Resources/unity_builtin_extra:UISprite`)
- **Tech disclosures**: GUID / Unity asset path / Canvas render mode hidden under `<details class="detail-tech">` collapsibles

content-poc commit: `440d058`

### D-WebAdminV3-13 — Auto-Apply Watch Mode (P0-3)

Unity background watcher that polls `admin/data/pending-changes.json` every 2s and auto-runs `ContentApplyWebChangesMenu.ApplyChanges` silently (no dialog) when new pending detected.

- New menu: `Tools/Solitaire/Content/Auto-Apply Web Changes (Watch Mode)` (toggle, checkmark)
- `[InitializeOnLoad]` restores subscription after domain reload via `EditorPrefs Solitaire.WebAdminV2.WatchMode`
- 2s throttle on `EditorApplication.update` to avoid spinning
- Writes `admin/data/watch-state.json` so frontend can show "🟢 自动应用" / "⚪ 手动应用" indicator
- New backend endpoint: `/api/v2/watch-state` reads watch-state.json
- Frontend `#v3-watch-indicator` in topbar reflects state

End-to-end verified: synthetic pending-changes.json → 3s later last-applied.json updated + chip_v3t13_test.png materialized.

Solitaire commit: `a682838` | content-poc commit: `530f3be`

### D-WebAdminV3-14 — legend + 人话 confirm + dirty 持久化 (P1-3 + P1-4 + P1-5)

- **Layout legend**: pane header followed by `.v3-layout-legend` strip — 3 swatches (✓ 可替换 / 🔒 Unity 自带 / ○ 未指定) + "悬停查看详情" hint
- **Element hover tooltip**: every `.el` gets `title="<friendlyName> · <status>"`
- **Humanized confirm card**: 「替换 **ChapterChip_3** 的图片？」 header + side-by-side `当前 vs 新` thumbnails (new thumb has emerald border + glow) + 文件名 secondary + 技术细节 collapsed
- **Dirty localStorage persistence**: `state.js` exports `persistDirty/loadPersistedDirty/clearPersistedDirty` — saves lightweight descriptors (id/targetAssetPath/byteSize/filename), NOT byte payloads (too large + browser security)
- **Restore banner on reload**: if persisted dirty exists, bottom-center amber banner offers Discard (works) + Resend (disabled with tooltip explaining browser security)
- **Auto-clear after Unity Apply**: poller cleanup path calls `clearPersistedDirty()`

content-poc commit: `7cfd369`

---

## Updated Acceptance after follow-up

- [x] Artist persona no longer abandons at "0 replaceable" — guidance banner explains the state
- [x] Unity terminology (Resources/unity_builtin_extra, GameObject path, GUID, Canvas) all hidden by default or replaced with friendly Chinese
- [x] Optional auto-apply: artist toggles Unity menu once, then v3 changes auto-apply within 3s without switching apps
- [x] Dirty state survives accidental page reload (with honest "can't auto-resend bytes" message)
- [x] Legend + hover tooltips make the colored boxes self-explanatory
- [x] Confirm card asks human-readable question with visual before/after

Remaining ⏳: V6 real file picker (only exercise-able with real `Assets/Art/*.png` in project), V9 full Unity Apply with multiple changes (covered by T13 e2e but real artist flow needs human validation).
