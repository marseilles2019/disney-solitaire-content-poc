# SMOKE-TEST-V6.3 — Sprite Atlas auto-repack

**Date:** 2026-05-13
**Scope:** Unity Editor exporter + Apply-side auto-repack + admin endpoints
+ frontend atlas badge / Settings "Force Repack All".
**Plan:** `Solitaire/docs/superpowers/plans/2026-05-12-content-web-admin-v6.3-impl.md`
**Predecessor:** v6.4 ship @ `Solitaire:42a37ab` + `content-poc:4b7d69c`.

V6.3 makes Apply (Web Admin) auto-detect which `.spriteatlas` files
contain the PNGs being replaced and triggers `SpriteAtlasUtility.PackAtlases`
so the runtime atlas texture reflects the new pixels. Zero overhead on
0-atlas projects — Solitaire is one such project today, so this SMOKE
walks both the no-op baseline (§A) and a synthetic fixture (§B–§H).

## Touched surfaces

| Side | File | Purpose |
|---|---|---|
| Unity Editor | `Assets/Editor/ContentAudit/ContentAtlasMembershipExporter.cs` | scans `t:SpriteAtlas`, writes `sprite-atlas-membership.json` |
| Unity Editor | `Assets/Editor/ContentAudit/ContentSyncToWebMenu.cs` | wires exporter into Sync |
| Unity Editor | `Assets/Editor/ContentAudit/ContentApplyWebChangesMenu.cs` | auto-repack stage after `AssetDatabase.Refresh()` |
| Unity Editor | `Assets/Editor/ContentAudit/ContentForceRepackMenu.cs` | flag-file watcher → `PackAllAtlases` (recovery) |
| Unity Editor | `Assets/Editor/ContentAudit/WebAdminConfig.cs` | `conventions.spriteAtlasAutoRepack` toggle (default ON) |
| Admin server | `admin/server.py` | `GET /api/v6/sprite-atlas-membership`, `POST /api/v6/force-repack-all` |
| Admin frontend (V3) | `admin/v3/manifest-store.js` | fetch + accessors |
| Admin frontend (V3) | `admin/v3/detail.js` | "🧩 Part of atlas" badge |
| Admin frontend (V3) | `admin/v3/settings.js` | Settings drawer + Force Repack All button |

## Pre-flight (once)

- Solitaire has 0 SpriteAtlas assets natively — that is OK, V6.3 is a
  no-op on this project. Run §A to confirm the no-op path.
- To exercise the feature end-to-end, create a synthetic fixture under
  `Assets/Art/_TestAtlases/` (§B). Fixture is throwaway — Step §H
  cleans it back to {}.
- Manifest toggle default: `conventions.spriteAtlasAutoRepack = true`.
  Absent field also = true (v5 back-compat).
- Admin server running: `cd ~/dev/disney-solitaire-content-poc/admin &&
  python3 server.py` on port 8767.

---

## §A · Baseline (no atlas in project)

Solitaire's natural state. Confirms the 0-atlas no-op path.

**Step 1 — Sync (Unity Editor menu):**

```
Tools/Solitaire/Content/Sync to Web Admin
```

Or programmatically via Unity MCP `execute_code`:

```csharp
Solitaire.Content.Editor.ContentSyncToWebMenu.Sync();
```

**Step 2 — Inspect membership artifact:**

```bash
cat ~/dev/disney-solitaire-content-poc/admin/data/sprite-atlas-membership.json
```

**Expected:** `{}` (empty JSON object).

**Step 3 — Endpoint check:**

```bash
curl -s http://127.0.0.1:8767/api/v6/sprite-atlas-membership | python3 -m json.tool
```

**Expected:** `{}`.

**Step 4 — Apply any pending change under `Assets/Art/` (drag-replace via
Web Admin, then `Tools/Solitaire/Content/Apply Web Changes`):**

**Expected console output:**
- Zero `[Apply] Repacking` lines.
- `last-applied.json` written with `repackedAtlases: []`.

```bash
cat ~/dev/disney-solitaire-content-poc/admin/data/last-applied.json \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('repackedAtlases'))"
# → []
```

---

## §B · Synthetic fixture

Creates 2 PNG members + a `.spriteatlas` under
`Assets/Art/_TestAtlases/` (allow-listed by `IsSafeTargetPath`). Fixture
is gitignored — never commit.

**Step 1 — Ensure `.gitignore` covers fixture:**

```bash
grep -q "_TestAtlases" /Volumes/ExtDrive/Works/unitypros/Solitaire/.gitignore \
  || cat >> /Volumes/ExtDrive/Works/unitypros/Solitaire/.gitignore <<'EOF'
/SolitaireUnity/Assets/Art/_TestAtlases/
/SolitaireUnity/Assets/Art/_TestAtlases.meta
EOF
```

**Step 2 — Create 2 PNG members (Unity MCP `execute_code`):**

```csharp
var dir = "Assets/Art/_TestAtlases";
System.IO.Directory.CreateDirectory(dir);
foreach (var pair in new (string name, UnityEngine.Color col)[] {
    ("test_member_a", UnityEngine.Color.red),
    ("test_member_b", UnityEngine.Color.blue),
})
{
    var tex = new UnityEngine.Texture2D(64, 64, UnityEngine.TextureFormat.RGBA32, false);
    var px = new UnityEngine.Color[64 * 64];
    for (int i = 0; i < px.Length; i++) px[i] = pair.col;
    tex.SetPixels(px); tex.Apply();
    System.IO.File.WriteAllBytes($"{dir}/{pair.name}.png", tex.EncodeToPNG());
    UnityEngine.Object.DestroyImmediate(tex);
}
UnityEditor.AssetDatabase.Refresh();
foreach (var n in new[] { "test_member_a", "test_member_b" })
{
    var path = $"{dir}/{n}.png";
    var ti = (UnityEditor.TextureImporter)UnityEditor.AssetImporter.GetAtPath(path);
    ti.textureType = UnityEditor.TextureImporterType.Sprite;
    ti.SaveAndReimport();
}
```

**Step 3 — Create `TestAtlas.spriteatlas`:**

```csharp
var atlas = new UnityEngine.U2D.SpriteAtlas();
atlas.Add(new UnityEngine.Object[] {
    UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Texture2D>("Assets/Art/_TestAtlases/test_member_a.png"),
    UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.Texture2D>("Assets/Art/_TestAtlases/test_member_b.png"),
});
UnityEditor.AssetDatabase.CreateAsset(atlas, "Assets/Art/_TestAtlases/TestAtlas.spriteatlas");
UnityEditor.AssetDatabase.SaveAssets();
UnityEditor.AssetDatabase.Refresh();
```

**Step 4 — Re-Sync + verify membership:**

```csharp
Solitaire.Content.Editor.ContentSyncToWebMenu.Sync();
```

```bash
cat ~/dev/disney-solitaire-content-poc/admin/data/sprite-atlas-membership.json | python3 -m json.tool
```

**Expected:**

```json
{
  "Assets/Art/_TestAtlases/test_member_a.png": ["Assets/Art/_TestAtlases/TestAtlas.spriteatlas"],
  "Assets/Art/_TestAtlases/test_member_b.png": ["Assets/Art/_TestAtlases/TestAtlas.spriteatlas"]
}
```

---

## §C · Apply triggers auto-repack

**Step 1 — Construct a fresh 64×64 green PNG and Apply against
`test_member_a.png` (Unity MCP `execute_code`):**

```csharp
// Build fresh green PNG bytes
var tex = new UnityEngine.Texture2D(64, 64, UnityEngine.TextureFormat.RGBA32, false);
var px = new UnityEngine.Color[64 * 64];
for (int i = 0; i < px.Length; i++) px[i] = UnityEngine.Color.green;
tex.SetPixels(px); tex.Apply();
var b64 = System.Convert.ToBase64String(tex.EncodeToPNG());
UnityEngine.Object.DestroyImmediate(tex);

// Programmatic Apply (bypasses the Web Admin queue for repeatability)
var change = new Solitaire.Content.Editor.ContentApplyWebChangesMenu.PendingChange {
    id = "v63-smoke-c",
    actionType = "replace",
    targetAssetPath = "Assets/Art/_TestAtlases/test_member_a.png",
    newBytesBase64 = b64,
};
Solitaire.Content.Editor.ContentApplyWebChangesMenu.ApplyChanges(
    new System.Collections.Generic.List<Solitaire.Content.Editor.ContentApplyWebChangesMenu.PendingChange> { change });
```

**Expected console:**

```
[Apply] Repacking 1 affected atlas(es)...
[Apply]   ✅ repacked Assets/Art/_TestAtlases/TestAtlas.spriteatlas
```

**Step 2 — Inspect last-applied audit:**

```bash
python3 -c "import json; print(json.load(open('$HOME/dev/disney-solitaire-content-poc/admin/data/last-applied.json'))['repackedAtlases'])"
```

**Expected:** `['Assets/Art/_TestAtlases/TestAtlas.spriteatlas']`.

**Step 3 — Visual check (optional):** Scene/Game view shows the green
pixels on any GameObject bound to the atlas sprite.

---

## §D · Atlas badge in detail pane

Frontend badge surfaces "🧩 Part of atlas: TestAtlas" on any element
whose `currentAssetPath` is in the membership map.

**Step 1 — Data-path check (no scene binding required):**

```bash
curl -s http://127.0.0.1:8767/api/v6/sprite-atlas-membership | python3 -m json.tool
```

**Expected:** Both fixture PNGs listed.

**Step 2 — Full DOM render (requires real scene binding):** Bind a
scene Image's sprite to `Assets/Art/_TestAtlases/test_member_a.png` and
save the scene, then re-Sync. Open `http://127.0.0.1:8767/v3/`, click
the corresponding component row.

**Expected:** Detail pane shows `🧩 Part of atlas: TestAtlas` under
the asset preview. Unbound elements show no badge (NOT an empty row).

> Note: Solitaire today has no scene binding to fixture PNGs, so the
> full DOM render is gated on the binding step. The data path (Step 1)
> is sufficient to confirm `/api/v6/sprite-atlas-membership` powers
> the badge correctly; frontend mock in `admin/v3/detail.test.html`
> exercises the DOM contract without Unity.

---

## §E · Toggle OFF (CI 接管 path)

`conventions.spriteAtlasAutoRepack = false` → Apply skips repack;
badge in detail.js still renders (visibility preserved for artists).

**Step 1 — Flip toggle in Unity Inspector:**

Open `Assets/Editor/WebAdminConfig.asset` → `Conventions` →
`Sprite Atlas Auto Repack` → uncheck.

Or programmatically:

```csharp
var cfg = UnityEditor.AssetDatabase.LoadAssetAtPath<Solitaire.Content.Editor.WebAdminConfig>("Assets/Editor/WebAdminConfig.asset");
cfg.conventions.spriteAtlasAutoRepack = false;
UnityEditor.EditorUtility.SetDirty(cfg);
UnityEditor.AssetDatabase.SaveAssets();
```

**Step 2 — Re-Sync + re-Apply (repeat §C Step 1):**

```csharp
Solitaire.Content.Editor.ContentSyncToWebMenu.Sync();
// then re-run §C Apply snippet with a different fresh PNG
```

**Expected console:**
- No `[Apply] Repacking` lines.
- `last-applied.json.repackedAtlases` = `[]`.
- Detail-pane badge still visible (frontend reads membership, not toggle).

**Step 3 — Restore toggle to ON before §F:**

```csharp
var cfg = UnityEditor.AssetDatabase.LoadAssetAtPath<Solitaire.Content.Editor.WebAdminConfig>("Assets/Editor/WebAdminConfig.asset");
cfg.conventions.spriteAtlasAutoRepack = true;
UnityEditor.EditorUtility.SetDirty(cfg);
UnityEditor.AssetDatabase.SaveAssets();
Solitaire.Content.Editor.ContentSyncToWebMenu.Sync();
```

---

## §F · Force Repack All Atlases

Recovery tool: posts a flag to admin server, Unity Editor picks it up
on focus and runs `SpriteAtlasUtility.PackAllAtlases`.

**Step 1 — POST flag:**

```bash
curl -s -X POST http://127.0.0.1:8767/api/v6/force-repack-all | python3 -m json.tool
```

**Expected:** `{ "ok": true, "flag": "force-repack.flag" }`.

```bash
ls ~/dev/disney-solitaire-content-poc/admin/data/force-repack.flag
```

**Step 2 — Focus Unity Editor** (click Editor window to trigger
`EditorApplication.update` / `focusedWindowChanged`). Or manually:

```
Tools/Solitaire/Content/Force Repack All Atlases
```

**Expected console:**

```
[ForceRepack] repacked 1 atlas(es)
```

(N = current atlas count; on Solitaire post-cleanup that is 0 →
log line shows `repacked 0 atlas(es)`.)

**Step 3 — Verify flag deleted:**

```bash
ls ~/dev/disney-solitaire-content-poc/admin/data/force-repack.flag 2>&1
# → "No such file or directory"
```

---

## §G · Failure isolation

Repack failures must not block the asset write — PNG bytes still
commit, `result.failures` records the atlas, `Debug.LogWarning` (not
Error) is emitted.

**Step 1 — Set `TestAtlas` MaxTextureSize = 32 (Unity Inspector or via
`execute_code`):**

```csharp
var atlas = UnityEditor.AssetDatabase.LoadAssetAtPath<UnityEngine.U2D.SpriteAtlas>("Assets/Art/_TestAtlases/TestAtlas.spriteatlas");
var ps = atlas.GetPlatformSettings("DefaultTexturePlatform");
ps.maxTextureSize = 32;
atlas.SetPlatformSettings(ps);
UnityEditor.EditorUtility.SetDirty(atlas);
UnityEditor.AssetDatabase.SaveAssets();
```

**Step 2 — Apply a 64-px member PNG (re-use §C Step 1 with a fresh
yellow PNG).**

**Expected:**
- `[Apply] Repacking 1 affected atlas(es)...` still logged.
- `Debug.LogWarning` (NOT Error) referencing the atlas (Unity may
  silently downsample on 2022.3 — in which case repack succeeds and
  no warning fires; this is acceptable).
- `last-applied.json.succ = 1`, PNG bytes still on disk.
- `last-applied.json.failures` may contain `"atlas-repack: ..."` when
  Unity does NOT silently downsample.

> Caveat: Unity 2022.3's `SpriteAtlasUtility.PackAtlases` is lenient
> about size constraints — it often downsamples without raising. The
> contract checked here is "failure does not throw / does not block
> asset write", not "Unity refuses oversized sprites".

---

## §H · Post-cleanup

Restore Solitaire to its natural 0-atlas state.

**Step 1 — Delete fixture (Unity MCP `execute_code`):**

```csharp
UnityEditor.AssetDatabase.DeleteAsset("Assets/Art/_TestAtlases");
UnityEditor.AssetDatabase.Refresh();
Solitaire.Content.Editor.ContentSyncToWebMenu.Sync();
```

**Step 2 — Verify membership reverts to `{}`:**

```bash
cat ~/dev/disney-solitaire-content-poc/admin/data/sprite-atlas-membership.json
# → {}
```

**Step 3 — Apply any change under `Assets/Art/`:**

**Expected:**
- Zero `[Apply] Repacking` lines (back to §A behavior).
- `last-applied.json.repackedAtlases` = `[]`.

**Step 4 — Verify repo clean:**

```bash
cd /Volumes/ExtDrive/Works/unitypros/Solitaire && git status -s | grep _TestAtlases
# → (no output — gitignore prevents fixture leakage)
```

---

## Pass/fail

✅ **PASS** when all 8 sections (§A–§H) complete with the expected
output above. Solitaire's natural state matches §A; §H restores it.
The remaining 6 sections (§B–§G) exercise the feature end-to-end on
a synthetic fixture and tear it down.

## Notes / caveats

- **Solitaire is a 0-atlas project today.** Feature is dormant — §A
  + §H bracket the live behavior; §B–§G validate the implementation
  against a fixture. Any project that ships atlases natively will
  see §C/§F/§G fire on real Apply flows.
- **Default ON, absent = ON.** Removing `spriteAtlasAutoRepack` from
  `manifest.json` does NOT disable the feature — back-compat with v5
  configs. Only an explicit `false` opts out.
- **`Assets/Art/` allow-list.** `IsSafeTargetPath` only accepts
  `Assets/Art/` prefixes. The fixture lives at
  `Assets/Art/_TestAtlases/` for this reason; leading `_` keeps Unity
  from inventorying it in normal sync flows, and `.gitignore` keeps
  it out of commits.
- **Failure isolation is lenient.** Unity 2022.3 often downsamples
  oversized sprites silently, so §G may pass without firing a
  warning. The hard contract is "failure does not block PNG write".
