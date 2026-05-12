// admin/app.js — main controller

import { api } from "./api.js";

const COLLECTIONS = [
  { id: "homemap", label: "HomeMap 配置", functional: true },
  { id: "cards", label: "卡牌资源", functional: false },
  { id: "backgrounds", label: "章节背景", functional: false },
  { id: "levels", label: "关卡数据", functional: false },
  { id: "i18n", label: "本地化文案", functional: false },
];

const MEDIA_LIBRARY_ID = "media";

const state = {
  current: "homemap",
  status: null,
};

// ─── Sidebar render ──────────────────────────────────────────────────────

function renderSidebar() {
  const nav = document.getElementById("collections-nav");
  nav.innerHTML = "";

  const collTitle = document.createElement("div");
  collTitle.textContent = "Collections";
  collTitle.className = "text-[10px] uppercase tracking-wider text-slate-500 mb-3 font-semibold";
  nav.appendChild(collTitle);

  for (const c of COLLECTIONS) {
    const item = document.createElement("div");
    item.className = "collection-nav-item" + (c.id === state.current ? " active" : "");
    item.textContent = c.label + (c.functional ? "" : " 🔒");
    item.dataset.id = c.id;
    item.addEventListener("click", () => navigate(c.id));
    nav.appendChild(item);
  }

  const mediaTitle = document.createElement("div");
  mediaTitle.textContent = "Media Library";
  mediaTitle.className = "text-[10px] uppercase tracking-wider text-slate-500 mt-6 mb-3 font-semibold";
  nav.appendChild(mediaTitle);

  const media = document.createElement("div");
  media.className = "collection-nav-item" + (state.current === MEDIA_LIBRARY_ID ? " active" : "");
  media.textContent = "媒体库";
  media.addEventListener("click", () => navigate(MEDIA_LIBRARY_ID));
  nav.appendChild(media);
}

// ─── Status indicator ────────────────────────────────────────────────────

async function refreshStatus() {
  try {
    state.status = await api.getStatus();
    const ind = document.getElementById("status-indicator");
    const s = state.status;
    ind.innerHTML = `
      <span class="mono">${s.branch}</span> ·
      <span>↑${s.ahead} ↓${s.behind}</span> ·
      <span class="text-slate-500">${s.dirtyFiles.length} dirty</span>
    `;
  } catch (e) {
    document.getElementById("status-indicator").textContent = "status err: " + e.message;
  }
}

// ─── Routing ─────────────────────────────────────────────────────────────

async function navigate(id) {
  state.current = id;
  renderSidebar();
  const panel = document.getElementById("main-panel");
  panel.innerHTML = "<div class='text-slate-500'>Loading...</div>";

  if (id === "homemap") {
    const { renderHomeMap } = await import("./collections/homemap.js");
    return renderHomeMap(panel);
  }
  if (id === MEDIA_LIBRARY_ID) {
    const { renderMedia } = await import("./collections/media.js");
    return renderMedia(panel);
  }
  const { renderPlaceholder } = await import("./collections/placeholder.js");
  const coll = COLLECTIONS.find(c => c.id === id);
  return renderPlaceholder(panel, coll.label);
}

// ─── Toast ───────────────────────────────────────────────────────────────

export function toast(msg, kind = "ok") {
  const c = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = "toast" + (kind === "error" ? " error" : kind === "warn" ? " warn" : "");
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ─── Boot ────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  renderSidebar();
  await refreshStatus();
  setInterval(refreshStatus, 5000);
  await navigate("homemap");
});

// Expose for collection modules
window.__contentAdmin = { api, toast };

// ─── Publish modal ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("publish-btn");
  btn.disabled = false;
  btn.addEventListener("click", openPublishModal);
});

async function openPublishModal() {
  let status;
  try {
    status = await api.getStatus();
  } catch (e) {
    toast(`git status 失败: ${e.message}`, "error");
    return;
  }
  const dirty = status.dirtyFiles;
  if (dirty.length === 0 && status.ahead === 0) {
    toast("没有变更可 publish", "warn");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "fixed inset-0 bg-black/70 z-50 flex items-center justify-center";
  overlay.innerHTML = `
    <div class="bg-slate-800 border border-white/10 rounded-lg p-8 max-w-xl w-full mx-4">
      <h2 class="text-xl font-semibold mb-4">Publish — 推送到 GitHub</h2>
      <div class="mb-6">
        <div class="field-label mb-2">将提交的变更 (${dirty.length} 项 dirty + ${status.ahead} 项 ahead)</div>
        <div class="bg-slate-900/60 border border-white/5 rounded p-3 max-h-40 overflow-y-auto text-[11px] mono">
          ${dirty.length ? dirty.map(f => `<div class="text-slate-300">M ${f}</div>`).join("") : "<div class='text-slate-500'>(无 dirty file，仅 push ahead commits)</div>"}
        </div>
      </div>
      <div class="field mb-4">
        <span class="field-label">Commit Message</span>
        <input class="field-input" id="pub-msg" value="art: update via admin ${new Date().toISOString().slice(0, 16).replace('T', ' ')}" />
      </div>
      <label class="flex items-center gap-2 mb-6 text-sm">
        <input type="checkbox" id="pub-bump" checked />
        <span>自动 bump <code class="mono text-purple-300">manifest.version</code></span>
      </label>
      <div class="flex gap-3 justify-end">
        <button id="pub-cancel" class="px-4 py-2 rounded border border-white/10 text-slate-300 text-sm hover:bg-white/5">取消</button>
        <button id="pub-confirm" class="publish-btn">Publish</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#pub-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#pub-confirm").addEventListener("click", async () => {
    const msg = overlay.querySelector("#pub-msg").value.trim() || "art: update via admin";
    const bump = overlay.querySelector("#pub-bump").checked;
    const confirm = overlay.querySelector("#pub-confirm");
    confirm.disabled = true;
    confirm.textContent = "Publishing...";
    try {
      const r = await api.publish(msg, bump);
      if (r.noChanges) {
        toast("无变更，未 commit", "warn");
      } else {
        toast(`✓ Publish 完成 · ${r.newCommit.slice(0, 7)} · version ${r.newVersion}`);
      }
      overlay.remove();
      await refreshStatus();
    } catch (e) {
      confirm.disabled = false;
      confirm.textContent = "Publish";
      toast(`Publish 失败: ${e.message} (${e.code})`, "error");
    }
  });
}
