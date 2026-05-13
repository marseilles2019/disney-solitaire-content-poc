# Content Web Admin — BYO Unity Project Guide

This document explains how to adopt the Content Web Admin tool in a **new
Unity project** (i.e. any project that is not Disney Solitaire). As of
v5.0, the tool is fully manifest-driven — Solitaire-specific knowledge
no longer lives in code. Your project authors a `WebAdminConfig.asset`
ScriptableObject, the Editor exporter emits a `manifest.json`, and the
frontend renders your project's taxonomy with **zero code change**.

> **Tested reference adopter**: Disney Solitaire (this repo's primary
> consumer). For the SMOKE proof of the v5 generalization, see
> `SMOKE-TEST-V5.md`.

---

## What you get

- A browser UI (`/v3/`) listing every UI element the Editor has exported,
  grouped by world (▼ 主页 / ▼ 游戏中 / ▼ 跨世界 / ▼ 未分类 — your
  project's own world IDs, not Solitaire's).
- 5-state resource taxonomy badges (🟢 已上架 / 🟡 草稿 / 🔵 静态 /
  ⚠ 双源 / 🔒 占位).
- Drag-to-replace + batch + auto-apply Watch Mode flows.
- State-preset filter chips and component grouping derived from your
  `WebAdminConfig.asset`.

---

## Setup — 6 steps for a new Unity project

### Step 1 — Copy Editor scripts to your project

Copy the entire `Assets/Editor/ContentAudit/` folder from Solitaire into
your new project's `Assets/Editor/ContentAudit/`. The required files:

```
Assets/Editor/ContentAudit/
├── ContentApplyWebChangesMenu.cs       ; Tools/Solitaire/Content/Apply Web Changes
├── ContentAuditExporter.cs             ; legacy v1 exporter (kept for compat)
├── ContentAuditScanner.cs              ; legacy v1 scanner
├── ContentAuditWindow.cs               ; legacy v1 EditorWindow
├── ContentCoverageMarkdownFormatter.cs ; coverage report formatter
├── ContentCoverageReporter.cs          ; coverage report driver
├── ContentCoverageScanner.cs           ; coverage scanner
├── ContentManifestExporter.cs          ; **v5 — writes manifest.json + prefab-usage.json**
├── ContentSnapshotExporter.cs          ; v2 — writes snapshot.json + thumbnails
├── ContentSyncToWebMenu.cs             ; Tools/Solitaire/Content/Sync to Web Admin
├── ContentWatchMenu.cs                 ; Tools/Solitaire/Content/Auto-Apply Watch Mode
├── PlaceholderPngBaker.cs              ; bakes built-in placeholder PNGs
├── PocAutoSetup.cs                     ; convenience one-shot scene setup
├── Solitaire.Content.Editor.asmdef     ; assembly definition (rename if you like)
├── WebAdminConfig.cs                   ; **v5 — the ScriptableObject class**
└── WebAdminConfigBootstrap.cs          ; **v5 — `Create → Solitaire → Web Admin Config` menu**
```

> The menu paths still say `Tools/Solitaire/Content/...` and
> `Create → Solitaire → ...`. You can rename them (e.g. to your
> studio/project name) by editing the `[MenuItem(...)]` and
> `[CreateAssetMenu(...)]` attributes in the .cs files. The asmdef
> name (`Solitaire.Content.Editor`) is harmless to leave as-is, but
> can be renamed for cleanliness.

Once copied, Unity will compile the new Editor assembly. Watch the
Console for compile errors before continuing.

### Step 2 — Create your `WebAdminConfig.asset`

Two equivalent ways:

**Option A (recommended) — Bootstrap menu**:
Run `Tools/Solitaire/Web Admin/Bootstrap Config` (provided by
`WebAdminConfigBootstrap.cs` from T1). This drops a pre-skeleton
`WebAdminConfig.asset` into `Assets/Editor/` and selects it in the
Inspector.

**Option B — Standard CreateAssetMenu**:
Right-click in the Project window → `Create → Solitaire → Web Admin
Config`. Save the asset as `Assets/Editor/WebAdminConfig.asset`.

The Exporter looks for the first `WebAdminConfig.asset` it can find in
the project — keeping it under `Assets/Editor/` is the conventional
location.

### Step 3 — Configure your project taxonomy in the Inspector

Open `WebAdminConfig.asset` in the Inspector and fill in:

- **Project Name** — e.g. `"My RPG"`. Shows in the frontend header.
- **Project Icon** — optional emoji/symbol (e.g. `"🗡"`). Shows next
  to the project name.
- **Worlds** — list of `{ id, labelZh, labelEn, icon }`. Each "world"
  is a top-level grouping (e.g. `home` / `gameplay` / `inventory` /
  `battle`). Worlds drive the sidebar IA.
- **States** — list of `{ id, labelZh, labelEn, worldId, icon, sceneName }`.
  Each "state" is a runtime UI state inside one world (e.g.
  `home.map`, `home.settings`, `gameplay.playing`, `gameplay.pause`).
  States feed the state-presets chip strip.
- **Components** — list of `{ id, labelZh, labelEn, worldId? }`. Each
  "component" is a logical UI module (e.g. `Inventory`, `ChapterStrip`,
  `SettingsButton`). If `worldId` is set, the component nests under
  that world in the sidebar; otherwise it falls to "▼ 跨世界" or
  "▼ 未分类" depending on prefab-usage data.
- **Conventions** — project-specific path/regex hints:
  - `writePathPrefix` (e.g. `"Assets/Art/"`) — where artist asset
    replacements get written when routed to the Unity Assets queue
    (vs CDN publish).
  - `overlayNameRegex` (e.g. `"^Overlay_"`) — pattern for identifying
    overlay UI elements.
  - other project-specific knobs as the schema grows.

> See `Assets/Editor/ContentAudit/WebAdminConfig.cs` for the canonical
> schema. Solitaire's own `WebAdminConfig.asset` doubles as a worked
> example — open it in the Inspector to see exactly how the 2 worlds /
> 10 states / 17 components / conventions are filled in.

### Step 4 — Copy the web admin host

On your web admin host machine (can be the same workstation, or a
shared dev server), copy two directories from this content-poc repo:

```
admin/server.py     → /path/to/your/admin/server.py
admin/v3/           → /path/to/your/admin/v3/
```

You also need `admin/data/` to exist (the Exporter writes
`snapshot.json` / `manifest.json` / `prefab-usage.json` here). Create
it empty:

```bash
mkdir -p /path/to/your/admin/data
```

Optional: copy the test suites (`admin/test_server*.py`) too if you
want to run the regression suite against your fork.

### Step 5 — Start the server + run Unity Sync

On the web admin host:

```bash
cd /path/to/your/admin
python3 server.py
# → "Web Admin server on http://localhost:8767"
```

Browse to `http://localhost:8767/v3/` — you'll see an empty state
because no Unity export has run yet.

In Unity, with your project open:

```
Tools/Solitaire/Content/Sync to Web Admin
```

This runs the full exporter chain — writes
`admin/data/snapshot.json` (UI element inventory + thumbnails) +
`admin/data/manifest.json` (your project taxonomy) +
`admin/data/prefab-usage.json` (static prefab-usage scan).

Reload the browser. The frontend now renders your project's worlds /
states / components in the sidebar, with your project name / icon in
the header.

### Step 6 — Verify and iterate

Quick verification:

- ✅ Sidebar shows your project's world groups (not Solitaire's
  `主页 / 游戏中`).
- ✅ State-preset chips reflect your project's states.
- ✅ Detail pane shows your component's bilingual labels.
- ✅ `writePathPrefix` from your config is used when you drag-replace
  an asset.

If anything looks wrong, the iteration loop is:

1. Edit `WebAdminConfig.asset` in Unity Inspector.
2. Re-run `Tools/Solitaire/Content/Sync to Web Admin`.
3. Reload the frontend (`Cmd+R` / `Ctrl+R`).

No server restart needed; no frontend code change needed.

---

## Result — zero code change, just config

Your Unity project now drives a fully working Content Web Admin
instance, configured entirely via the Inspector. The frontend has no
hardcoded knowledge of your project: every label, group, preset, and
write path comes from `manifest.json` (which itself comes from your
`WebAdminConfig.asset`).

If you find a place where Solitaire-specific knowledge is still leaking
into the tool, that's a bug — file it against the v5 refactor.

---

## Reference: where the v5 generalization lives

| Concern | Before v5 (Solitaire-only) | v5 (manifest-driven) |
|---|---|---|
| Project name / icon | Hardcoded in `index.html` | `manifest.projectName` / `manifest.projectIcon` |
| World groups | Hardcoded in `sources.js` | `manifest.worlds[]` |
| State preset chips | Hardcoded array in `state-presets.js` | `manifest.states[]` |
| Component labels (zh) | Hardcoded `COMPONENT_ZH` map | `manifest.components[].labelZh` |
| Overlay matcher regex | Hardcoded `OVERLAY_NAME_RE` literal | `manifest.conventions.overlayNameRegex` |
| Write path prefix | Hardcoded `'Assets/Art/'` literal | `manifest.conventions.writePathPrefix` |
| Sidebar IA | Flat | World-grouped from `manifest.worlds[]` + `prefab-usage.json` |

For the full v5 surface and proof, see `SMOKE-TEST-V5.md`.

---

## SpriteAtlas-using projects

If your Unity project uses `.spriteatlas` files, v6.3 auto-handles the atlas
repack on every Apply. Nothing to configure — just Sync once after creating /
editing atlas resources so `sprite-atlas-membership.json` is current. The
admin frontend surfaces a `🧩 Part of atlas: <name>` badge in the detail
pane for any element whose asset is an atlas member.

To opt out (e.g. you have a CI step that pre-packs all atlases):
- In `WebAdminConfig.asset` → `Conventions` → `Sprite Atlas Auto Repack` =
  `false`.
- Re-Sync. Detail pane will still surface the atlas badge for visibility.

Recovery tool: Settings panel → "Force Repack All Atlases" posts to
`/api/v6/force-repack-all`, which writes a flag the Editor picks up on focus
and runs `SpriteAtlasUtility.PackAllAtlases`.

Solitaire is a 0-atlas project today — feature is dormant. See
`admin/SMOKE-TEST-V6.3.md` for the end-to-end test on a synthetic fixture.
