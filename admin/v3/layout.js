import { state, selectedSource, isDirty } from "./state.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderLayout() {
  const root = document.getElementById("v3-layout");
  const src = selectedSource();
  if (!src) { root.innerHTML = ""; return; }

  const canvas = src.canvas || { referenceWidth: 1080, referenceHeight: 1920, renderMode: "ScreenSpaceOverlay" };
  const refW = canvas.referenceWidth;
  const refH = canvas.referenceHeight;

  root.innerHTML = `
    <div class="pane-header">
      <div class="pane-header-title">▣ Layout</div>
      <div class="pane-header-subtitle">${escape(src.displayName)}</div>
      <div class="pane-header-meta">${src.elements.length} elements · ${escape(canvas.renderMode)}</div>
    </div>
    <div class="canvas-area">
      <div class="canvas-frame-wrap" style="aspect-ratio:${refW}/${refH}">
        <div class="canvas-frame" id="v3-canvas-frame"></div>
      </div>
    </div>
    <div class="canvas-info mono">ref ${refW}×${refH} · scale ${canvas.scaleFactor ?? 1}</div>`;

  const frame = document.getElementById("v3-canvas-frame");

  for (const e of src.elements) {
    if (!e.rect) continue;
    const div = document.createElement("div");
    div.className = `el ${elKind(e)}${e.id === state.selectedElementId ? ' selected' : ''}${isDirty(e.id) ? ' dirty' : ''}`;
    div.dataset.id = e.id;

    // worldX is screen-pixel center; convert to top-left % within refW×refH
    const leftPct = ((e.rect.worldX - e.rect.worldWidth / 2) / refW) * 100;
    const topPct  = ((refH - e.rect.worldY - e.rect.worldHeight / 2) / refH) * 100;  // flip Y
    const wPct = (e.rect.worldWidth  / refW) * 100;
    const hPct = (e.rect.worldHeight / refH) * 100;

    div.style.cssText = `left:${leftPct}%; top:${topPct}%; width:${wPct}%; height:${hPct}%;`;
    if (isDirty(e.id) && state.dirty.get(e.id).previewObjectUrl) {
      div.style.background = `center/cover no-repeat url('${state.dirty.get(e.id).previewObjectUrl}')`;
    }
    div.addEventListener("click", () => {
      state.selectedElementId = e.id;
      window.__v3_renderAll();
    });
    frame.appendChild(div);
  }
}

function elKind(e) {
  if (e.isReplaceable) return "el-replaceable";
  if (e.isBuiltin || e.contentTagKey) return "el-tagged";
  return "el-null";
}
window.renderLayout = renderLayout;
