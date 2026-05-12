import { state, selectedSource, isDirty } from "./state.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderList() {
  const root = document.getElementById("v3-list");
  const src = selectedSource();
  if (!src) { root.innerHTML = ""; return; }
  root.innerHTML = `
    <div class="pane-header">
      <div class="pane-header-title">≡ List</div>
      <div class="pane-header-subtitle">${src.elements.length} elements</div>
    </div>
    <div class="list-dropzone-hint" id="v3-list-dropzone">
      📁 <b>Drop a folder here</b> for batch replace
      <div style="font-size:10px;color:var(--text-dim);">matches: filename → subpath → ContentTag</div>
    </div>
    <div class="list-rows" id="v3-list-rows">
      ${src.elements.map(renderRow).join("")}
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

function renderRow(e) {
  const sel = e.id === state.selectedElementId ? " selected" : "";
  const dirty = isDirty(e.id);
  const d = dirty ? state.dirty.get(e.id) : null;
  const thumbStyle = dirty && d.previewObjectUrl ? `background-image:url('${d.previewObjectUrl}');background-size:cover;` : "";
  // Status icon: ✓ replaceable, 🔒 locked
  const statusIcon = e.isReplaceable
    ? `<span class="list-row-status list-row-status-repl" title="可替换">✓</span>`
    : `<span class="list-row-status list-row-status-lock" title="${escape(readonlyReason(e))}">🔒</span>`;
  // Friendly name: last segment of gameObjectPath
  const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
  return `
    <div class="list-row${sel}${dirty ? ' dirty' : ''}${!e.isReplaceable ? ' readonly' : ''}" data-id="${escape(e.id)}">
      <div class="list-thumb" style="${thumbStyle}"></div>
      <div class="list-body">
        <div class="list-name">${escape(friendlyName)}
          ${dirty ? `<span class="list-row-dirty-tag">⌫ 待发送 · ${d.byteSize}B</span>` : ''}
        </div>
        <div class="list-meta">
          ${statusIcon}
          <span class="list-comp list-comp-${e.componentType.toLowerCase()}">${e.componentType}</span>
        </div>
      </div>
    </div>`;
}

function readonlyReason(e) {
  if (e.isBuiltin) return "Unity 自带占位图 · 联系 dev 替换";
  if (e.currentAssetPath === "(null)") return "尚未指定图片";
  if (e.currentAssetPath?.startsWith("(runtime")) return "运行时纹理";
  return "图集子图等不可直接替换";
}
window.renderList = renderList;
