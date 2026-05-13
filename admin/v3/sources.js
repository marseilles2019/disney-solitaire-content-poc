import { state, selectedSource, isDirty } from "./state.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function counts(src) {
  const c = { dirty: 0, replaceable: 0, total: src.elements.length, cdn: 0, draft: 0, conflict: 0, locked: 0 };
  for (const e of src.elements) {
    if (isDirty(e.id)) c.dirty++;
    if (e.resourceState && e.resourceState !== "builtin_placeholder") c.replaceable++;
    if (e.resourceState === "cdn_managed") c.cdn++;
    else if (e.resourceState === "tagged_unpublished") c.draft++;
    else if (e.resourceState === "dual") c.conflict++;
    else if (e.resourceState === "builtin_placeholder") c.locked++;
  }
  return c;
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
        return `<div class="collection-nav-item v2-sidebar-row${active}${locked}" data-idx="${i}">
          <span class="v2-sidebar-name">${escape(s.displayName)}</span>
          ${c.cdn      > 0 ? `<span class="v3-state-badge v3-state-cdn"      title="${c.cdn} 已上架">🟢${c.cdn}</span>` : ''}
          ${c.draft    > 0 ? `<span class="v3-state-badge v3-state-draft"    title="${c.draft} 草稿">🟡${c.draft}</span>` : ''}
          ${c.conflict > 0 ? `<span class="v3-state-badge v3-state-conflict" title="${c.conflict} 冲突">⚠${c.conflict}</span>` : ''}
          ${c.dirty    > 0 ? `<span class="v2-sidebar-dirty">${c.dirty}</span>` : ''}
          <span class="v2-sidebar-count" title="${c.total} 个元素">${c.total}</span>
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
