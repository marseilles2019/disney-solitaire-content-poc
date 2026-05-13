import { state, selectedSource, overlaySource, selectedElement, isDirty, stateBadge } from "./state.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Layout-edit V7: toolbar, pending-store, dirty/lock visuals ──────────────

let _store = null;
let _editor = null;
let _gridSize = 0;

function getStore() {
  if (_store) return _store;
  // wait until the module export is available (injected in index.html module block)
  if (!window._layoutEdit) return null;
  _store = window._layoutEdit.createPendingStore({ apiBaseUrl: "/api", debounceMs: 400 });
  _store.onChange(() => {
    renderDirtyMarkers();
    const undoBtn = document.getElementById("layout-undo-btn");
    const redoBtn = document.getElementById("layout-redo-btn");
    if (undoBtn) undoBtn.disabled = !_store.canUndo();
    if (redoBtn) redoBtn.disabled = !_store.canRedo();
  });
  return _store;
}

function getEditor() {
  if (_editor) return _editor;
  if (!window._layoutEdit) return null;
  _editor = window._layoutEdit.createLayoutEditor({
    containerEl: document.getElementById("layout-edit-layer"),
    store: getStore(),
    getSnapshot: () => state.snapshot,
    getCanvasScale: () => window._lastCanvasScale || 1,
    getGridSize: () => _gridSize,
    elementResolver: (id) => document.querySelector(`[data-element-id="${CSS.escape(id)}"]`),
  });
  return _editor;
}

function renderDirtyMarkers() {
  const store = getStore();
  if (!store) return;
  const snap = state.snapshot;
  document.querySelectorAll("[data-element-id]").forEach(el => {
    const id = el.dataset.elementId;
    const patch = store.getRectPatch(id);
    el.classList.toggle("element-dirty", patch != null);

    if (!patch || !snap) { el.classList.remove("element-out-of-canvas"); return; }
    const src = snap.sources?.find(s => (s.elements ?? []).some(e => e.id === id));
    if (!src?.canvas) { el.classList.remove("element-out-of-canvas"); return; }
    const exported = src.elements.find(e => e.id === id);
    const w = patch.hasWidth  ? patch.width  : exported?.rect?.width  ?? 0;
    const h = patch.hasHeight ? patch.height : exported?.rect?.height ?? 0;
    const x = patch.hasAnchoredX ? patch.anchoredX : exported?.rect?.anchoredX ?? 0;
    const y = patch.hasAnchoredY ? patch.anchoredY : exported?.rect?.anchoredY ?? 0;
    const halfW = w / 2, halfH = h / 2;
    const canvasW = src.canvas.referenceWidth, canvasH = src.canvas.referenceHeight;
    const outside = Math.abs(x) + halfW > canvasW / 2 || Math.abs(y) + halfH > canvasH / 2;
    el.classList.toggle("element-out-of-canvas", outside);
  });
}

function wireToolbar() {
  document.querySelectorAll(".layout-grid-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".layout-grid-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _gridSize = parseInt(btn.dataset.grid, 10) || 0;
    });
  });
  const undoBtn = document.getElementById("layout-undo-btn");
  const redoBtn = document.getElementById("layout-redo-btn");
  if (undoBtn) undoBtn.addEventListener("click", () => { const s = getStore(); if (s) s.undo(); });
  if (redoBtn) redoBtn.addEventListener("click", () => { const s = getStore(); if (s) s.redo(); });

  const resetBtn = document.getElementById("reset-native-ratio-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const sel = selectedElement();
      if (!sel) return;
      // Preserve the element's current Unity-reference width. Prefer the live
      // store patch (if user already resized), else the snapshot's rect.width
      // (the exporter's source-of-truth in reference px). Do NOT read
      // targetEl.style.width — it's a percentage string and parseFloat would
      // produce a number that's not in px or reference units.
      const store = getStore();
      const cur = store?.getRectPatch(sel.id) ?? null;
      const widthUnity = (cur && cur.hasWidth) ? cur.width : (sel.rect?.width ?? 0);
      if (widthUnity <= 0) return;
      const heightUnity = window._layoutEdit?.computeNativeRatioHeight(widthUnity, sel.spriteNative);
      if (heightUnity == null) return;
      if (!store) return;
      store.setRectPatch(sel.id, {
        hasAnchoredX: false, anchoredX: 0,
        hasAnchoredY: false, anchoredY: 0,
        hasWidth:     true,  width: widthUnity,
        hasHeight:    true,  height: heightUnity,
      });
    });
  }
}

// Keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) — wired once at module load
window.addEventListener("keydown", (e) => {
  const meta = e.ctrlKey || e.metaKey;
  if (!meta) return;
  if (e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    const s = getStore();
    if (s) s.undo();
  } else if (e.key.toLowerCase() === "z" && e.shiftKey) {
    e.preventDefault();
    const s = getStore();
    if (s) s.redo();
  }
});

// beforeunload guard
window.addEventListener("beforeunload", (e) => {
  if (_store && _store._patches.size > 0) {
    e.preventDefault();
    e.returnValue = "";
  }
});

export function renderLayout() {
  const root = document.getElementById("v3-layout");
  const src = selectedSource();
  if (!src) { root.innerHTML = ""; return; }

  const canvas = src.canvas || { referenceWidth: 1080, referenceHeight: 1920, renderMode: "ScreenSpaceOverlay" };
  const refW = canvas.referenceWidth;
  const refH = canvas.referenceHeight;

  // Detect 0 replaceable globally — v4: state-driven (not boolean isReplaceable)
  const sources = state.snapshot.sources;
  const globalReplaceable = sources.reduce(
    (n, s) => n + s.elements.filter(e => e.resourceState && e.resourceState !== "builtin_placeholder").length, 0);
  const srcReplaceable = src.elements.filter(e => e.resourceState && e.resourceState !== "builtin_placeholder").length;

  const emptyStateBanner = globalReplaceable === 0
    ? `<div class="v3-empty-banner">
        <div class="v3-empty-banner-title">这个工程目前没有可替换的 PNG 资源</div>
        <div class="v3-empty-banner-body">
          可能是因为美术资源用了运行时注入（CDN）而非静态 PNG。
          要让资源出现在这里：让工程师把 PNG 放到 <code>Assets/Art/</code> 下并赋给 UI Image，
          然后在 Unity 菜单 <code>Tools/Solitaire/Content/Sync to Web Admin</code>。
          现在能做：浏览 UI 布局结构（下方）/ 查看现有资源分布。
        </div>
      </div>`
    : srcReplaceable === 0
    ? `<div class="v3-empty-banner v3-empty-banner-soft">
        这个页面没有可替换的资源 · 看左侧带 <b>✓ N</b> 的页面找可改的图。
      </div>`
    : "";

  const legend = `
    <div class="v3-layout-legend">
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-cdn"></span>🟢 已上架</span>
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-draft"></span>🟡 草稿</span>
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-static"></span>🔵 工程资源</span>
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-dual"></span>⚠ 冲突</span>
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-locked"></span>🔒 占位</span>
      <span class="v3-legend-hint">点击元素查看详情</span>
    </div>`;

  // State picker now lives in the sidebar (▼ 状态 section). Layout pane is
  // free of chip rows — keeps the main viewport area uncluttered.
  const ov = overlaySource();

  const selEl = selectedElement();

  root.innerHTML = `
    <div class="pane-header">
      <div class="pane-header-title">▣ 布局</div>
      <div class="pane-header-subtitle">${escape(src.displayName)}${ov ? ` <span class="v3-overlay-on">+ ${escape(ov.displayName)}</span>` : ""}</div>
      <div class="pane-header-meta">${src.elements.length} 个元素 · ${srcReplaceable} 可替换${ov ? ` · 叠 ${ov.elements.length} 元素` : ""}</div>
    </div>
    ${emptyStateBanner}
    ${legend}
    <div class="layout-toolbar">
      <div class="layout-grid-control">
        Grid:
        <button data-grid="0"  class="layout-grid-btn${_gridSize === 0  ? ' active' : ''}">Off</button>
        <button data-grid="1"  class="layout-grid-btn${_gridSize === 1  ? ' active' : ''}">1px</button>
        <button data-grid="4"  class="layout-grid-btn${_gridSize === 4  ? ' active' : ''}">4px</button>
        <button data-grid="8"  class="layout-grid-btn${_gridSize === 8  ? ' active' : ''}">8px</button>
      </div>
      <div class="layout-undo-control">
        <button id="layout-undo-btn" ${!(_store && _store.canUndo()) ? 'disabled' : ''}>↶ Undo</button>
        <button id="layout-redo-btn" ${!(_store && _store.canRedo()) ? 'disabled' : ''}>↷ Redo</button>
      </div>
    </div>
    <div class="canvas-area">
      <div class="canvas-frame-wrap" style="aspect-ratio:${refW}/${refH}; position:relative;">
        <div class="canvas-frame" id="v3-canvas-frame" data-canvas-root>
          <div id="layout-edit-layer"></div>
        </div>
      </div>
    </div>
    <div class="reset-control" id="reset-control"${selEl && selEl.spriteNative ? '' : ' hidden'}>
      <button id="reset-native-ratio-btn">↻ Reset to native ratio</button>
    </div>
    <details class="canvas-tech">
      <summary>技术信息</summary>
      <div class="mono">${escape(canvas.renderMode)} · 参考分辨率 ${refW}×${refH}</div>
    </details>`;

  // State preset clicks are now wired in sources.js sidebar (one nav point).

  // Wire toolbar buttons after innerHTML replace.
  wireToolbar();

  // layout-edit-layer is recreated on every renderLayout call — dispose the old
  // Moveable instance and null out the editor so getEditor() rebuilds with the
  // fresh DOM node on next element selection.
  if (_editor) { _editor.dispose(); _editor = null; }

  const frame = document.getElementById("v3-canvas-frame");
  // Use real frame display width so text fontSize scales exactly like Unity's
  // canvas scaler: cssPx = (unityFontSize / refW) * frameDisplayWidth.
  // Previously used `cqi` units, but no container-type was set so they
  // resolved against an outer container (v3-layout pane ~1660px), making
  // text ~3.3× too big.
  const frameDisplayWidth = frame.getBoundingClientRect().width || 480;
  // Expose canvas scale for layout-editor (displayPx / Unity reference px).
  window._lastCanvasScale = frameDisplayWidth / refW;

  // State focus rule: when an overlay is active, scene elements belong to
  // "other states" (shared backdrop). Skip rendering them entirely — only
  // the canvas-frame's cream gradient remains as visual orientation, and
  // the overlay-backdrop dims it further.
  if (ov) {
    // skip scene rendering — fall through to overlay block
  } else {
  for (const e of src.elements) {
    if (!e.rect) continue;
    const div = document.createElement("div");
    div.className = `el ${elKind(e)}${e.id === state.selectedElementId ? ' selected' : ''}${isDirty(e.id) ? ' dirty' : ''}`;
    div.dataset.id = e.id;
    div.dataset.elementId = e.id;  // for elementResolver + collectGuidelines
    if (e.parentIsLayoutGroup) div.classList.add("element-locked-by-layoutgroup");
    const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
    const badge = stateBadge(e);
    div.title = e.parentIsLayoutGroup
      ? `${friendlyName} · 🔒 Controlled by LayoutGroup`
      : `${friendlyName} · ${badge.icon} ${badge.label}`;

    // worldX is screen-pixel center; convert to top-left % within refW×refH
    const leftPct = ((e.rect.worldX - e.rect.worldWidth / 2) / refW) * 100;
    const topPct  = ((refH - e.rect.worldY - e.rect.worldHeight / 2) / refH) * 100;  // flip Y
    const wPct = (e.rect.worldWidth  / refW) * 100;
    const hPct = (e.rect.worldHeight / refH) * 100;

    div.style.cssText = `left:${leftPct}%; top:${topPct}%; width:${wPct}%; height:${hPct}%;`;
    if (isDirty(e.id) && state.dirty.get(e.id).previewObjectUrl) {
      div.style.background = `center/cover no-repeat url('${state.dirty.get(e.id).previewObjectUrl}')`;
    }
    // Text element: render the actual game text inside the box (T2 — V6.1)
    if (e.componentType === "Text" && e.text && e.text.content) {
      div.classList.add("el-text");
      // Strip TMP rich-text tags for cleaner display (basic regex)
      const cleanText = String(e.text.content).replace(/<[^>]+>/g, "");
      div.textContent = cleanText;
      // Scale Unity canvas fontSize → CSS px proportional to frame display width
      const pxSize = (e.text.fontSize > 0) ? (e.text.fontSize / refW) * frameDisplayWidth : 0;
      if (pxSize > 0) {
        div.style.fontSize = `${Math.max(4, pxSize).toFixed(2)}px`;
      }
      if (e.text.colorHex) div.style.color = e.text.colorHex;
      // Alignment normalization (TMP TextAlignmentOptions + legacy TextAnchor)
      const a = String(e.text.alignment || "Center").toLowerCase();
      div.style.justifyContent = a.includes("right") ? "flex-end" : a.includes("left") ? "flex-start" : "center";
      div.style.alignItems = (a.includes("top") || a.includes("upper")) ? "flex-start" : (a.includes("bottom") || a.includes("lower")) ? "flex-end" : "center";
      if (e.text.bold) div.style.fontWeight = "700";
      if (e.text.italic) div.style.fontStyle = "italic";
    }
    div.addEventListener("click", () => {
      state.selectedElementId = e.id;
      // Render first so #layout-edit-layer is rebuilt; then mount Moveable on
      // the new layer (otherwise renderLayout's dispose() blows away what we
      // just mounted).
      window.__v3_renderAll();
      const editor = getEditor();
      if (editor) editor.select(e.id);
      const resetCtrl = document.getElementById("reset-control");
      if (resetCtrl) resetCtrl.hidden = !e.spriteNative;
    });
    frame.appendChild(div);
  }
  }  // end !ov scene-render branch

  // ── Overlay rendering — render a popup/modal source on top of main scene
  if (ov) {
    // Semi-transparent backdrop dimming the scene
    const backdrop = document.createElement("div");
    backdrop.className = "v3-overlay-backdrop";
    backdrop.title = "弹窗背景（点击空白处可关闭弹窗）";
    backdrop.addEventListener("click", (ev) => {
      // only close if user clicked the backdrop itself, not a modal element above
      if (ev.target === backdrop) {
        state.overlaySourceIdx = null;
        window.__v3_renderAll();
      }
    });
    frame.appendChild(backdrop);

    // Modal prefabs typically have no own Canvas; world coords are around (0,0).
    // Position elements at canvas-center offset so modal renders centered on top.
    const ovCenterX = refW / 2;
    const ovCenterY = refH / 2;
    for (const e of ov.elements) {
      if (!e.rect) continue;
      // Skip the full-bleed Overlay child (worldWidth/Height = 0 means it's a
      // stretching anchor without parent context — would render as 0×0).
      const isStretchHelper = e.rect.worldWidth === 0 && e.rect.worldHeight === 0;
      if (isStretchHelper) continue;
      const div = document.createElement("div");
      div.className = `el el-overlay ${elKind(e)}${e.id === state.selectedElementId ? ' selected' : ''}${isDirty(e.id) ? ' dirty' : ''}`;
      div.dataset.id = e.id;
      div.dataset.elementId = e.id;  // for elementResolver + collectGuidelines
      if (e.parentIsLayoutGroup) div.classList.add("element-locked-by-layoutgroup");
      const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
      const badge = stateBadge(e);
      div.title = e.parentIsLayoutGroup
        ? `[${escape(ov.displayName)}] ${friendlyName} · 🔒 Controlled by LayoutGroup`
        : `[${escape(ov.displayName)}] ${friendlyName} · ${badge.icon} ${badge.label}`;

      // Offset modal world coords by canvas center
      const absX = ovCenterX + e.rect.worldX;
      const absY = ovCenterY + e.rect.worldY;
      const leftPct = ((absX - e.rect.worldWidth / 2) / refW) * 100;
      const topPct  = ((refH - absY - e.rect.worldHeight / 2) / refH) * 100;
      const wPct = (e.rect.worldWidth / refW) * 100;
      const hPct = (e.rect.worldHeight / refH) * 100;
      div.style.cssText = `left:${leftPct}%; top:${topPct}%; width:${wPct}%; height:${hPct}%;`;
      if (isDirty(e.id) && state.dirty.get(e.id).previewObjectUrl) {
        div.style.background = `center/cover no-repeat url('${state.dirty.get(e.id).previewObjectUrl}')`;
      }
      // Text element: render game text inside the box (T2 — V6.1, overlay branch)
      if (e.componentType === "Text" && e.text && e.text.content) {
        div.classList.add("el-text");
        const cleanText = String(e.text.content).replace(/<[^>]+>/g, "");
        div.textContent = cleanText;
        // Same scaling rule as scene branch: cssPx = (unityFontSize / refW) * frameDisplayWidth.
        const pxSize = (e.text.fontSize > 0) ? (e.text.fontSize / refW) * frameDisplayWidth : 0;
        if (pxSize > 0) {
          div.style.fontSize = `${Math.max(4, pxSize).toFixed(2)}px`;
        }
        if (e.text.colorHex) div.style.color = e.text.colorHex;
        const a = String(e.text.alignment || "Center").toLowerCase();
        div.style.justifyContent = a.includes("right") ? "flex-end" : a.includes("left") ? "flex-start" : "center";
        div.style.alignItems = (a.includes("top") || a.includes("upper")) ? "flex-start" : (a.includes("bottom") || a.includes("lower")) ? "flex-end" : "center";
        if (e.text.bold) div.style.fontWeight = "700";
        if (e.text.italic) div.style.fontStyle = "italic";
      }
      div.addEventListener("click", () => {
        state.selectedElementId = e.id;
        // Render first (rebuilds #layout-edit-layer), then mount Moveable.
        window.__v3_renderAll();
        const editor = getEditor();
        if (editor) editor.select(e.id);
        const resetCtrl = document.getElementById("reset-control");
        if (resetCtrl) resetCtrl.hidden = !e.spriteNative;
      });
      frame.appendChild(div);
    }
  }
}

function elKind(e) {
  // Text elements: text content IS the visual — no fill / no locked-style.
  if (e.componentType === "Text") return "el-text-kind";
  switch (e.resourceState) {
    case "cdn_managed":         return "el-cdn";
    case "tagged_unpublished":  return "el-draft";
    case "static_only":         return "el-static";
    case "dual":                return "el-dual";
    default:                    return "el-locked";
  }
}
window.renderLayout = renderLayout;
