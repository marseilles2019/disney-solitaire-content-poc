// Web Admin v3 — pure data container; no DOM or fetch.

export const state = {
  snapshot: null,
  selectedSourceIdx: 0,
  selectedElementId: null,
  // dirty: Map<elementId, {targetAssetPath, newBytesBase64, previewObjectUrl, byteSize, filename}>
  dirty: new Map(),
  lastApplied: null,
};

export function selectedSource() {
  return state.snapshot?.sources?.[state.selectedSourceIdx] ?? null;
}

export function selectedElement() {
  const src = selectedSource();
  if (!src || !state.selectedElementId) return null;
  return src.elements.find((e) => e.id === state.selectedElementId) ?? null;
}

export function isDirty(id) {
  return state.dirty.has(id);
}

export function dirtyCount() {
  return state.dirty.size;
}

// ── Persistence (P1-5) ───────────────────────────────────────────────
// localStorage key. Stores ONLY the lightweight dirty descriptors
// (id, targetAssetPath, byteSize, filename, sourcePath).
// We DO NOT persist newBytesBase64 (too large) or previewObjectUrl (revoked).
// On restore, dirty items are flagged as `needsResend` so frontend can prompt.

const LS_KEY = "v3.dirtyDescriptors";

export function persistDirty() {
  try {
    const list = [];
    for (const [id, d] of state.dirty.entries()) {
      list.push({
        id,
        targetAssetPath: d.targetAssetPath,
        byteSize: d.byteSize,
        filename: d.filename || "",
        sourcePath: d.sourcePath || "",
      });
    }
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch (_) { /* localStorage may be unavailable in some contexts */ }
}

export function loadPersistedDirty() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

export function clearPersistedDirty() {
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
}

// Map<id, descriptor> for entries restored from localStorage but missing bytes.
export const restoredDirty = new Map();
