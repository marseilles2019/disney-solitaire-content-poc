import { state, selectedSource, overlaySource, isDirty, stateBadge } from "./state.js";

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

  root.innerHTML = `
    <div class="pane-header">
      <div class="pane-header-title">▣ 布局</div>
      <div class="pane-header-subtitle">${escape(src.displayName)}${ov ? ` <span class="v3-overlay-on">+ ${escape(ov.displayName)}</span>` : ""}</div>
      <div class="pane-header-meta">${src.elements.length} 个元素 · ${srcReplaceable} 可替换${ov ? ` · 叠 ${ov.elements.length} 元素` : ""}</div>
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

  // State preset clicks are now wired in sources.js sidebar (one nav point).

  const frame = document.getElementById("v3-canvas-frame");

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
    const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
    const badge = stateBadge(e);
    div.title = `${friendlyName} · ${badge.icon} ${badge.label}`;

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
      const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
      const badge = stateBadge(e);
      div.title = `[${escape(ov.displayName)}] ${friendlyName} · ${badge.icon} ${badge.label}`;

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
      div.addEventListener("click", () => {
        state.selectedElementId = e.id;
        window.__v3_renderAll();
      });
      frame.appendChild(div);
    }
  }
}

function elKind(e) {
  switch (e.resourceState) {
    case "cdn_managed":         return "el-cdn";
    case "tagged_unpublished":  return "el-draft";
    case "static_only":         return "el-static";
    case "dual":                return "el-dual";
    default:                    return "el-locked";
  }
}
window.renderLayout = renderLayout;
