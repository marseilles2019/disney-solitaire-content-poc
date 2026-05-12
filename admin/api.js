// admin/api.js — fetch wrappers for /api/*

const BASE = "";  // relative path; same-origin

async function jsonGet(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }));
    throw Object.assign(new Error(body.error || `HTTP ${r.status}`), { code: body.errorCode });
  }
  return r.json();
}

async function jsonPost(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) {
    throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { code: data.errorCode });
  }
  return data;
}

export const api = {
  getManifest: () => jsonGet("/api/manifest"),
  getContentMap: () => jsonGet("/api/content-map"),
  getMedia: (dir) => jsonGet(`/api/media?dir=${encodeURIComponent(dir || "assets")}`),
  getMediaUrl: (path) => `/api/media-file?path=${encodeURIComponent(path)}`,
  getStatus: () => jsonGet("/api/status"),
  upload: (targetPath, bytesBase64) => jsonPost("/api/upload", { targetPath, bytesBase64 }),
  saveManifest: (manifest) => jsonPost("/api/save-manifest", manifest),
  saveContentMap: (contentMap) => jsonPost("/api/save-content-map", contentMap),
  publish: (commitMessage, bumpVersion = true) => jsonPost("/api/publish", { commitMessage, bumpVersion }),
};
