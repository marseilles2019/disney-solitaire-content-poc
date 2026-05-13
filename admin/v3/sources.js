import { state, isDirty } from "./state.js";
import { STATE_PRESETS, resolvePreset, findActivePreset } from "./state-presets.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 中文标签 — 组件 prefab 的人话名字。未在表里的 prefab 仍只显示英文 (degraded
// gracefully). dev 加新 prefab 时往这里补一行即可。
const COMPONENT_ZH = {
  "CardView":            "扑克牌",
  "CoinPill":            "金币药丸",
  "DiscardSlot":         "弃牌堆",
  "DrawPile":            "抽牌堆",
  "LevelBadge":          "等级徽章",
  "PrimaryActionButton": "主操作按钮",
  "RoundIconButton":     "圆形图标按钮",
  "SettingsButton":      "设置按钮",
  "StreakBanner":        "连胜横幅",
  "WildPill":            "万能牌药丸",
  "ChapterStrip":        "章节条",
  "ChapterTitleBadge":   "章节标题徽章",
  "HourlyBonusButton":   "小时奖励按钮",
  "ProgressBadge":       "进度徽章",
  "SubSceneNode":        "子场景节点",
  "SubSceneStage":       "子场景台",
  "RewardChip":          "奖励 chip",
  "ChapterChipPrefab":   "章节 chip",
};

function bilingualLabel(displayName) {
  // Strip ".uGUI" / ".prefab" suffix from displayName lookup
  const key = displayName.replace(/\.(uGUI|prefab)$/i, "");
  const zh = COMPONENT_ZH[key];
  return zh
    ? `<span class="v3-comp-zh">${escape(zh)}</span><span class="v3-comp-en">${escape(key)}</span>`
    : escape(displayName);
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

export function renderSources() {
  const root = document.getElementById("v3-sources");
  const sources = state.snapshot.sources;
  const activePreset = findActivePreset(state.snapshot, state.selectedSourceIdx, state.overlaySourceIdx);

  // ── ▼ 状态 (states) — preset-driven nav, replaces former "Scenes" section ──
  const allPresets = STATE_PRESETS();
  const availablePresets = allPresets
    .map(p => ({ p, r: resolvePreset(p, state.snapshot) }))
    .filter(({ p, r }) => r.sourceIdx >= 0 && (p.overlayPrefabPath == null || r.overlayIdx >= 0));

  const presetRows = availablePresets.map(({ p, r }) => {
    const c = combinedCounts(r.sourceIdx, r.overlayIdx);
    const active = activePreset?.id === p.id ? " active" : "";
    const countDisplay = c.overlayTotal > 0
      ? `${c.sceneTotal}+${c.overlayTotal}`
      : `${c.sceneTotal}`;
    return `<div class="collection-nav-item v2-sidebar-row${active}" data-preset="${p.id}" title="${escape(p.label)} · ${countDisplay} 个元素">
      <span class="v2-sidebar-name v2-sidebar-name-bilingual">${bilingualPresetLabel(p, r)}</span>
      ${badges(c)}
      <span class="v2-sidebar-count">${countDisplay}</span>
    </div>`;
  }).join("");

  // Fallback: scenes with elements but not in any preset (Bootstrap, AtomDemo are 0-element so skip)
  const presetSceneIdxs = new Set(availablePresets.map(({ r }) => r.sourceIdx));
  const orphanScenes = sources
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s.type === "scene" && s.elements.length > 0 && !presetSceneIdxs.has(i));
  const orphanRows = orphanScenes.map(({ s, i }) => {
    const c = counts(s);
    const active = (i === state.selectedSourceIdx && state.overlaySourceIdx == null && !activePreset) ? " active" : "";
    return `<div class="collection-nav-item v2-sidebar-row${active}" data-idx="${i}" title="${escape(s.displayName)} · 原始场景">
      <span class="v2-sidebar-name">🎬 ${escape(s.displayName)}</span>
      ${badges(c)}
      <span class="v2-sidebar-count">${c.total}</span>
    </div>`;
  }).join("");

  // ── ▼ 组件 (prefabs) — exclude modals/overlays (already accessible via
  //    ▼ 状态 preset rows). Leaves the truly reusable atoms: cards, pills,
  //    badges, buttons, strips. ──
  const OVERLAY_NAME_RE = /modal|overlay|popup|toast|dialog/i;
  const prefabs = sources
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.type === "prefab" && !OVERLAY_NAME_RE.test(s.displayName));
  const prefabRows = prefabs.map(({ s, i }) => {
    const c = counts(s);
    const active = (i === state.selectedSourceIdx && state.overlaySourceIdx == null && !activePreset) ? " active" : "";
    const locked = c.replaceable === 0 && c.dirty === 0 ? " v3-sidebar-locked" : "";
    return `<div class="collection-nav-item v2-sidebar-row${active}${locked}" data-idx="${i}" title="${escape(s.displayName)} · ${c.total} 个元素">
      <span class="v2-sidebar-name v2-sidebar-name-bilingual">${bilingualLabel(s.displayName)}</span>
      ${badges(c)}
      <span class="v2-sidebar-count">${c.total}</span>
    </div>`;
  }).join("");

  root.innerHTML = `
    <div class="v2-sidebar-section">
      <div class="v2-sidebar-header">▼ 状态 <span class="v2-sidebar-count-total">${availablePresets.length + orphanScenes.length}</span></div>
      ${presetRows}
      ${orphanRows}
    </div>
    <div class="v2-sidebar-section">
      <div class="v2-sidebar-header">▼ 组件 <span class="v2-sidebar-count-total">${prefabs.length}</span></div>
      ${prefabRows}
    </div>`;

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
