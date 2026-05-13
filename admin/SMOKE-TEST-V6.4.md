# Web Admin v6.4 — Component Thumbnails Smoke

**Date:** 2026-05-12
**Scope:** Unity Editor exporter + server endpoints + sidebar render.

## 1. Editor — Sync writes artifacts

- [ ] `Tools/Solitaire/Content/Sync to Web Admin` runs without error.
- [ ] `admin/data/thumbnails/` contains N PNGs where N ≈ manifest.components.length.
- [ ] `admin/data/thumbnails.json` has `generatedAt` + `thumbnails` keys.
- [ ] Console log shows `[ContentThumbnailExporter] thumbnails: X cached, Y regenerated, Z failed`.
- [ ] Re-running Sync without touching prefabs → `regenerated == 0` and elapsed < 2s for exporter step.

> **Status 2026-05-12:** exporter ship-ready (commits 2f9753c, 42a37ab in `Solitaire`). Awaiting first Unity Sync run to populate `admin/data/thumbnails/`. Until then, manifest is empty → all rows render emoji fallbacks (graceful, see §3).

## 2. Server endpoints

- [x] `GET /api/v2/thumbnails-manifest` → 200 JSON with `thumbnails` key. Verified empty fallback: `{"thumbnails": {}}` when `admin/data/thumbnails.json` absent.
- [x] `GET /api/v2/thumbnail/<16hex>.png` → 200 PNG, `Cache-Control: public, max-age=31536000, immutable`. Verified with fixture `abcd1234ef567890.png` (1×1 PNG).
- [x] `GET /api/v2/thumbnail/../../../etc/passwd` → 400 `invalid_name`.
- [x] `GET /api/v2/thumbnail/0000000000000000.png` → 404 (valid shape, no file).
- [x] `GET /api/v2/thumbnail/bad.png` → 400 (invalid shape — regex `[a-f0-9]{16}\.png`).
- [x] `GET /api/v2/thumbnail/fixture00000000.png` → 400 (i/x outside hex range).
- [x] After `rm admin/data/thumbnails.json`, `GET /api/v2/thumbnails-manifest` → 200 `{"thumbnails":{}}`.

## 3. Frontend sidebar

Verified via Playwright MCP browser session against `http://127.0.0.1:8767/v3/` on 2026-05-12.

### 3a. Real-image path (fixture manifest, one entry for `Assets/Prefabs/UI/Atoms/CardView.prefab`)

```
apiCount: 1
domImgCount: 1
domFallbackCount: 16
compRowCount: 17
firstImgSrc: /api/v2/thumbnail/abcd1234ef567890.png
imgLoaded: true     (image actually rendered, naturalWidth > 0)
console errors: 0
```

Contract holds: `domImgCount + domFallbackCount === compRowCount` (17 = 1 + 16); `domImgCount === apiCount`; every row has exactly one thumb slot.

### 3b. All-fallback path (`thumbnails.json` removed, manifest empty)

```
apiCount: 0
domImgCount: 0
domFallbackCount: 17
compRowCount: 17
iconCounts: { "🏠": 5, "🎮": 4, "🌐": 3, "📦": 5 }
console errors: 0
```

All four spec-§4.3 fallback icons surface correctly:
- 🏠 home world (5 single-world components in `home`)
- 🎮 gameplay world (4 single-world components in `gameplay`)
- 🌐 cross-world prefabs (3 — used by ≥2 worlds, e.g. `CardView`, `CoinPill`)
- 📦 orphan (5 — not in any world's `usedByScenes` map)

- [x] `http://127.0.0.1:8767/v3/` shows 32×32 left-aligned thumbs on every component row.
- [x] DOM counts: `.v3-comp-thumb img + .v3-comp-thumb-fallback == (# component rows)`.
- [x] Removing `admin/data/thumbnails.json` falls back to emoji icons; console has zero JS errors.
- [ ] Bilingual name + badges + count remain correctly aligned (manual visual gate — pending screenshot review after first Unity Sync populates real 96×96 thumbs).

## 4. Artist UX (informal — gated on real Unity Sync)

- [ ] Without reading filenames, a tester can locate "扑克牌" / "金币药丸" / "设置按钮" in < 2 seconds.

## Implementation notes

**Files modified (Tasks 4–6):**
- `admin/v3/manifest-store.js` — added `loadThumbnails()` + `findThumbnail(prefabPath)` (Task 4).
- `admin/v3/app.js` — `init()` now does `Promise.all([loadManifest(), loadThumbnails()])` (Task 4).
- `admin/v3/sources.js` — `renderThumb(src)` helper, called from `renderComponentRow`. Fallback contract documented inline (Task 5).
- `admin/v3/styles.css` — appended `.v3-comp-thumb` / `.v3-comp-thumb img` / `.v3-comp-thumb-fallback` rules (Task 4).

**Defense-in-depth observed:** server filename regex `[a-f0-9]{16}\.png` strictly enforced — any non-hex chars rejected with 400 before disk access. Path traversal (`../etc/passwd`) returns 400 same path. The fixture had to be renamed from `fixture00000000.png` (i/x reject) to `abcd1234ef567890.png` to load.
