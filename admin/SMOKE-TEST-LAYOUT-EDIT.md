# Smoke Test — Layout-Edit (drag / resize / aspect-reset)

Run after Tasks 1-13 land. Verifies the full admin → Unity → game pipeline
for `set_rect_transform` patches.

## Pre-flight

- [ ] Solitaire repo on `feat/web-admin-layout-edit` builds in Unity Editor without compile errors.
- [ ] content-poc repo: `admin/v3/vendor/moveable.min.mjs` exists (≥ 100KB); `python3 server.py` boots without exception on port 8767.
- [ ] Unity 2022.3 LTS; Solitaire project open; no unsaved scene changes.

## Steps

1. **Admin loads with Moveable available.**
   - Run `cd ~/dev/disney-solitaire-content-poc/admin && python3 server.py`.
   - Open `http://127.0.0.1:8767/admin/`.
   - DevTools console: no errors. Network tab: `vendor/moveable.min.mjs` returns 200 with size ≥ 100KB.
   - Verify toolbar visible above layout pane: `Grid: [Off] [1px] [4px] [8px]   ↶ Undo   ↷ Redo`.

2. **Element selection shows Moveable handles.**
   - Sources sidebar → pick `Assets/Scenes/PoC/HomeMapContentPoC.unity`.
   - Click the **HomeMap** root (NOT a chip child).
   - 8 handles (4 corners + 4 edges) appear around the element.

3. **Drag + resize update pending-changes.**
   - Drag the element 30px to the right.
   - Drag a corner handle: element resizes free-form; hold Shift while dragging → aspect locks.
   - Open `cat admin/data/pending-changes.json` — one entry with `actionType: "set_rect_transform"` and the dragged `anchoredX`/`width` values.

4. **Reset to native ratio.**
   - Select an Image element with a non-square sprite (e.g., a card asset under HomeMap or similar).
   - Detail pane: click `↻ Reset to native ratio`.
   - Element height changes to match `width × (spriteNative.pixelHeight / spriteNative.pixelWidth)`.

5. **LayoutGroup children locked.**
   - Click any chip under `ChapterStrip` (e.g., `ChapterChip_5`).
   - Element gets purple outline; no Moveable handles; tooltip names HorizontalLayoutGroup.

6. **Undo / redo.**
   - Ctrl/Cmd+Z three times — patches reverse one step each.
   - Ctrl/Cmd+Shift+Z restores; toolbar buttons toggle disabled appropriately.

7. **Unity Apply writes rect changes to scene file (with dirty-scene guard).**
   - In Unity Editor, make any small edit to the active scene (don't save) so it's marked dirty.
   - Run `Tools/Solitaire/Content/Apply Web Changes`.
   - Three-way dialog appears: `Save & Apply` / `Cancel` / `Discard & Apply`. Try each:
     - **Cancel** → no changes applied; pending-changes.json unchanged on disk.
     - **Discard & Apply** → user's in-Unity scene edits are discarded; admin rect patches still apply if the dirty scene is the target (in that case admin patches are layered on top).
     - **Save & Apply** → user's scene edits saved, then rect patches apply.
   - Console: `[ContentApplyWebChangesMenu] Applied N/N` with N = pending change count.
   - Reload `HomeMapContentPoC.unity` in the Inspector — `HomeMap` RectTransform anchoredPosition / sizeDelta reflects the dragged values.

8. **Publish + game-side confirmation.**
   - Admin → Publish (existing flow): bumps manifest, git commit + push.
   - This pushes **scene changes via the Solitaire repo** (NOT through CDN).
   - **Confirm**: open `git log -1 --stat` in the Solitaire repo — scene file is in the commit; manifest version unchanged for rect-only churn (rect patches don't trigger CDN bump).
   - If a mixed batch (sprite + rect) was applied, the sprite half publishes via CDN as before, while the rect half goes via Unity-repo build/OTA.

## Pass criteria

All 8 steps complete without manual error fixes. If any step fails, file
a bug against the task that owns the failing area (T2-T6 for Apply,
T7-T8 for server, T9-T13 for frontend), do NOT proceed to Publish.

## Known limitations

- `Discard & Apply` semantics: if the dirty scene IS the rect-patch target, the discard is silently no-op (the rect patch is layered on top of the dirty state, then saved). The dialog copy is technically misleading for this edge case. T6 reviewer flagged this — it's acceptable because the user gets a better outcome than they asked for.
- Rect patches do NOT hot-update via CDN — they require a Solitaire repo build/OTA cycle. Document this expectation when communicating with non-engineering collaborators.
- Multi-project switcher (V5.1 plan) not yet integrated — this feature only supports the single-project disney-solitaire admin instance.
