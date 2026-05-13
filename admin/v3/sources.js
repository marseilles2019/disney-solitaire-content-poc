import { state, isDirty } from "./state.js";
import { STATE_PRESETS, resolvePreset, findActivePreset } from "./state-presets.js";
import { manifest, prefabUsage, findWorldForPrefab, findComponentLabel, isModalPrefabName, findThumbnail } from "./manifest-store.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function bilingualLabel(displayName, sourcePath) {
  const comp = findComponentLabel(sourcePath);
  if (comp) {
    return `<span class="v3-comp-zh">${escape(comp.label)}</span><span class="v3-comp-en">${escape(comp.labelEn || displayName.replace(/\.(uGUI|prefab)$/i, ""))}</span>`;
  }
  return escape(displayName);
}

function bilingualPresetLabel(preset, resolved) {
  // Chinese label from preset definition + English subtitle from resolved
  // scene/overlay source names. Example: '🏠 主页 · 新章节' + 'HomeMap + ChapterIntro'.
  const sceneSrc = state.snapshot.sources[resolved.sourceIdx];
  const overlaySrc = resolved.overlayIdx != null && resolved.overlayIdx >= 0
    ? state.snapshot.sources[resolved.overlayIdx]
    : null;
  const sceneShort = (sceneSrc?.displayName || "").replace(/\.(uGUI|unity)$/i, "");
  const overlayShort = (overlaySrc?.displayName || "").replace(/\.(uGUI|prefab)$/i, "");
  const en = overlayShort ? `${sceneShort} + ${overlayShort}` : sceneShort;
  return `<span class="v3-comp-zh">${escape(preset.label)}</span><span class="v3-comp-en">${escape(en)}</span>`;
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

function combinedCounts(sceneIdx, overlayIdx) {
  const sc = counts(state.snapshot.sources[sceneIdx]);
  const overlay = overlayIdx != null && overlayIdx >= 0 ? state.snapshot.sources[overlayIdx] : null;
  const oc = overlay ? counts(overlay) : { dirty:0, replaceable:0, total:0, cdn:0, draft:0, conflict:0, locked:0 };
  return {
    dirty: sc.dirty + oc.dirty,
    replaceable: sc.replaceable + oc.replaceable,
    sceneTotal: sc.total,
    overlayTotal: oc.total,
    cdn: sc.cdn + oc.cdn,
    draft: sc.draft + oc.draft,
    conflict: sc.conflict + oc.conflict,
  };
}

function badges(c) {
  return [
    c.cdn      > 0 ? `<span class="v3-state-badge v3-state-cdn"      title="${c.cdn} 已上架">🟢${c.cdn}</span>` : '',
    c.draft    > 0 ? `<span class="v3-state-badge v3-state-draft"    title="${c.draft} 草稿">🟡${c.draft}</span>` : '',
    c.conflict > 0 ? `<span class="v3-state-badge v3-state-conflict" title="${c.conflict} 冲突">⚠${c.conflict}</span>` : '',
    c.dirty    > 0 ? `<span class="v2-sidebar-dirty">${c.dirty}</span>` : '',
  ].join('');
}

function renderThumb(src) {
  const t = findThumbnail(src.path);
  if (t) {
    return `<span class="v3-comp-thumb" aria-hidden="true"><img src="/api/v2/thumbnail/${escape(t.file)}" alt="" width="32" height="32" loading="lazy"></span>`;
  }
  const w = findWorldForPrefab(src.path);
  const icon = w?.icon || "📦";
  return `<span class="v3-comp-thumb" aria-hidden="true"><span class="v3-comp-thumb-fallback">${escape(icon)}</span></span>`;
}

function renderComponentRow(src, i, activePreset) {
  const c = counts(src);
  const active = (i === state.selectedSourceIdx && state.overlaySourceIdx == null && !activePreset) ? " active" : "";
  const locked = c.replaceable === 0 && c.dirty === 0 ? " v3-sidebar-locked" : "";
  return `<div class="collection-nav-item v2-sidebar-row${active}${locked}" data-idx="${i}" title="${escape(src.displayName)} · ${c.total} 个元素">
    ${renderThumb(src)}
    <span class="v2-sidebar-name v2-sidebar-name-bilingual">${bilingualLabel(src.displayName, src.path)}</span>
    ${badges(c)}
    <span class="v2-sidebar-count">${c.total}</span>
  </div>`;
}

function renderWorldSection(world, sources, allPresets, activePreset) {
  // State preset rows for this world (use STATE_PRESETS shape — has sceneAssetPath/overlayPrefabPath).
  const worldPresets = allPresets.filter(p => p.worldId === world.id);
  const presetRows = worldPresets.map(p => {
    const r = resolvePreset(p, state.snapshot);
    if (r.sourceIdx < 0 || (p.overlayPrefabPath && r.overlayIdx < 0)) return "";
    const c = combinedCounts(r.sourceIdx, r.overlayIdx);
    const active = activePreset?.id === p.id ? " active" : "";
    const countDisplay = c.overlayTotal > 0 ? `${c.sceneTotal}+${c.overlayTotal}` : `${c.sceneTotal}`;
    return `<div class="collection-nav-item v2-sidebar-row${active}" data-preset="${p.id}" title="${escape(p.label)} · ${countDisplay} 个元素">
      <span class="v2-sidebar-name v2-sidebar-name-bilingual">${bilingualPresetLabel(p, r)}</span>
      ${badges(c)}
      <span class="v2-sidebar-count">${countDisplay}</span>
    </div>`;
  }).filter(Boolean).join("");

  // Components used in this world only (single-world; cross-world prefabs go to separate bucket).
  const usage = prefabUsage();
  const componentsInWorld = [];
  for (const [prefabPath, entry] of Object.entries(usage)) {
    const inThisWorld = (entry.usedByScenes || []).some(s => world.scenes.includes(s));
    const w = findWorldForPrefab(prefabPath);
    if (inThisWorld && w?.id === world.id) {
      const src = sources.find(s => s.path === prefabPath);
      if (src) componentsInWorld.push({ src, i: sources.indexOf(src) });
    }
  }
  const componentRows = componentsInWorld
    .map(({ src, i }) => renderComponentRow(src, i, activePreset))
    .join("");

  const totalCount = `${worldPresets.length}+${componentsInWorld.length}`;
  return `
    <div class="v2-sidebar-section">
      <div class="v2-sidebar-header">▼ ${escape(world.icon)} ${escape(world.label)}
        <span class="v2-sidebar-count-total">${totalCount}</span>
      </div>
      ${presetRows}
      ${componentRows ? `<div class="v3-sidebar-subheader">组件</div>${componentRows}` : ""}
    </div>`;
}

function renderComponentGroup(label, prefabs, activePreset) {
  const rows = prefabs.map(({ src, i }) => renderComponentRow(src, i, activePreset)).join("");
  return `
    <div class="v2-sidebar-section">
      <div class="v2-sidebar-header">▼ ${escape(label)} <span class="v2-sidebar-count-total">${prefabs.length}</span></div>
      ${rows}
    </div>`;
}

export function renderSources() {
  const root = document.getElementById("v3-sources");
  const sources = state.snapshot.sources;
  const m = manifest();
  if (!m || !m.worlds || m.worlds.length === 0) {
    root.innerHTML = `<div style="padding:16px;color:var(--text-dim);">No worlds in manifest. Configure WebAdminConfig.asset.</div>`;
    return;
  }

  const activePreset = findActivePreset(state.snapshot, state.selectedSourceIdx, state.overlaySourceIdx);
  const allPresets = STATE_PRESETS();
  const usage = prefabUsage();

  // Per-world sections (states + single-world components nested under each world).
  const worldSections = m.worlds
    .map(world => renderWorldSection(world, sources, allPresets, activePreset))
    .join("");

  // Cross-world components — prefabs used in 2+ worlds.
  const crossWorldPrefabs = [];
  for (const prefabPath of Object.keys(usage)) {
    const w = findWorldForPrefab(prefabPath);
    if (w?.id === "_cross") {
      const src = sources.find(s => s.path === prefabPath);
      if (src) crossWorldPrefabs.push({ src, i: sources.indexOf(src) });
    }
  }
  const crossWorldSection = crossWorldPrefabs.length > 0
    ? renderComponentGroup("🌐 跨世界", crossWorldPrefabs, activePreset)
    : "";

  // Orphan components — prefabs not in any world bucket (likely runtime-spawned,
  // dev forgot to sync prefab-usage). Excludes scenes + modals (modals already
  // surface via state preset rows).
  const claimedPrefabPaths = new Set([
    ...Object.keys(usage),  // anything tracked in prefab-usage is claimed by a world or cross-world
  ]);
  const orphanPrefabs = sources
    .map((s, i) => ({ src: s, i }))
    .filter(({ src }) =>
      src.type === "prefab" &&
      !claimedPrefabPaths.has(src.path) &&
      !isModalPrefabName(src.displayName)
    );
  const orphanSection = orphanPrefabs.length > 0
    ? renderComponentGroup("📦 未分类", orphanPrefabs, activePreset)
    : "";

  root.innerHTML = worldSections + crossWorldSection + orphanSection;

  // ── click handlers — preset rows apply scene+overlay combo; idx rows = raw source ──
  root.querySelectorAll("[data-preset]").forEach(el => {
    el.addEventListener("click", () => {
      const p = allPresets.find(x => x.id === el.dataset.preset);
      if (!p) return;
      const r = resolvePreset(p, state.snapshot);
      state.selectedSourceIdx = r.sourceIdx;
      state.overlaySourceIdx = r.overlayIdx ?? null;
      const src = state.snapshot.sources[r.sourceIdx];
      const firstReplaceable = src.elements.find(e => e.resourceState && e.resourceState !== "builtin_placeholder");
      state.selectedElementId = firstReplaceable?.id ?? src.elements[0]?.id ?? null;
      window.__v3_renderAll();
    });
  });

  root.querySelectorAll("[data-idx]").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedSourceIdx = parseInt(el.dataset.idx, 10);
      state.overlaySourceIdx = null;  // raw source pick — no overlay
      const src = state.snapshot.sources[state.selectedSourceIdx];
      const firstReplaceable = src.elements.find(e => e.resourceState && e.resourceState !== "builtin_placeholder");
      state.selectedElementId = firstReplaceable?.id ?? src.elements[0]?.id ?? null;
      window.__v3_renderAll();
    });
  });
}
window.renderSources = renderSources;
