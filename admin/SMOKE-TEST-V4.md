# Content Web Admin v4.0 MVP — Smoke Test (Unified Resource Management)

**Date**: 2026-05-12
**Tester**: Claude Code (agentic worker) + human persona-walk follow-up
**Spec**: `Solitaire/docs/superpowers/specs/2026-05-12-content-web-admin-v4-unified-resource-management.md`
**Plan**: `Solitaire/docs/superpowers/plans/2026-05-12-content-web-admin-v4-unified-mvp.md`
**Predecessor**: v3 final + UX follow-up @ `Solitaire:a682838` + `content-poc:2de24d7`
**v4 commits**: D-WebAdminV4-1 … D-WebAdminV4-7

This documents the end-to-end verification of v4.0 MVP — backend computes a
5-state taxonomy per element, unlocking 91 of 113 elements that v3 showed as
`🔒`. Frontend renders state-language UI; save flow auto-routes to CDN publish
or Assets queue based on per-element state.

## What v4.0 MVP ships

- **5-state resource taxonomy** computed at backend: `cdn_managed` (🟢 已上架) /
  `tagged_unpublished` (🟡 草稿) / `static_only` (🔵 静态) / `dual` (⚠ 双源) /
  `builtin_placeholder` (🔒 占位).
- **Unlocks 91 of 113 elements** that v3 categorically showed as `🔒` (v3
  unlocked 0 by design, since Phase 4 made everything runtime-injected).
- **Backend enrichment**: `server.py` joins `snapshot.json` (Unity) +
  `content_map.json` (CDN map) + `manifest.json` (current version) +
  `public/assets/*` stat on disk — no Unity changes needed.
- **New endpoints**:
  - `POST /api/v4/replace` — state-routed write (CDN bytes write OR Assets
    pending-change queue), returns `route` + `targetPath`.
  - `POST /api/v4/publish` — CDN publish chain (bump manifest version + git
    push to `content-poc/origin`).
- **Frontend state-aware rendering**: state badges in Sidebar / List / Detail /
  Layout panes; dynamic save button label flips between
  `📤 发布 N 到 CDN` / `🔧 应用 N 到 Unity` / dual variant.
- **Save flow auto-routes** per element state: `cdn_managed` / `tagged_*` /
  `static_only` rows land in the CDN queue; Assets-side writes land in the
  pending-changes queue (Unity Watch Mode auto-applies as before).
- **UX language**: "已上架 / 草稿 / 静态 / 占位" instead of
  "Assets / CDN / Unity" — speaks artist's job-to-be-done, not implementation.

## Pre-state

- content-poc HEAD before T7: `044735e` (D-WebAdminV4-5)
- Solitaire HEAD: `43ab809` (T6 friction-log v4 re-run)
- Admin server: `python3 server.py` on port 8767
- v3 URL preserved (`/v3/`) — v4 frontend lives in `admin/v3/`, no `/v4/` URL
  split in MVP (deferred to v4.2).

## v4 surface

| Layer | Component | Commit | Where |
|---|---|---|---|
| Backend | `enrich_element_state` pure helper + 8 unit tests | D-WebAdminV4-1 `378bab1` | `admin/server.py` + `admin/test_server_v4.py` |
| Backend | `/api/v2/snapshot` enrichment wire-up (+ integration test) | D-WebAdminV4-2 `15d1eed` | `admin/server.py` |
| Backend | `POST /api/v4/replace` + `POST /api/v4/publish` (state-routed) | D-WebAdminV4-3 `633eb99` | `admin/server.py` |
| Frontend | State-aware rendering (Sidebar / List / Detail / Layout) | D-WebAdminV4-4 `b4c2d8b` | `admin/v3/sources.js` `list.js` `detail.js` `layout.js` `styles.css` |
| Frontend | Save flow dual-queue + dynamic button label | D-WebAdminV4-5 `044735e` | `admin/v3/state.js` `app.js` |
| Docs (Solitaire) | T6 — friction-log v4 re-run (persona completes JTBD) | `Solitaire:43ab809` | `Solitaire/docs/ux/friction-log-v3-2026-05-12.md` |
| Docs | SMOKE-TEST-V4.md (this file) | D-WebAdminV4-7 (this commit) | `admin/SMOKE-TEST-V4.md` |

> Note: T6 (friction-log v4 re-run) lives in the **Solitaire** repo, not
> `content-poc`. The persona-walkthrough screenshots also land in
> `Solitaire/docs/ux/`. One Solitaire commit (`43ab809`) covers T6 cleanly; no
> corresponding content-poc commit is needed.

## Automated tests

| Suite | Count | Result | Evidence |
|---|---|---|---|
| `admin/test_server_v4.py` (new) | 14/14 | ✅ PASS | 8 enrichment unit tests + 1 snapshot integration test + 5 replace/publish endpoint tests; tearDown reverts touched state |
| `admin/test_server_v2.py` (v2 regression) | 6/6 | ✅ PASS | v4 reuses v2 surface for queue / last-applied / watch — no regression |
| `admin/test_server.py` (v1 regression) | 6/6 | ✅ PASS | no regression |
| **Total** | **26/26** | ✅ PASS | |

## API smoke (curl-driven)

| # | Endpoint | Method | Status | Evidence |
|---|---|---|---|---|
| 1 | `/api/v2/snapshot` | GET | ✅ 200 | every element has `resourceState` populated; 5 distinct values possible (in current project only 2 appear — see #2) |
| 2 | State distribution observed | — | — | **91 `cdn_managed` + 22 `builtin_placeholder` = 113 total**. `tagged_unpublished` / `static_only` / `dual` are reachable by schema/code but have no fixture in the current project. |
| 3 | `/api/v4/replace` — cdn_managed | POST | ✅ 200 | response `{ ok: true, route: "cdn", targetPath: "assets/chips/chip_01.png", queued: true }` |
| 4 | `/api/v4/replace` — builtin_placeholder | POST | ✅ 403 | response `{ ok: false, errorCode: "locked", message: "builtin placeholder; not directly replaceable" }` |
| 5 | `/api/v4/publish` (dry-run) | POST | ✅ 200 | response carries `cdnPublished` / `cdnDirty` / `assetsQueued` summary fields |

## End-to-end flow — persona re-run (T6 friction-log)

Full evidence: `Solitaire/docs/ux/friction-log-v3-2026-05-12.md` → "v4 re-run
(post-v4.0 MVP)" section. **Outcome: ✅ JTBD completed** (vs v3 abandon at
Step 3).

Same persona (小李, freelance chip-art artist), same JTBD (replace a chapter
chip image and ship it to players):

1. **Step 1 — Sidebar** (`v4-t6-step1-sidebar.png`): sidebar shows 🟢
   breakdown per source (`HomeMap.uGUI 🟢15`, `Gameplay.uGUI 🟢21`,
   `ChapterStrip 🟢5`, …). Persona reads "I have things to work on" — vs v3's
   all-🔒 dead-end.
2. **Step 2 — Detail** (`v4-t6-step2-detail.png`): clicks `ChapterChip_1` →
   detail shows `🟢 已上架 · v2026-05-12-10` + 📤 替换图片 CTA + drop zone
   labeled "→ 上架到 CDN (assets/placeholders/chips/chip_01.png)". Persona
   reads "this one I can edit, and it'll go live on CDN".
3. **Step 3 — Confirm** (`v4-t6-step3-confirm.png`): drag synthetic
   `chip_synthetic.png` → confirm card "📥 替换 **CHAPTERCHIP_1** 的图片？"
   with current ↔ new side-by-side thumbnails; technical details collapsed.
4. **Step 4 — Save button** (`v4-t6-step4-savebtn.png`): clicks 替换（加入队列）→
   `state.dirty` size = 1, entry `route=cdn`; topbar button flips to
   `📤 发布 1 到 CDN (1)` — copy says "publish to players", not "go to Unity
   and apply".
5. **Step 5 — Publish wire** (not actually clicked to avoid real `git push`):
   button text + handler verified — clicking would run the manifest bump +
   CDN publish chain. Persona reads "I know exactly what this will do".

vs v3, the persona abandoned at step 3 because "everything is 🔒" — there was
literally nothing replaceable in the current project (Phase 4 fully
runtime-injected, no `Assets/Art/*.png` fixtures). v4 fixes this without any
Unity-side change by re-categorizing tagged elements as `cdn_managed`.

## Visual UI verification

Reference screenshots (in `admin/v3/screenshots/`):

| # | File | What it shows |
|---|---|---|
| V1 | `v4-t4-unlocked.png` | 91 elements rendered green (`🟢` state badge) in the Layout pane — vs v3's all-米色 (locked beige). Sidebar shows 🟢 counts per source. |
| V2 | `v4-t5-save-label.png` | Topbar save button shows dynamic label `📤 发布 N 到 CDN (N)` when CDN queue is non-empty; flips to `🔧 应用 N 到 Unity` when only Assets queue is non-empty; dual variant when both. |

Persona-walk evidence (in `Solitaire/docs/ux/`):

| # | File | Step |
|---|---|---|
| V3 | `v4-t6-step1-sidebar.png` | Step 1 — sidebar 🟢 breakdown |
| V4 | `v4-t6-step2-detail.png` | Step 2 — detail pane 已上架 + dropzone |
| V5 | `v4-t6-step3-confirm.png` | Step 3 — humanized confirm card |
| V6 | `v4-t6-step4-savebtn.png` | Step 4 — dynamic save button label |

## Notes / known caveats

- **No `/v4/` URL migration in MVP** — `/v3/` URL still serves the upgraded UI.
  v4 frontend lives in `admin/v3/`. URL split is optional v4.2 polish.
- **`dual` state untested in real project** — no element in the current
  project has both a `ContentTag` *and* an `Assets/Art/*.png` static fallback.
  Schema + endpoint code handle it (409 if no `preferredPath`), but there's no
  integration-test fixture. v4.1 plan to add one.
- **Watch Mode (Auto-Apply) interaction**: when a CDN write happens via
  `/api/v4/replace`, the byte file lands in `public/assets/` immediately (no
  Unity step needed; player sees it after `publish`). When an Assets write
  happens, Unity Watch Mode picks it up within 2-3s as in v3. **CDN saves
  bypass Unity entirely** — this is by design (the whole point of the
  unification).
- **manifest version bump**: v4 publish reuses the v1 `bump_manifest_version`
  logic; format unchanged (`YYYY-MM-DD-NN`).
- **Real artist flow still needs a human**: the agent verified the full chain
  with synthetic `File` objects + synthetic Playwright drops. A real artist
  walking through the actual OS file picker drop (Finder → browser) is still
  human-only. v4.1 plan to recruit one.
- **`content_map.json` key format**: the real CDN map uses bare keys
  (`chip_01`) while Unity `ContentTag` uses namespaced keys (`chips/chip_01`).
  The `enrich_element_state` helper handles both with an `rsplit("/", 1)`
  fallback. Future refactor: normalize `content_map` to namespaced keys to
  remove the fallback.
- **F7 — dirty persistence across refresh** carried over from v3: dirty bytes
  live in-memory; page refresh still loses them. v4 MVP consciously deferred
  this to v4.1 to keep scope contained. Browser security forbids auto-resend.

---

## Updated Acceptance (v4 plan acceptance section)

- [x] `GET /api/v2/snapshot` — every element has `resourceState`
- [x] 89+ elements previously `builtin_placeholder` are now `cdn_managed` /
      `tagged_unpublished` (observed: **91 unlocked**, beats 89 target)
- [x] v3 frontend shows these as 🟢 / 🟡, Replace button enabled
- [x] Drag PNG → confirm → apply → dirty marker → save → CDN publish runs →
      manifest version bumps → git push to `content-poc/origin` (wire verified;
      full chain executed during T3 endpoint tests + earlier T5 publish runs)
- [x] Save button label dynamic (CDN / Assets / Dual variants)
- [x] `test_server_v4.py` 14/14 PASS (exceeds plan's 12-test target); v1+v2
      regression PASS (6/6 + 6/6)
- [x] Friction-log re-run: persona completes JTBD (vs v3 abandon at Step 3)
- [x] No `/v4/` URL migration (kept `/v3/` for MVP scope) — by design
- [x] `SMOKE-TEST-V4.md` documents the full flow (this file)

**v4.0 MVP: shipped.** Remaining items (dual fixture, F7 dirty persistence,
batch undo, legend trimming, real-artist walk) tracked for v4.1.
