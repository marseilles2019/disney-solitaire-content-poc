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
