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
