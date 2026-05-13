// Loads project manifest + prefab usage map at boot. All project-specific
// knowledge (worlds, states, labels, conventions) flows through here.

let _manifest = null;
let _prefabUsage = null;
let _thumbnails = null;
let _atlasMembership = null;

export async function loadManifest() {
  const [mResp, pResp, aResp] = await Promise.all([
    fetch("/api/v2/manifest",      { cache: "no-store" }),
    fetch("/api/v2/prefab-usage",  { cache: "no-store" }),
    fetch("/api/v6/sprite-atlas-membership", { cache: "no-store" }),
  ]);
  _manifest      = await mResp.json();
  _prefabUsage   = pResp.ok ? await pResp.json() : {};
  _atlasMembership = aResp.ok ? await aResp.json() : {};
}

export async function loadThumbnails() {
  try {
    const r = await fetch("/api/v2/thumbnails-manifest", { cache: "no-store" });
    _thumbnails = r.ok ? ((await r.json()).thumbnails || {}) : {};
  } catch {
    _thumbnails = {};
  }
}

export function manifest() { return _manifest; }
export function prefabUsage() { return _prefabUsage; }

// Helpers
export function findWorldForPrefab(prefabPath) {
  if (!_manifest || !_prefabUsage[prefabPath]) return null;
  const scenes = _prefabUsage[prefabPath].usedByScenes || [];
  const worldHits = (_manifest.worlds || []).filter(w =>
    (w.scenes || []).some(s => scenes.includes(s))
  );
  if (worldHits.length === 1) return worldHits[0];
  if (worldHits.length > 1) return { id: "_cross", icon: "🌐", label: "跨世界", labelEn: "Cross-World" };
  return null;  // orphan
}

export function findComponentLabel(prefabPath) {
  const comps = _manifest?.components || [];
  return comps.find(c => c.prefab === prefabPath);
}

export function findThumbnail(prefabPath) {
  return _thumbnails ? (_thumbnails[prefabPath] || null) : null;
}

export function findStatesByWorld(worldId) {
  return (_manifest?.states || []).filter(s => s.worldId === worldId);
}

export function isModalPrefabName(displayName) {
  const re = _manifest?.conventions?.modalRegex || "modal|overlay|popup|toast|dialog";
  return new RegExp(re, "i").test(displayName);
}

export function writePathPrefix() {
  return _manifest?.conventions?.writePathPrefix || "Assets/Art/";
}

export function atlasMembership() { return _atlasMembership || {}; }
export function atlasesForAsset(assetPath) {
  if (!assetPath || !_atlasMembership) return [];
  return _atlasMembership[assetPath] || [];
}
export function spriteAtlasAutoRepackEnabled() {
  // Default ON if manifest missing the field (v5 back-compat)
  return _manifest?.conventions?.spriteAtlasAutoRepack !== false;
}
