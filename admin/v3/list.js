import { state, selectedSource, overlaySource, isDirty, isReplaceableEl, stateBadge } from "./state.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderList() {
  const root = document.getElementById("v3-list");
  const src = selectedSource();
  if (!src) { root.innerHTML = ""; return; }
  const ov = overlaySource();
  // When overlay is active, show overlay elements (top section, primary focus)
  // and main scene elements (bottom section, secondary context). When no
  // overlay, the main scene is the only section.
  const overlayBlock = ov ? `
    <div class="list-section list-section-overlay">
      <div class="list-section-header">
        <span class="list-section-icon">🟣</span>
        <span class="list-section-title">弹窗 · ${escape(ov.displayName.replace(/\.uGUI$/, ''))}</span>
        <span class="list-section-count">${ov.elements.length}</span>
      </div>
      ${ov.elements.map((e) => renderRow(e, "overlay")).join("")}
    </div>` : "";
  const mainBlock = `
    <div class="list-section list-section-main">
      <div class="list-section-header">
        <span class="list-section-icon">🎬</span>
        <span class="list-section-title">场景 · ${escape(src.displayName)}</span>
        <span class="list-section-count">${src.elements.length}</span>
      </div>
      ${src.elements.map((e) => renderRow(e, "main")).join("")}
    </div>`;

  root.innerHTML = `
    <div class="pane-header">
      <div class="pane-header-title">≡ List</div>
      <div class="pane-header-subtitle">${ov ? `${ov.elements.length} 弹窗 + ${src.elements.length} 场景` : `${src.elements.length} 个元素`}</div>
    </div>
    <div class="list-dropzone-hint" id="v3-list-dropzone">
      📁 <b>Drop a folder here</b> for batch replace
      <div style="font-size:10px;color:var(--text-dim);">matches: filename → subpath → ContentTag</div>
    </div>
    <div class="list-rows" id="v3-list-rows">
      ${overlayBlock}
      ${mainBlock}
    </div>`;
  root.querySelectorAll(".list-row").forEach(row => {
    row.addEventListener("click", () => {
      state.selectedElementId = row.dataset.id;
      window.__v3_renderAll();
    });
  });

  const dz = document.getElementById("v3-list-dropzone");
  const rows = document.getElementById("v3-list-rows");
  [dz, rows].forEach(z => {
    if (!z) return;
    z.addEventListener("dragover", ev => { ev.preventDefault(); });
    z.addEventListener("drop", ev => {
      ev.preventDefault();
      window.openBatchFromDataTransfer(ev.dataTransfer);
    });
  });
}

function renderRow(e, scope = "main") {
  const sel = e.id === state.selectedElementId ? " selected" : "";
  const dirty = isDirty(e.id);
  const d = dirty ? state.dirty.get(e.id) : null;
  const thumbStyle = dirty && d.previewObjectUrl ? `background-image:url('${d.previewObjectUrl}');background-size:cover;` : "";
  const badge = stateBadge(e);
  // Friendly name: last segment of gameObjectPath
  const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
  return `
    <div class="list-row${sel}${dirty ? ' dirty' : ''}${!isReplaceableEl(e) ? ' readonly' : ''} list-row-${scope}" data-id="${escape(e.id)}" data-scope="${scope}">
      <div class="list-thumb" style="${thumbStyle}"></div>
      <div class="list-body">
        <div class="list-name">${escape(friendlyName)}
          ${dirty ? `<span class="list-row-dirty-tag">⌫ 待发送 · ${d.byteSize}B</span>` : ''}
        </div>
        <div class="list-meta">
          <span class="list-row-status" style="color:${badge.color}" title="${badge.label}">${badge.icon} ${badge.label}</span>
          <span class="list-comp list-comp-${e.componentType.toLowerCase()}">${e.componentType}</span>
        </div>
      </div>
    </div>`;
}
window.renderList = renderList;
