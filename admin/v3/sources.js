import { state, selectedSource, isDirty } from "./state.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function dirtyCountInSource(src) {
  let n = 0;
  for (const e of src.elements) if (isDirty(e.id)) n++;
  return n;
}

export function renderSources() {
  const root = document.getElementById("v3-sources");
  const scenes  = state.snapshot.sources.filter(s => s.type === "scene");
  const prefabs = state.snapshot.sources.filter(s => s.type === "prefab");

  const section = (title, items) => `
    <div class="v2-sidebar-section">
      <div class="v2-sidebar-header">${title} <span class="v2-sidebar-count-total">${items.length}</span></div>
      ${items.map(s => {
        const i = state.snapshot.sources.indexOf(s);
        const active = i === state.selectedSourceIdx ? " active" : "";
        const dn = dirtyCountInSource(s);
        return `<div class="collection-nav-item v2-sidebar-row${active}" data-idx="${i}">
          <span class="v2-sidebar-name">${escape(s.displayName)}</span>
          <span class="v2-sidebar-count">${s.elements.length}</span>
          ${dn ? `<span class="v2-sidebar-dirty">${dn}</span>` : ""}
        </div>`;
      }).join("")}
    </div>`;

  root.innerHTML = section("▼ Scenes", scenes) + section("▼ Prefabs", prefabs);

  root.querySelectorAll(".v2-sidebar-row").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedSourceIdx = parseInt(el.dataset.idx, 10);
      const first = state.snapshot.sources[state.selectedSourceIdx].elements[0];
      state.selectedElementId = first ? first.id : null;
      window.__v3_renderAll();
    });
  });
}
window.renderSources = renderSources;
