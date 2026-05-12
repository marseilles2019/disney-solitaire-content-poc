// Web Admin v2 — Unity design-time asset editor.
//
// State model: load snapshot.json once → render sidebar (sources) + main
// (per-source element list). User drops PNG → store base64 in `state.dirty`.
// Save flow: POST queue-changes with all dirty changes → toast + poll
// last-applied.json.

const state = {
  snapshot: null,
  selectedSourceIdx: 0,
  dirty: new Map(),       // elementId -> { element, sourcePath, targetAssetPath, newBytesBase64, previewObjectUrl }
  lastApplied: null,
  pollHandle: null,
};

const $ = (id) => document.getElementById(id);

async function init() {
  $("v2-refresh-btn").addEventListener("click", refresh);
  $("v2-save-btn").addEventListener("click", saveAll);
  await refresh();
  pollLastApplied();
}

async function refresh() {
  try {
    state.snapshot = await api.fetchSnapshot();
    state.selectedSourceIdx = pickInitialSourceIdx(state.snapshot);
    renderSidebar();
    renderMain();
    toast(`Loaded ${state.snapshot.sources.length} sources · generated ${state.snapshot.generatedAt}`, "info");
  } catch (e) {
    $("v2-sidebar").innerHTML = `<div class="v2-sidebar-empty mono">⚠ ${escape(e.message)}</div>`;
    $("v2-main").innerHTML = `
      <div class="v2-main-empty mono">
        <div style="color: var(--rose); font-weight: 600; margin-bottom: 12px;">Failed to load snapshot</div>
        ${escape(e.message)}<br><br>
        Run Unity menu:<br>
        <code>Tools/Solitaire/Content/Sync to Web Admin</code><br>
        then click ↻ Refresh.
      </div>`;
  }
}

function pickInitialSourceIdx(snap) {
  // Prefer first source with elements; fall back to 0
  for (let i = 0; i < snap.sources.length; i++) {
    if (snap.sources[i].elements.length > 0) return i;
  }
  return 0;
}

// ── Render: sidebar ────────────────────────────────────────────────────

function renderSidebar() {
  const root = $("v2-sidebar");
  const scenes = state.snapshot.sources.filter(s => s.type === "scene");
  const prefabs = state.snapshot.sources.filter(s => s.type === "prefab");

  const section = (title, items) => {
    const rows = items.map(s => {
      const origIdx = state.snapshot.sources.indexOf(s);
      const active = origIdx === state.selectedSourceIdx ? " active" : "";
      const dirtyCount = countDirtyInSource(s);
      const dirtyBadge = dirtyCount > 0
        ? `<span class="v2-sidebar-dirty">${dirtyCount}</span>`
        : "";
      return `
        <div class="collection-nav-item v2-sidebar-row${active}" data-idx="${origIdx}">
          <span class="v2-sidebar-name">${escape(s.displayName)}</span>
          <span class="v2-sidebar-count">${s.elements.length}</span>
          ${dirtyBadge}
        </div>`;
    }).join("");
    return `
      <div class="v2-sidebar-section">
        <div class="v2-sidebar-header">${title} <span class="v2-sidebar-count-total">${items.length}</span></div>
        ${rows || `<div class="v2-sidebar-empty mono">(none)</div>`}
      </div>`;
  };

  root.innerHTML = section("▼ Scenes", scenes) + section("▼ Prefabs", prefabs);
  root.querySelectorAll(".v2-sidebar-row").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedSourceIdx = parseInt(el.dataset.idx, 10);
      renderSidebar();
      renderMain();
    });
  });
}

function countDirtyInSource(src) {
  let n = 0;
  for (const e of src.elements) if (state.dirty.has(e.id)) n++;
  return n;
}

// ── Render: main ──────────────────────────────────────────────────────

function renderMain() {
  const root = $("v2-main");
  const src = state.snapshot.sources[state.selectedSourceIdx];
  if (!src) {
    root.innerHTML = `<div class="v2-main-empty mono">No source selected.</div>`;
    return;
  }

  const builtinCount = src.elements.filter(e => e.isBuiltin).length;
  const replaceableCount = src.elements.filter(e => e.isReplaceable).length;
  const taggedCount = src.elements.filter(e => e.contentTagKey).length;

  const elementsHtml = src.elements.length === 0
    ? `<div class="v2-main-empty mono">(this source has no UI elements)</div>`
    : src.elements.map(e => renderElement(e, src)).join("");

  root.innerHTML = `
    <div class="v2-main-header">
      <div class="v2-main-title">
        <span class="v2-source-type-badge v2-source-type-${src.type}">${src.type}</span>
        ${escape(src.displayName)}
      </div>
      <div class="v2-main-subtitle mono">${escape(src.path)}</div>
      <div class="v2-main-stats">
        <span><b>${src.elements.length}</b> elements</span>
        <span class="v2-stat-builtin">${builtinCount} builtin</span>
        <span class="v2-stat-replaceable">${replaceableCount} replaceable</span>
        <span class="v2-stat-tagged">${taggedCount} v1-tagged</span>
      </div>
    </div>
    <div class="v2-element-list">
      ${elementsHtml}
    </div>`;

  root.querySelectorAll(".v2-replace-btn").forEach(btn => {
    btn.addEventListener("click", () => triggerReplace(btn.dataset.id));
  });
  root.querySelectorAll(".v2-undo-btn").forEach(btn => {
    btn.addEventListener("click", () => undoDirty(btn.dataset.id));
  });
}

function renderElement(e, src) {
  const dirty = state.dirty.get(e.id);
  const thumbUrl = dirty
    ? dirty.previewObjectUrl
    : (e.thumbnailGuid ? api.thumbUrl(e.thumbnailGuid) : null);

  const thumbBlock = thumbUrl
    ? `<img class="v2-element-thumb" src="${thumbUrl}" alt="">`
    : `<div class="v2-element-thumb v2-element-thumb-color" style="background:${e.imageColorHex || '#2a2a3a'}"></div>`;

  const tagBadge = e.contentTagKey
    ? `<span class="v2-tag-badge" title="Already injectable by v1 ContentTag at runtime">tag: ${escape(e.contentTagKey)}</span>`
    : "";

  const slotBadge = e.materialSlot
    ? `<span class="v2-mat-slot-badge mono">${escape(e.materialSlot)}</span>`
    : "";

  let actionHtml;
  if (dirty) {
    actionHtml = `
      <div class="v2-element-dirty">
        ✓ queued · <span class="mono">${escape(dirty.targetAssetPath)}</span> (${formatBytes(dirty.byteSize)})
        <button class="v2-undo-btn" data-id="${escape(e.id)}">undo</button>
      </div>`;
  } else if (!e.isReplaceable) {
    const reason = e.isBuiltin ? "builtin asset (read-only)"
                  : e.currentAssetPath === "(null)" ? "no sprite assigned"
                  : e.currentAssetPath.startsWith("(runtime") ? "runtime texture"
                  : "atlas / non-image source";
    actionHtml = `<div class="v2-element-readonly">read-only · ${reason}</div>`;
  } else {
    actionHtml = `<button class="v2-replace-btn" data-id="${escape(e.id)}">📤 Replace PNG/JPG</button>`;
  }

  return `
    <div class="v2-element ${dirty ? 'v2-element-dirty-row' : ''}">
      ${thumbBlock}
      <div class="v2-element-body">
        <div class="v2-element-meta">
          <span class="v2-component-badge v2-component-${e.componentType.toLowerCase()}">${e.componentType}</span>
          ${slotBadge}
          ${tagBadge}
        </div>
        <div class="v2-element-path mono">${escape(e.gameObjectPath)}</div>
        <div class="v2-element-asset mono">${escape(e.currentAssetPath)}</div>
        ${actionHtml}
      </div>
    </div>`;
}

// ── Replace flow ──────────────────────────────────────────────────────

function triggerReplace(elementId) {
  const el = findElement(elementId);
  if (!el) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".png,.jpg,.jpeg";
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast(`File too large (${formatBytes(file.size)}) · max 10 MB`, "error");
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(bytes);
      const previewObjectUrl = URL.createObjectURL(file);
      const targetAssetPath = inferTargetAssetPath(el.entry);
      if (!targetAssetPath.startsWith("Assets/Art/")) {
        toast(`Cannot replace: target ${targetAssetPath} not under Assets/Art/`, "error");
        return;
      }
      state.dirty.set(elementId, {
        element: el.entry,
        sourcePath: el.sourcePath,
        targetAssetPath,
        newBytesBase64: base64,
        byteSize: file.size,
        previewObjectUrl,
      });
      renderSidebar();
      renderMain();
      updateSaveBtn();
      toast(`Queued · ${file.name} (${formatBytes(file.size)})`, "info");
    } catch (e) {
      toast(`Read failed: ${e.message}`, "error");
    }
  };
  input.click();
}

function inferTargetAssetPath(element) {
  // For replaceable PNG/JPG element, currentAssetPath is the Unity asset path itself.
  return element.currentAssetPath;
}

function undoDirty(elementId) {
  const d = state.dirty.get(elementId);
  if (d && d.previewObjectUrl) URL.revokeObjectURL(d.previewObjectUrl);
  state.dirty.delete(elementId);
  renderSidebar();
  renderMain();
  updateSaveBtn();
}

function updateSaveBtn() {
  const n = state.dirty.size;
  $("v2-save-count").textContent = `(${n})`;
  $("v2-save-btn").disabled = n === 0;
}

async function saveAll() {
  if (state.dirty.size === 0) return;
  const btn = $("v2-save-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    const changes = [];
    for (const [id, d] of state.dirty.entries()) {
      changes.push({
        id,
        actionType: "replace_asset",
        targetAssetPath: d.targetAssetPath,
        newBytesBase64: d.newBytesBase64,
      });
    }
    const result = await api.queueChanges(changes);
    toast(
      `Queued ${result.queuedCount} change(s). 回 Unity Editor → Tools/Solitaire/Content/Apply Web Changes.`,
      "info",
      8000,
    );
    btn.innerHTML = `💾 全局保存 <span id="v2-save-count">(${state.dirty.size})</span>`;
    btn.disabled = false;
  } catch (e) {
    toast(`Save failed: ${e.message}`, "error");
    btn.innerHTML = `💾 全局保存 <span id="v2-save-count">(${state.dirty.size})</span>`;
    btn.disabled = false;
  }
}

function findElement(id) {
  for (const src of state.snapshot.sources) {
    for (const e of src.elements) {
      if (e.id === id) return { entry: e, sourcePath: src.path };
    }
  }
  return null;
}

// ── last-applied polling ──────────────────────────────────────────────

async function pollLastApplied() {
  try {
    const la = await api.getLastApplied();
    if (la && la.appliedAt && (!state.lastApplied || la.appliedAt !== state.lastApplied.appliedAt)) {
      const isFirst = state.lastApplied === null;
      state.lastApplied = la;
      renderLastApplied();
      if (!isFirst && la.appliedChanges > 0) {
        toast(`Unity applied ${la.appliedChanges} change(s) at ${la.appliedAt}. Refreshing…`, "success", 6000);
        for (const d of state.dirty.values()) {
          if (d.previewObjectUrl) URL.revokeObjectURL(d.previewObjectUrl);
        }
        state.dirty.clear();
        updateSaveBtn();
        await refresh();
      }
    } else if (la && la.appliedAt && !state.lastApplied) {
      state.lastApplied = la;
      renderLastApplied();
    }
  } catch (_) {
    // silent
  }
  state.pollHandle = setTimeout(pollLastApplied, 3000);
}

function renderLastApplied() {
  const el = $("v2-last-applied");
  if (!state.lastApplied || !state.lastApplied.appliedAt) {
    el.textContent = "";
    return;
  }
  const la = state.lastApplied;
  el.innerHTML = `<span class="mono">applied ${la.appliedChanges || 0} @ ${escape(la.appliedAt)}</span>`;
}

// ── utils ────────────────────────────────────────────────────────────

function arrayBufferToBase64(buf) {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function toast(msg, kind = "info", ttlMs = 4000) {
  const el = $("v2-toast");
  el.className = `v2-toast v2-toast-${kind} v2-toast-show`;
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = "v2-toast"; }, ttlMs);
}

init();
