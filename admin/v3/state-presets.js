// State presets — predefined scene+overlay combinations that mirror common
// in-game UI states. Derived at call time from the project manifest (worlds +
// states), so adding a state in `admin/data/manifest.json` is the only change
// needed to surface a new sidebar row.
//
// API surface kept stable across the v4→v5 hardcoded-removal refactor:
//   STATE_PRESETS()                         → array of preset descriptors
//   resolvePreset(preset, snapshot)         → { sourceIdx, overlayIdx }
//   findActivePreset(snapshot, sIdx, oIdx)  → preset | null
//
// Note: previously STATE_PRESETS was a const array; it's now a function call
// because preset data depends on the loaded manifest (async at boot).
//
// Preset shape:
//   {
//     id, label, labelEn,
//     sceneAssetPath,        // matched against snapshot.sources[].path
//     overlayPrefabPath,     // null when no overlay
//     worldId,
//   }

import { manifest } from "./manifest-store.js";

export function STATE_PRESETS() {
  const m = manifest();
  if (!m) return [];
  const worlds = m.worlds || [];
  return (m.states || []).map((s) => {
    const world = worlds.find((w) => w.id === s.worldId);
    const scenePath = world?.scenes?.[0] ?? null;
    const icon = world?.icon ?? "•";
    return {
      id: s.id,
      label: `${icon} ${s.label}`,
      labelEn: s.labelEn || "",
      sceneAssetPath: scenePath,
      overlayPrefabPath: s.overlayPrefab || null,
      worldId: s.worldId,
    };
  });
}

// Resolve a preset against the current snapshot. Returns { sourceIdx, overlayIdx }
// where either may be -1 if no match. Empty overlayPrefabPath (null) → overlayIdx is null.
export function resolvePreset(preset, snapshot) {
  const sources = snapshot?.sources ?? [];
  const sourceIdx = preset.sceneAssetPath
    ? sources.findIndex((s) => s.path === preset.sceneAssetPath)
    : -1;
  const overlayIdx = preset.overlayPrefabPath
    ? sources.findIndex((s) => s.path === preset.overlayPrefabPath)
    : null;
  return { sourceIdx, overlayIdx };
}

// Reverse lookup: given current sourceIdx + overlayIdx, find which preset (if any) matches.
// Used to highlight active preset in the dropdown.
export function findActivePreset(snapshot, sourceIdx, overlayIdx) {
  for (const preset of STATE_PRESETS()) {
    const r = resolvePreset(preset, snapshot);
    if (r.sourceIdx === sourceIdx && (r.overlayIdx ?? null) === (overlayIdx ?? null)) {
      return preset;
    }
  }
  return null;
}
