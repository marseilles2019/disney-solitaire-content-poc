import { state, selectedSource, isDirty } from "./state.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function counts(src) {
  let dirty = 0, replaceable = 0;
  for (const e of src.elements) {
    if (isDirty(e.id)) dirty++;
    if (e.isReplaceable) replaceable++;
  }
  return { dirty, replaceable, total: src.elements.length };
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
        const c = counts(s);
        const active = i === state.selectedSourceIdx ? " active" : "";
        const locked = c.replaceable === 0 && c.dirty === 0 ? " v3-sidebar-locked" : "";
        const replBadge = c.replaceable > 0
          ? `<span class="v3-sidebar-repl" title="${c.replaceable} 个可替换资源">${c.replaceable}</span>`
          : `<span class="v3-sidebar-lock" title="只读 · 无可替换资源">🔒</span>`;
        const dirtyBadge = c.dirty > 0
          ? `<span class="v2-sidebar-dirty">${c.dirty}</span>`
          : "";
        return `<div class="collection-nav-item v2-sidebar-row${active}${locked}" data-idx="${i}">
          <span class="v2-sidebar-name">${escape(s.displayName)}</span>
          ${replBadge}
          <span class="v2-sidebar-count" title="${c.total} 个元素">${c.total}</span>
          ${dirtyBadge}
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
