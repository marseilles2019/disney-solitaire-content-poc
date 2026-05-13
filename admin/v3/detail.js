import { state, selectedElement, selectedSource, persistDirty, isReplaceableEl, stateBadge } from "./state.js";
import { api } from "./api.js";
import { atlasesForAsset, spriteAtlasAutoRepackEnabled } from "./manifest-store.js";

function escape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

let pendingDrop = null;  // {file, base64, objectUrl, byteSize}

export function renderDetail() {
  const pane = document.getElementById("v3-detail");
  const e = selectedElement();
  if (!e) { pane.innerHTML = `<div style="padding:40px;color:var(--text-dim);">选择一个元素以查看详情</div>`; return; }

  // T2 — V6.1: Text elements render typography info, not asset replace.
  if (e.componentType === "Text" && e.text) {
    const t = e.text;
    const lastSeg = (e.gameObjectPath || "").split("/").pop() || e.id;
    const parentPath = (e.gameObjectPath || "").split("/").slice(0, -1).join(" › ") || "(root)";
    const styleBits = [];
    if (t.colorHex) styleBits.push(`color:${escape(t.colorHex)}`);
    if (t.bold) styleBits.push("font-weight:700");
    if (t.italic) styleBits.push("font-style:italic");
    pane.innerHTML = `
      <div class="detail-text-preview" style="${styleBits.join(";")}">
        ${escape(String(t.content || ""))}
      </div>
      <div class="detail-title">${escape(lastSeg)}</div>
      <div class="detail-breadcrumb mono">${escape(parentPath)}</div>
      <div class="detail-badges">
        <span class="v2-component-badge v2-component-text">Text</span>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">Typography</div>
        <div class="detail-kv">
          <span class="k">字号</span><span class="v">${t.fontSize?.toFixed?.(0) ?? escape(t.fontSize)}</span>
          <span class="k">颜色</span><span class="v">${escape(t.colorHex || "—")}</span>
          <span class="k">对齐</span><span class="v">${escape(t.alignment || "—")}</span>
          <span class="k">字体</span><span class="v">${escape(t.fontName || "—")}</span>
          ${t.bold ? `<span class="k">样式</span><span class="v">Bold</span>` : ""}
          ${t.italic ? `<span class="k">样式</span><span class="v">Italic</span>` : ""}
        </div>
      </div>
      <div class="detail-readonly">📝 文字内容由游戏数据 / 本地化决定，不在此处替换</div>
    `;
    return;
  }

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

  // v4 — resource state line + state-aware CTA
  const badge = stateBadge(e);
  const versionSuffix = (e.cdnAssetVersion && e.resourceState === "cdn_managed") ? ` · v${escape(e.cdnAssetVersion)}` : "";
  const stateLine = `<div class="v3-detail-state" style="color:${badge.color}"><b>${badge.icon} ${badge.label}</b>${versionSuffix}</div>`;

  let cta;
  if (pendingDrop) {
    cta = renderConfirmCard(e);
  } else if (!isReplaceableEl(e)) {
    cta = `<div class="detail-readonly">🔒 ${escape(readonlyMessage(e))}</div>`;
  } else if (e.resourceState === "dual") {
    const warn = e.warnings?.[0] || "ContentTag 与 Assets/Art/ 同时存在 · 替换前请联系 dev 解除一边";
    cta = `<div class="detail-warning">⚠ ${escape(warn)}</div>`;
  } else {
    const targetHint = (e.resourceState === "cdn_managed" || e.resourceState === "tagged_unpublished")
      ? `→ 上架到 CDN (${escape(e.cdnAssetPath || "")})`
      : `→ 写入工程 (${escape(e.staticAssetPath || e.currentAssetPath)})`;
    cta = `
      <button class="detail-replace-btn" id="v3-replace-btn">📤 替换图片</button>
      <div class="dropzone-hint" id="v3-detail-dropzone">
        <b>或拖一张 PNG/JPG 到这里</b>
        <div class="dropzone-hint-mini">${targetHint}</div>
      </div>`;
  }

  pane.innerHTML = `
    <div class="detail-thumb-wrap">${thumbHtml}</div>
    <div class="detail-title">${escape(lastSeg)}</div>
    <div class="detail-breadcrumb mono">${escape(parentPath)}</div>
    <div class="detail-badges">
      <span class="v2-component-badge v2-component-${e.componentType.toLowerCase()}">${e.componentType}</span>
      ${e.contentTagKey ? `<span class="v2-tag-badge">tag: ${escape(e.contentTagKey)}</span>` : ''}
    </div>
    ${stateLine}
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
    ${renderAtlasBadge(e)}
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

function renderAtlasBadge(e) {
  if (!e.currentAssetPath) return "";
  const atlases = atlasesForAsset(e.currentAssetPath);
  if (atlases.length === 0) return "";
  const names = atlases.map(p => p.split("/").pop().replace(/\.spriteatlas$/, ""));
  const willRepack = spriteAtlasAutoRepackEnabled();
  const hint = willRepack
    ? "改图后 Apply 会自动 repack 该 atlas · 改图会顺带影响 atlas 内其他 sprite 的 batching 表现"
    : "该 PNG 属于 atlas · 当前 manifest 关闭了自动 repack（CI 接管）";
  return `
    <div class="detail-row atlas-info" title="${willRepack ? '替换 PNG 时 Apply 会自动 repack 这些 atlas' : 'manifest.conventions.spriteAtlasAutoRepack = false'}">
      <span class="k">🧩 Part of atlas</span>
      <span class="v">${names.map(n => `<code>${escape(n)}</code>`).join(", ")}</span>
    </div>
    <div class="detail-hint">${escape(hint)}</div>
  `;
}

function readonlyMessage(e) {
  if (e.isBuiltin) return "Unity 自带占位图 · 这种资源由工程师配置；如要替换请联系 dev 把它换成可编辑的 PNG 资源。";
  if (e.currentAssetPath === "(null)") return "这个元素还没有指定图片 · 联系 dev 在 Unity 里给它赋一张 sprite。";
  if (e.currentAssetPath?.startsWith("(runtime")) return "运行时生成的纹理 · 无法通过这个工具替换。";
  return "暂不可直接替换 · 可能是图集子图或其他特殊资源。";
}

function renderConfirmCard(e) {
  const friendlyName = (e.gameObjectPath || "").split("/").pop() || e.id;
  // Current thumb (existing asset)
  const currentThumbSrc = e.thumbnailGuid ? api.thumbUrl(e.thumbnailGuid) : null;
  const currentThumbHtml = currentThumbSrc
    ? `<img class="drop-confirm-thumb drop-confirm-thumb-current" src="${currentThumbSrc}" alt="当前">`
    : `<div class="drop-confirm-thumb drop-confirm-thumb-current" style="background:${escape(e.imageColorHex || '#d8c3a0')};"></div>`;

  return `
    <div class="drop-confirm">
      <div class="drop-confirm-header">📥 替换 <b>${escape(friendlyName)}</b> 的图片？</div>
      <div class="drop-confirm-compare">
        <div class="drop-confirm-compare-side">
          <div class="drop-confirm-compare-label">当前</div>
          ${currentThumbHtml}
        </div>
        <div class="drop-confirm-compare-arrow">→</div>
        <div class="drop-confirm-compare-side">
          <div class="drop-confirm-compare-label">新</div>
          <img class="drop-confirm-thumb drop-confirm-thumb-new" src="${pendingDrop.objectUrl}" alt="新">
        </div>
      </div>
      <div class="drop-confirm-filename">${escape(pendingDrop.file.name)} · ${pendingDrop.byteSize} B</div>
      <details class="drop-confirm-tech">
        <summary>技术细节</summary>
        <div class="drop-confirm-target mono">写入 → ${escape(e.currentAssetPath)}</div>
      </details>
      <div class="drop-confirm-actions">
        <button class="drop-confirm-btn-cancel" id="v3-drop-cancel">取消</button>
        <button class="drop-confirm-btn-apply" id="v3-drop-apply">替换（加入队列）</button>
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

async function applyPending(e) {
  // v4 — route via /api/v4/replace so backend decides CDN-write vs Assets-queue.
  // The dirty entry stores `route` so save flow (Task 5) can group by destination.
  try {
    const r = await fetch("/api/v4/replace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        elementId: e.id,
        newBytesBase64: pendingDrop.base64,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `replace ${r.status}`);
    state.dirty.set(e.id, {
      targetAssetPath: data.targetPath,
      route: data.route,                    // "cdn" | "assets"
      newBytesBase64: pendingDrop.base64,   // kept for batch flow re-send
      previewObjectUrl: pendingDrop.objectUrl,  // intentionally don't revoke — used for live preview
      byteSize: pendingDrop.byteSize,
      filename: pendingDrop.file.name,
    });
    pendingDrop = null;  // ownership transferred to dirty map
    persistDirty();
    updateSaveBtn();
    window.__v3_renderAll();
  } catch (err) {
    alert("替换失败: " + err.message);
  }
}

export function updateSaveBtn() {
  const btn = document.getElementById("v3-save-btn");
  const span = document.getElementById("v3-save-count");
  const n = state.dirty.size;
  const cdnN    = [...state.dirty.values()].filter(d => d.route === "cdn").length;
  const assetsN = [...state.dirty.values()].filter(d => d.route === "assets").length;

  let label = "💾 全局保存";
  if (n > 0) {
    if (cdnN > 0 && assetsN === 0)      label = `📤 发布 ${cdnN} 到 CDN`;
    else if (assetsN > 0 && cdnN === 0) label = `💾 应用 ${assetsN} 到工程`;
    else if (cdnN > 0 && assetsN > 0)   label = `📤 发布 + 应用 (${cdnN}+${assetsN})`;
  }
  btn.innerHTML = `${label}<span id="v3-save-count">${n > 0 ? ` (${n})` : ""}</span>`;
  btn.disabled = n === 0;
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
