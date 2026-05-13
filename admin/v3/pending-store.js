// Pending-changes data layer: in-memory rect patches + undo/redo + debounced flush.
// Pure of DOM concerns. Single dependency: window.fetch.

export function createPendingStore({ apiBaseUrl = "", debounceMs = 400 } = {}) {
  /** @type {Map<string, object>} */
  const patches = new Map();

  /** @type {Array<{ elementId: string, before: object|null, after: object|null }>} */
  const history = [];
  let cursor = 0;        // history[cursor-1] is the most recent applied; history[cursor] is next to redo
  const listeners = new Set();

  // Debounced flush state — per-element pending writes.
  const dirtySet = new Set();      // elementIds to flush
  let flushTimer = null;

  function notify(event) { for (const l of listeners) l(event); }

  function pushHistory(elementId, before, after) {
    // Truncate redo branch
    history.length = cursor;
    history.push({ elementId, before, after });
    cursor = history.length;
  }

  function applyPatchSilent(elementId, patch) {
    if (patch == null) patches.delete(elementId);
    else patches.set(elementId, patch);
    dirtySet.add(elementId);
    scheduleFlush();
    notify();
  }

  function scheduleFlush() {
    if (flushTimer != null) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, debounceMs);
  }

  async function flush() {
    const ids = Array.from(dirtySet);
    dirtySet.clear();
    for (const id of ids) {
      const patch = patches.get(id);
      try {
        await fetch(`${apiBaseUrl}/pending-changes/rect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            rect: patch ?? {
              hasAnchoredX: false, anchoredX: 0,
              hasAnchoredY: false, anchoredY: 0,
              hasWidth: false, width: 0,
              hasHeight: false, height: 0,
            },
          }),
        });
      } catch (e) {
        dirtySet.add(id);       // retry on next flush
        notify({ type: "flush-error", elementId: id, error: e });
      }
    }
  }

  return {
    setRectPatch(elementId, patch) {
      const before = patches.get(elementId) ?? null;
      pushHistory(elementId, before, patch);
      applyPatchSilent(elementId, patch);
    },
    clearRectPatch(elementId) {
      const before = patches.get(elementId) ?? null;
      if (before == null) return;
      pushHistory(elementId, before, null);
      applyPatchSilent(elementId, null);
    },
    getRectPatch(elementId) { return patches.get(elementId) ?? null; },
    canUndo() { return cursor > 0; },
    canRedo() { return cursor < history.length; },
    undo() {
      if (cursor === 0) return;
      cursor -= 1;
      const { elementId, before } = history[cursor];
      applyPatchSilent(elementId, before);
    },
    redo() {
      if (cursor >= history.length) return;
      const { elementId, after } = history[cursor];
      cursor += 1;
      applyPatchSilent(elementId, after);
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    flush,                  // expose for tests / beforeunload
    _patches: patches,      // exposed for testing
  };
}
