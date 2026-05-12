import { state, selectedElement, selectedSource } from "./state.js";
import { api } from "./api.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let pendingDrop = null;  // {file, base64, objectUrl, byteSize}

export function renderDetail() {
  const pane = document.getElementById("v3-detail");
  const e = selectedElement();
  if (!e) { pane.innerHTML = `<div style="padding:40px;color:var(--text-dim);">选择一个元素以查看详情</div>`; return; }

  const isReplaceable = e.isReplaceable;
  const thumbSrc = e.thumbnailGuid ? api.thumbUrl(e.thumbnailGuid) : null;
  const thumbHtml = thumbSrc
    ? `<img src="${thumbSrc}" style="width:60%;aspect-ratio:1;border-radius:8px;">`
    : `<div style="width:60%;aspect-ratio:1;border-radius:8px;background:${escape(e.imageColorHex || '#d8c3a0')};"></div>`;

  // Friendly path: last segment as title, full path as subtitle
  const segments = (e.gameObjectPath || "").split("/").filter(Boolean);
  const lastSeg = segments[segments.length - 1] || e.id;
  const parentPath = segments.slice(0, -1).join(" › ") || "(root)";

  // Friendly asset display: hide Resources/unity_builtin_extra: prefix
  const friendlyAsset = friendlyAssetLabel(e);

  let cta;
  if (pendingDrop) {
    cta = renderConfirmCard(e);
  } else if (isReplaceable) {
    cta = `
      <button class="detail-replace-btn" id="v3-replace-btn">📤 替换图片</button>
      <div class="dropzone-hint" id="v3-detail-dropzone">
        <b>或拖一张 PNG/JPG 到这里</b>
        <div class="dropzone-hint-mini">→ 写入 ${escape(e.currentAssetPath)}</div>
      </div>`;
  } else {
    const reasonText = readonlyMessage(e);
    cta = `<div class="detail-readonly">🔒 ${escape(reasonText)}</div>`;
  }

  pane.innerHTML = `
    <div class="detail-thumb-wrap">${thumbHtml}</div>
    <div class="detail-title">${escape(lastSeg)}</div>
    <div class="detail-breadcrumb mono">${escape(parentPath)}</div>
    <div class="detail-badges">
      <span class="v2-component-badge v2-component-${e.componentType.toLowerCase()}">${e.componentType}</span>
      ${e.contentTagKey ? `<span class="v2-tag-badge">tag: ${escape(e.contentTagKey)}</span>` : ''}
    </div>
    <div class="detail-section">
      <div class="detail-section-title">资源</div>
      <div class="detail-kv">
        <span class="k">文件</span><span class="v">${escape(friendlyAsset)}</span>
      </div>
      <details class="detail-tech">
        <summary>技术细节</summary>
        <div class="detail-kv">
          <span class="k">asset path</span><span class="v">${escape(e.currentAssetPath)}</span>
          <span class="k">guid</span><span class="v">${escape(e.currentAssetGuid || '—')}</span>
        </div>
      </details>
    </div>
    ${cta}`;

  wireDetail(e);
}

function friendlyAssetLabel(e) {
  const p = e.currentAssetPath || "";
  if (p === "(null)") return "(尚未指定图片)";
  if (p.startsWith("Resources/unity_builtin_extra")) return "Unity 自带占位图（不可直接替换）";
  if (p.startsWith("(runtime")) return "运行时生成的纹理";
  if (p.startsWith("Assets/")) return p.replace(/^Assets\//, "");
  return p;
}

function readonlyMessage(e) {
  if (e.isBuiltin) return "Unity 自带占位图 · 这种资源由工程师配置；如要替换请联系 dev 把它换成可编辑的 PNG 资源。";
  if (e.currentAssetPath === "(null)") return "这个元素还没有指定图片 · 联系 dev 在 Unity 里给它赋一张 sprite。";
  if (e.currentAssetPath?.startsWith("(runtime")) return "运行时生成的纹理 · 无法通过这个工具替换。";
  return "暂不可直接替换 · 可能是图集子图或其他特殊资源。";
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
