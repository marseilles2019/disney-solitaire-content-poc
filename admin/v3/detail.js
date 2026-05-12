import { state, selectedElement, selectedSource } from "./state.js";
import { api } from "./api.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let pendingDrop = null;  // {file, base64, objectUrl, byteSize}

export function renderDetail() {
  const pane = document.getElementById("v3-detail");
  const e = selectedElement();
  if (!e) { pane.innerHTML = `<div style="padding:40px;color:var(--text-dim);">Select an element</div>`; return; }

  const isReplaceable = e.isReplaceable;
  const thumbSrc = e.thumbnailGuid ? api.thumbUrl(e.thumbnailGuid) : null;
  const thumbHtml = thumbSrc
    ? `<img src="${thumbSrc}" style="width:60%;aspect-ratio:1;border-radius:8px;">`
    : `<div style="width:60%;aspect-ratio:1;border-radius:8px;background:${escape(e.imageColorHex || '#d8c3a0')};"></div>`;

  let cta;
  if (pendingDrop) {
    cta = renderConfirmCard(e);
  } else if (isReplaceable) {
    cta = `
      <button class="detail-replace-btn" id="v3-replace-btn">📤 Replace PNG/JPG</button>
      <div class="dropzone-hint" id="v3-detail-dropzone">
        <b>… or drag a PNG/JPG here</b>
        <div class="dropzone-hint-mini">→ writes to ${escape(e.currentAssetPath)}</div>
      </div>`;
  } else {
    cta = `<div class="detail-readonly">read-only · ${e.isBuiltin ? 'builtin asset' : (e.contentTagKey ? 'managed by v1 ContentTag' : 'no sprite assigned')}</div>`;
  }

  pane.innerHTML = `
    <div class="detail-thumb-wrap">${thumbHtml}</div>
    <div class="detail-breadcrumb mono">${escape(e.gameObjectPath)}</div>
    <div class="detail-badges">
      <span class="v2-component-badge v2-component-${e.componentType.toLowerCase()}">${e.componentType}</span>
      ${e.contentTagKey ? `<span class="v2-tag-badge">tag: ${escape(e.contentTagKey)}</span>` : ''}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Asset</div>
      <div class="detail-kv">
        <span class="k">path</span><span class="v">${escape(e.currentAssetPath)}</span>
        <span class="k">guid</span><span class="v">${escape(e.currentAssetGuid || '—')}</span>
      </div>
    </div>
    ${cta}`;

  wireDetail(e);
}

function renderConfirmCard(e) {
  return `
    <div class="drop-confirm">
      <div class="drop-confirm-header">📥 Replace this element?</div>
      <div class="drop-confirm-preview">
        <img class="drop-confirm-thumb" src="${pendingDrop.objectUrl}">
        <div>
          <div class="drop-confirm-filename">${escape(pendingDrop.file.name)}</div>
          <div class="drop-confirm-meta">${pendingDrop.byteSize} B · ${pendingDrop.file.type}</div>
        </div>
      </div>
      <div class="drop-confirm-target mono">→ ${escape(e.currentAssetPath)}</div>
      <div class="drop-confirm-actions">
        <button class="drop-confirm-btn-cancel" id="v3-drop-cancel">Cancel</button>
        <button class="drop-confirm-btn-apply" id="v3-drop-apply">Apply (queue change)</button>
      </div>
    </div>`;
}

function wireDetail(e) {
  const dz = document.getElementById("v3-detail-dropzone");
  if (dz) {
    dz.addEventListener("dragover", ev => { ev.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
    dz.addEventListener("drop", async ev => {
      ev.preventDefault();
      const f = ev.dataTransfer.files[0];
      if (!f) return;
      await beginConfirmFlow(f);
    });
  }
  const btn = document.getElementById("v3-replace-btn");
  if (btn) btn.addEventListener("click", () => pickFile(beginConfirmFlow));

  const ca = document.getElementById("v3-drop-cancel");
  if (ca) ca.addEventListener("click", cancelPending);
  const ap = document.getElementById("v3-drop-apply");
  if (ap) ap.addEventListener("click", () => applyPending(e));
}

async function beginConfirmFlow(file) {
  if (!/\.(png|jpe?g)$/i.test(file.name)) {
    alert("Only .png / .jpg / .jpeg allowed");
    return;
  }
  const buf = await file.arrayBuffer();
  const base64 = arrayBufferToBase64(buf);
  const objectUrl = URL.createObjectURL(file);
  pendingDrop = { file, base64, objectUrl, byteSize: file.size };
  window.__v3_renderAll();
}

function cancelPending() {
  if (pendingDrop?.objectUrl) URL.revokeObjectURL(pendingDrop.objectUrl);
  pendingDrop = null;
  window.__v3_renderAll();
}

function applyPending(e) {
  state.dirty.set(e.id, {
    targetAssetPath: e.currentAssetPath,
    newBytesBase64: pendingDrop.base64,
    previewObjectUrl: pendingDrop.objectUrl,  // intentionally don't revoke — used for live preview
    byteSize: pendingDrop.byteSize,
    filename: pendingDrop.file.name,
  });
  pendingDrop = null;  // don't revoke; ownership transferred to dirty map
  updateSaveBtn();
  window.__v3_renderAll();
}

function updateSaveBtn() {
  const btn = document.getElementById("v3-save-btn");
  document.getElementById("v3-save-count").textContent = `(${state.dirty.size})`;
  btn.disabled = state.dirty.size === 0;
}

function pickFile(cb) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".png,.jpg,.jpeg";
  inp.onchange = () => { if (inp.files[0]) cb(inp.files[0]); };
  inp.click();
}

function arrayBufferToBase64(buf) {
  let bin = "";
  const arr = new Uint8Array(buf);
  for (let i = 0; i < arr.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
  return btoa(bin);
}

window.renderDetail = renderDetail;
window.__v3_updateSaveBtn = updateSaveBtn;
