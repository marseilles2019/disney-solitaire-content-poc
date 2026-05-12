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

  // Detect 0 replaceable globally
  const sources = state.snapshot.sources;
  const globalReplaceable = sources.reduce((n, s) => n + s.elements.filter(e => e.isReplaceable).length, 0);
  const srcReplaceable = src.elements.filter(e => e.isReplaceable).length;

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
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-repl"></span>✓ 可替换</span>
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-tagged"></span>🔒 Unity 自带</span>
      <span class="v3-legend-chip"><span class="v3-legend-swatch v3-legend-swatch-null"></span>○ 未指定</span>
      <span class="v3-legend-hint">悬停元素查看详情 · 点击选中</span>
    </div>`;

  root.innerHTML = `
    <div class="pane-header">
      <div class="pane-header-title">▣ 布局</div>
      <div class="pane-header-subtitle">${escape(src.displayName)}</div>
      <div class="pane-header-meta">${src.elements.length} 个元素 · ${srcReplaceable} 可替换</div>
    </div>
    ${emptyStateBanner}
    ${legend}
    <div class="canvas-area">
      <div class="canvas-frame-wrap" style="aspect-ratio:${refW}/${refH}">
        <div class="canvas-frame" id="v3-canvas-frame"></div>
      </div>
    </div>
    <details class="canvas-tech">
      <summary>技术信息</summary>
      <div class="mono">${escape(canvas.renderMode)} · 参考分辨率 ${refW}×${refH}</div>
    </details>`;

  const frame = document.getElementById("v3-canvas-frame");

  for (const e of src.elements) {
    if (!e.rect) continue;
    const div = document.createElement("div");
    div.className = `el ${elKind(e)}${e.id === state.selectedElementId ? ' selected' : ''}${isDirty(e.id) ? ' dirty' : ''}`;
    div.dataset.id = e.id;
    const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
    const statusText = e.isReplaceable
      ? "✓ 可替换"
      : e.isBuiltin ? "🔒 Unity 自带"
      : e.currentAssetPath === "(null)" ? "○ 未指定图片"
      : "🔒 不可替换";
    div.title = `${friendlyName} · ${statusText}`;

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
