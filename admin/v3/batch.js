// Web Admin v3 — Batch Review modal. Folder drop → matcher chain → queue replace_asset changes.
// Scope rule (per user): matchers only run on selectedSource().elements, never across sources.

import { state, selectedSource } from "./state.js";
import { matchFile } from "./matchers.js";
import { api } from "./api.js";

// Browser-stable file walker via webkitGetAsEntry (Chromium-based browsers).
async function readDataTransferFolder(dt) {
  const items = [...dt.items].filter(i => i.kind === "file");
  const files = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) await walkEntry(entry, "", files);
  }
  return files;
}

async function walkEntry(entry, prefix, out) {
  if (entry.isFile) {
    if (!/\.(png|jpe?g)$/i.test(entry.name)) return;
    const file = await new Promise(res => entry.file(res));
    out.push({ name: file.name, relPath: prefix + file.name, file });
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const children = await new Promise(res => reader.readEntries(res));
    for (const ch of children) await walkEntry(ch, prefix + entry.name + "/", out);
  }
}

let matcherOrder = ["filename", "subpath", "contentTag"];

export async function openBatchFromDataTransfer(dt) {
  const files = await readDataTransferFolder(dt);
  if (files.length === 0) return;
  const elements = selectedSource()?.elements ?? [];
  const rows = files.map(f => {
    const m = matchFile(f, elements, matcherOrder);
    return { file: f, matcherName: m.matcherName, targetIds: m.matchedIds, enabled: m.matchedIds.length > 0 };
  });
  renderModal(rows);
}

function renderModal(rows) {
  const root = document.getElementById("v3-batch-modal");
  const matched = rows.filter(r => r.targetIds.length === 1);
  const ambiguous = rows.filter(r => r.targetIds.length > 1);
  const unmatched = rows.filter(r => r.targetIds.length === 0);

  const matcherChip = (name, on) => {
    const colors = { filename: "var(--emerald)", subpath: "var(--accent)", contentTag: "var(--purple)" };
    const c = colors[name] || "var(--text-muted)";
    return on
      ? `<span class="matcher-chip matcher-chip-on" data-mname="${name}" style="background:color-mix(in srgb,${c} 18%,transparent);color:${c};">⋮⋮ ${name} ✓</span>`
      : `<span class="matcher-chip matcher-chip-off" data-mname="${name}" style="border:1px dashed var(--border-strong);color:var(--text-dim);">+ ${name}</span>`;
  };
  const allMatchers = ["filename", "subpath", "contentTag", "gameObjectName"];
  const chips = [
    ...matcherOrder.map(n => matcherChip(n, true)),
    ...allMatchers.filter(n => !matcherOrder.includes(n)).map(n => matcherChip(n, false)),
  ].join(" → ");

  const totalTargets = matched.reduce((n, r) => n + 1, 0) + ambiguous.reduce((n, r) => n + r.targetIds.length, 0);

  root.innerHTML = `
    <div class="batch-modal">
      <div class="batch-header">
        <div>
          <div class="batch-title">Batch Replace · Review</div>
          <div class="batch-subtitle">${rows.length} files · scope: ${selectedSource()?.displayName ?? "(none)"}</div>
        </div>
        <button class="batch-btn-cancel" data-close>✕</button>
      </div>
      <div class="batch-stats">
        <div class="batch-stat matched"><b>${matched.length}</b>1:1 matched</div>
        <div class="batch-stat conflict"><b>${ambiguous.length}</b>multi-target</div>
        <div class="batch-stat unmatched"><b>${unmatched.length}</b>unmatched</div>
        <div class="batch-stat"><b>${rows.length}</b>files</div>
      </div>
      <div class="batch-rows">
        ${rows.map((r, i) => renderBatchRow(r, i)).join("")}
      </div>
      <div class="batch-footer">
        <div class="batch-strategy">Match order: ${chips}</div>
        <div>
          <button class="batch-btn-cancel" data-close>Cancel</button>
          <button class="batch-btn-apply" id="batch-apply-btn">📤 Queue ${totalTargets} changes →</button>
        </div>
      </div>
    </div>`;
  root.classList.add("open");

  root.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => root.classList.remove("open")));
  document.getElementById("batch-apply-btn").addEventListener("click", () => applyBatch(rows));
}

function renderBatchRow(r, idx) {
  const elements = selectedSource()?.elements ?? [];
  const targets = r.targetIds.map(id => elements.find(e => e.id === id)).filter(Boolean);
  const targetText = targets.length === 0
    ? `<div style="color:var(--rose);">no match</div>`
    : targets.length === 1
      ? `<div>${targets[0].gameObjectPath.split("/").pop()}</div><div class="batch-target-path">${targets[0].currentAssetPath}</div>`
      : `<div style="color:var(--emerald);">${targets.length} targets · all applied</div><div class="batch-target-path">${targets.map(t => t.gameObjectPath.split("/").pop()).join(" · ")}</div>`;
  return `
    <div class="batch-row">
      <div class="batch-row-thumb" style="background:#444;"></div>
      <div>
        <div class="batch-file-name">${r.file.name}</div>
        <div class="batch-file-meta">${r.file.file.size} B · ${r.file.relPath}</div>
      </div>
      <div class="batch-matcher">${r.matcherName ? `<div class="batch-matcher-badge batch-matcher-${r.matcherName.toLowerCase()}">${r.matcherName}</div>` : '—'}</div>
      <div>${targetText}</div>
      <div class="batch-toggle">${r.enabled ? '✓' : '✗'}</div>
    </div>`;
}

async function applyBatch(rows) {
  const changes = [];
  for (const r of rows) {
    if (!r.enabled) continue;
    const elements = selectedSource()?.elements ?? [];
    const buf = await r.file.file.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    for (const id of r.targetIds) {
      const el = elements.find(e => e.id === id);
      if (!el) continue;
      const previewUrl = URL.createObjectURL(r.file.file);
      state.dirty.set(id, {
        targetAssetPath: el.currentAssetPath,
        newBytesBase64: base64,
        previewObjectUrl: previewUrl,
        byteSize: r.file.file.size,
        filename: r.file.name,
      });
      changes.push({ id, actionType: "replace_asset", targetAssetPath: el.currentAssetPath, newBytesBase64: base64 });
    }
  }
  try {
    await api.queueChanges(changes);
    document.getElementById("v3-batch-modal").classList.remove("open");
    window.__v3_updateSaveBtn?.();
    window.__v3_renderAll();
  } catch (e) {
    alert("Batch queue failed: " + e.message);
  }
}

function arrayBufferToBase64(buf) {
  let bin = "";
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(bin);
}

window.openBatchFromDataTransfer = openBatchFromDataTransfer;
// Expose renderModal for manual/Playwright verification (real folder DnD can't be triggered).
window.__v3_renderBatchModal = renderModal;
