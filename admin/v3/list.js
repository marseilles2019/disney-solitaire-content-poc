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
  return `
    <div class="list-row${sel}${dirty ? ' dirty' : ''}" data-id="${escape(e.id)}">
      <div class="list-thumb" style="${thumbStyle}"></div>
      <div class="list-body">
        <div class="list-name">${escape(e.gameObjectPath.split("/").pop() || e.id)}
          ${dirty ? `<span class="list-row-dirty-tag">⌫ queued · ${d.byteSize}B</span>` : ''}
        </div>
        <div class="list-meta">
          <span class="list-comp list-comp-${e.componentType.toLowerCase()}">${e.componentType}</span>
        </div>
      </div>
    </div>`;
}
window.renderList = renderList;
