// Web Admin v3 root entrypoint. Pane renderers (sources/layout/list/detail)
// are wired in Tasks 5/6/7/8 — this file only wires Refresh + initial fetch.

import { state, dirtyCount } from "./state.js";
import { api } from "./api.js";
import "./sources.js";
import "./list.js";
import "./layout.js";
import "./detail.js";
import "./batch.js";

document.getElementById("v3-save-btn").addEventListener("click", async () => {
  if (state.dirty.size === 0) return;
  const changes = [];
  for (const [id, d] of state.dirty.entries()) {
    changes.push({ id, actionType: "replace_asset", targetAssetPath: d.targetAssetPath, newBytesBase64: d.newBytesBase64 });
  }
  try {
    const r = await api.queueChanges(changes);
    showToast(`Queued ${r.queuedCount} change(s) · 回 Unity 点 Apply Web Changes`);
  } catch (e) {
    showToast("Save failed: " + e.message, "error");
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
  document.getElementById("v3-refresh-btn").addEventListener("click", refresh);
  await refresh();
}

async function refresh() {
  try {
    state.snapshot = await api.fetchSnapshot();
    state.selectedSourceIdx = pickInitialSourceIdx();
    const src = state.snapshot.sources[state.selectedSourceIdx];
    state.selectedElementId = src?.elements?.[0]?.id ?? null;
    renderAll();
  } catch (e) {
    showError(e.message);
  }
}

function pickInitialSourceIdx() {
  const sources = state.snapshot?.sources ?? [];
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
