// State presets — predefined scene+overlay combinations that mirror common
// in-game UI states. Each preset is matched against the current snapshot's
// sources by display-name regex; missing sources are silently skipped so
// presets degrade gracefully across project versions.
//
// Future v4.x: per-preset asset overrides (e.g. "in this state, chip_01 shows
// a 'locked' variant"). Today's MVP is purely about which scene + which modal
// to render.

// Short labels — icon already conveys scene; redundant prefix removed.
export const STATE_PRESETS = [
  { id: "home",            label: "🏠 主页",       sourceRe: /^HomeMap/i,   overlayRe: null },
  { id: "home_chapter",    label: "🏠 新章节",     sourceRe: /^HomeMap/i,   overlayRe: /^ChapterIntroOverlay/i },
  { id: "home_levelintro", label: "🏠 关卡介绍",   sourceRe: /^HomeMap/i,   overlayRe: /^LevelIntroModal/i },
  { id: "home_settings",   label: "🏠 设置",       sourceRe: /^HomeMap/i,   overlayRe: /^SettingsOverlay/i },
  { id: "memory_lane",     label: "🏠 记忆回廊",   sourceRe: /^HomeMap/i,   overlayRe: /^MemoryLaneModal/i },
  { id: "gameplay",        label: "🎮 游戏中",     sourceRe: /^Gameplay/i,  overlayRe: null },
  { id: "gameplay_pause",  label: "🎮 暂停",       sourceRe: /^Gameplay/i,  overlayRe: /^SettingsOverlay/i },
  { id: "gameplay_won",    label: "🎮 通关",       sourceRe: /^Gameplay/i,  overlayRe: /^LevelCompleteModal/i },
  { id: "gameplay_lost",   label: "🎮 失败",       sourceRe: /^Gameplay/i,  overlayRe: /^GameOverModal/i },
  { id: "gameplay_toast",  label: "🎮 提示",       sourceRe: /^Gameplay/i,  overlayRe: /^Toast/i },
];

// Resolve a preset against the current snapshot. Returns { sourceIdx, overlayIdx }
// where either may be -1 if no match. Empty regex (null) → overlayIdx is null.
export function resolvePreset(preset, snapshot) {
  const sources = snapshot?.sources ?? [];
  const sourceIdx = sources.findIndex((s) => preset.sourceRe.test(s.displayName));
  const overlayIdx = preset.overlayRe
    ? sources.findIndex((s) => preset.overlayRe.test(s.displayName))
    : null;
  return { sourceIdx, overlayIdx };
}

// Reverse lookup: given current sourceIdx + overlayIdx, find which preset (if any) matches.
// Used to highlight active preset in the dropdown.
export function findActivePreset(snapshot, sourceIdx, overlayIdx) {
  for (const preset of STATE_PRESETS) {
    const r = resolvePreset(preset, snapshot);
    if (r.sourceIdx === sourceIdx && (r.overlayIdx ?? null) === (overlayIdx ?? null)) {
      return preset;
    }
  }
  return null;
}
