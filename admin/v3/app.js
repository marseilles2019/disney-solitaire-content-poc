// Web Admin v3 root entrypoint. Pane renderers (sources/layout/list/detail)
// are wired in Tasks 5/6/7/8 — this file only wires Refresh + initial fetch.

import { state, dirtyCount } from "./state.js";
import { api } from "./api.js";
import { persistDirty, loadPersistedDirty, clearPersistedDirty, restoredDirty } from "./state.js";
import { loadManifest } from "./manifest-store.js";
import "./sources.js";
import "./list.js";
import "./layout.js";
import "./detail.js";
import "./batch.js";

document.getElementById("v3-save-btn").addEventListener("click", async () => {
  if (state.dirty.size === 0) return;

  const btn = document.getElementById("v3-save-btn");
  btn.disabled = true;
  const origLabel = btn.innerHTML;
  btn.textContent = "保存中…";

  try {
    const cdnCount    = [...state.dirty.values()].filter(d => d.route === "cdn").length;
    const assetsCount = [...state.dirty.values()].filter(d => d.route === "assets").length;

    const r = await fetch("/api/v4/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `publish ${r.status}`);

    let msg = "";
    if (data.cdnPublished) {
      msg += `✅ 已上架 v${data.cdnNewVersion} · 玩家 30s 内可见 (${cdnCount} 项)`;
    } else if (cdnCount > 0) {
      msg += `⚠ CDN ${cdnCount} 项已写入但 publish 跳过 (${data.noChanges ? "无变化" : "未发布"})`;
    }
    if (assetsCount > 0) {
      if (msg) msg += " · ";
      msg += `💾 ${assetsCount} 项写入工程 (Unity Watch Mode 自动应用 / 否则切 Unity 点 Apply)`;
    }
    showToast(msg || "无更改", "info");

    for (const d of state.dirty.values())
      if (d.previewObjectUrl) URL.revokeObjectURL(d.previewObjectUrl);
    state.dirty.clear();
    clearPersistedDirty();
    window.__v3_updateSaveBtn?.();
    await refresh();
  } catch (e) {
    showToast("保存失败: " + e.message, "error");
  } finally {
    btn.disabled = state.dirty.size === 0;
    btn.innerHTML = origLabel;
  }
});

function showToast(msg, kind = "info") {
  const el = document.getElementById("v3-toast");
  el.className = `v2-toast v2-toast-${kind} v2-toast-show`;
  el.textContent = msg;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.className = "v2-toast"; }, 6000);
}

async function init() {
  await loadManifest();  // NEW — must load before refresh() so renderers can read manifest
  document.getElementById("v3-refresh-btn").addEventListener("click", refresh);
  await refresh();
  const persisted = loadPersistedDirty();
  if (persisted.length > 0) promptRestoreDirty(persisted);
}

function promptRestoreDirty(persisted) {
  const banner = document.createElement("div");
  banner.className = "v3-restore-banner";
  banner.innerHTML = `
    <div>
      <b>你有 ${persisted.length} 个上次未应用的更改</b>
      <span class="v3-restore-list">${persisted.map(p => p.filename || "(无名)").slice(0, 5).join(" · ")}${persisted.length > 5 ? " …" : ""}</span>
    </div>
    <div class="v3-restore-actions">
      <button id="v3-restore-discard">丢弃</button>
      <button id="v3-restore-resend" disabled title="重发需要重新上传图片（浏览器不允许持久化文件字节）">重发（暂未支持）</button>
    </div>`;
  document.body.appendChild(banner);
  document.getElementById("v3-restore-discard").addEventListener("click", () => {
    clearPersistedDirty();
    banner.remove();
    showToast(`已丢弃 ${persisted.length} 个未应用的更改`, "info");
  });
}

async function refresh() {
  try {
    state.snapshot = await api.fetchSnapshot();
    state.selectedSourceIdx = pickInitialSourceIdx();
    const src = state.snapshot.sources[state.selectedSourceIdx];
    // Auto-pick first REPLACEABLE element (not the often-locked elements[0] like
    // ThemeBackdrop) so the user lands on something they can immediately edit.
    const firstReplaceable = src?.elements?.find(e => e.resourceState && e.resourceState !== "builtin_placeholder");
    state.selectedElementId = firstReplaceable?.id ?? src?.elements?.[0]?.id ?? null;
    renderAll();
  } catch (e) {
    showError(e.message);
  }
}

function pickInitialSourceIdx() {
  const sources = state.snapshot?.sources ?? [];
  // Prefer source with at least one non-locked element
  for (let i = 0; i < sources.length; i++)
    if (sources[i].elements.some(e => e.resourceState && e.resourceState !== "builtin_placeholder")) return i;
  // Otherwise first source with any elements
  for (let i = 0; i < sources.length; i++)
    if (sources[i].elements.length > 0) return i;
  return sources.length > 0 ? 0 : -1;
}

function showError(msg) {
  const layout = document.getElementById("v3-layout");
  layout.innerHTML = "";
  const div = document.createElement("div");
  div.style.cssText = "padding:40px; color:var(--rose);";
  div.textContent = "⚠ " + msg;
  layout.appendChild(div);
}

function renderAll() {
  // Renderers added in Task 5/6/7/8 — guarded so this scaffold runs alone.
  if (window.renderSources) window.renderSources();
  if (window.renderLayout) window.renderLayout();
  if (window.renderList) window.renderList();
  if (window.renderDetail) window.renderDetail();
}

window.__v3_renderAll = renderAll;
window.__v3_state = state;
window.__v3_dirtyCount = dirtyCount;

init();

async function pollLastApplied() {
  try {
    const ws = await api.getWatchState();
    const indicator = document.getElementById("v3-watch-indicator");
    if (indicator) {
      if (ws.watchMode) {
        indicator.innerHTML = '<span style="color:var(--emerald);font-weight:600;">🟢 自动应用</span>';
        indicator.title = "Unity 后台监听中 · 保存后 2s 内自动应用";
      } else {
        indicator.innerHTML = '<span style="color:var(--text-dim);">⚪ 手动应用</span>';
        indicator.title = "需要在 Unity 点 Tools/Solitaire/Content/Apply Web Changes";
      }
    }
    const la = await api.getLastApplied();
    if (la && la.appliedAt && (!state.lastApplied || la.appliedAt !== state.lastApplied.appliedAt)) {
      const wasInitialized = state.lastApplied !== null;
      state.lastApplied = la;
      document.getElementById("v3-last-applied").innerHTML = `<span class="mono">applied ${la.appliedChanges || 0} @ ${la.appliedAt}</span>`;
      if (wasInitialized && la.appliedChanges > 0) {
        for (const d of state.dirty.values())
          if (d.previewObjectUrl) URL.revokeObjectURL(d.previewObjectUrl);
        state.dirty.clear();
        clearPersistedDirty();
        window.__v3_updateSaveBtn?.();
        showToast(`Unity applied ${la.appliedChanges} change(s) · refreshing snapshot`, "success");
        await refresh();
      }
    }
  } catch (_) { /* silent */ }
  setTimeout(pollLastApplied, 3000);
}
pollLastApplied();
