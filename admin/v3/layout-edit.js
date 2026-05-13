// Layout-edit helpers + Moveable bridge.
// T11 lands the pure math helpers. T12 will append createLayoutEditor below.

import Moveable from "./vendor/moveable.min.mjs";

/**
 * Convert dragged display-px to Unity-reference-space sizeDelta.
 * Single-point anchor: sizeDelta = (px / canvasScale).
 * Stretch anchor:      sizeDelta = (px / canvasScale) - parentAnchorRegion.
 *
 * @param {Object} rect — { anchorMinX, anchorMaxX, anchorMinY, anchorMaxY }
 * @param {Object} parentRect — { width, height } in Unity reference px
 * @param {Object} dragPx — { width, height } in display px
 * @param {number} canvasScale — displayPx / referencePx
 * @returns {{ width: number, height: number }}
 */
export function pxToSizeDelta(rect, parentRect, dragPx, canvasScale) {
  if (!canvasScale || canvasScale <= 0) canvasScale = 1;
  const refWidth = dragPx.width / canvasScale;
  const refHeight = dragPx.height / canvasScale;

  let width, height;
  if (rect.anchorMinX === rect.anchorMaxX) {
    width = refWidth;
  } else {
    const anchorRegionX = parentRect.width * (rect.anchorMaxX - rect.anchorMinX);
    width = refWidth - anchorRegionX;
  }
  if (rect.anchorMinY === rect.anchorMaxY) {
    height = refHeight;
  } else {
    const anchorRegionY = parentRect.height * (rect.anchorMaxY - rect.anchorMinY);
    height = refHeight - anchorRegionY;
  }
  return { width, height };
}

/**
 * Compute the height that restores the sprite's native pixel ratio,
 * keeping current width. Returns null if sprite metadata missing or invalid.
 */
export function computeNativeRatioHeight(currentWidth, spriteNative) {
  if (!spriteNative) return null;
  if (!(spriteNative.pixelWidth > 0)) return null;
  return currentWidth * (spriteNative.pixelHeight / spriteNative.pixelWidth);
}

// T12 will append createLayoutEditor(...) here.

/**
 * @param {Object} cfg
 * @param {HTMLElement} cfg.containerEl       — absolutely-positioned overlay covering the layout pane
 * @param {Object}      cfg.store             — pending-store instance
 * @param {() => Object} cfg.getSnapshot      — returns current snapshot.json
 * @param {() => number} cfg.getCanvasScale   — display px / Unity reference px
 * @param {() => number} cfg.getGridSize      — 0 | 1 | 4 | 8 in Unity reference px
 * @param {(elementId: string) => HTMLElement|null} cfg.elementResolver — id → DOM
 */
export function createLayoutEditor(cfg) {
  let currentMoveable = null;
  let currentElementId = null;
  let shiftDown = false;

  function dispose() {
    if (currentMoveable) { currentMoveable.destroy(); currentMoveable = null; }
    currentElementId = null;
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
  }

  function describeLock(element) {
    // element is snapshot.json's ExportedElement
    if (element.parentIsLayoutGroup) {
      return { drag: false, resize: false, reason: "parent is a LayoutGroup — edit spacing/padding instead" };
    }
    if (element.selfHasContentSizeFitter) {
      return { drag: true, resize: false, reason: "has ContentSizeFitter — resize is auto-controlled" };
    }
    if (element.selfHasAspectRatioFitter) {
      return { drag: true, resize: false, reason: "has AspectRatioFitter — resize is auto-controlled" };
    }
    return { drag: true, resize: true, reason: "" };
  }

  function select(elementId) {
    if (currentMoveable) { currentMoveable.destroy(); currentMoveable = null; }
    currentElementId = null;
    if (elementId == null) return;

    const targetEl = cfg.elementResolver(elementId);
    if (!targetEl) return;

    const snap = cfg.getSnapshot();
    const exported = findElement(snap, elementId);
    if (!exported) return;

    const lock = describeLock(exported);

    // Visual lock markers (handled by layout.js via classes; we mirror here for safety)
    targetEl.classList.toggle("element-locked-by-layoutgroup", !lock.drag);
    targetEl.title = lock.reason || "";

    if (!lock.drag) return;     // no Moveable instance when fully locked

    currentElementId = elementId;
    const gridSize = cfg.getGridSize() || 0;
    const scale = cfg.getCanvasScale();
    const guidelines = collectGuidelines(targetEl);

    currentMoveable = new Moveable(cfg.containerEl, {
      target: targetEl,
      draggable: true,
      resizable: lock.resize,
      keepRatio: false,
      snappable: true,
      snapThreshold: 6,
      elementGuidelines: guidelines,
      snapGridWidth:  gridSize * scale,    // displayPx
      snapGridHeight: gridSize * scale,
      origin: false,
    });

    currentMoveable
      .on("drag", ({ left, top, target }) => {
        target.style.left = left + "px";
        target.style.top  = top  + "px";
      })
      .on("dragEnd", () => publishCurrent(exported, targetEl))
      .on("resize", ({ target, width, height, drag }) => {
        target.style.width  = width  + "px";
        target.style.height = height + "px";
        target.style.left = drag.left + "px";
        target.style.top  = drag.top  + "px";
      })
      .on("resizeEnd", () => publishCurrent(exported, targetEl));
  }

  function publishCurrent(exported, targetEl) {
    const scale = cfg.getCanvasScale();
    const dragPx = {
      width:  parseFloat(targetEl.style.width)  || exported.rect.worldWidth,
      height: parseFloat(targetEl.style.height) || exported.rect.worldHeight,
    };
    const parentRect = findParentRect(exported, cfg.getSnapshot());
    const sd = pxToSizeDelta(exported.rect, parentRect, dragPx, scale);
    const anchoredX = (parseFloat(targetEl.style.left) || 0) / scale + originOffsetX(exported, parentRect);
    const anchoredY = -((parseFloat(targetEl.style.top) || 0) / scale - originOffsetY(exported, parentRect));
    cfg.store.setRectPatch(exported.id, {
      hasAnchoredX: true, anchoredX,
      hasAnchoredY: true, anchoredY,
      hasWidth:     true, width: sd.width,
      hasHeight:    true, height: sd.height,
    });
  }

  function onKey(e) {
    const newShift = e.shiftKey;
    if (newShift !== shiftDown && currentMoveable) {
      currentMoveable.keepRatio = newShift;
      shiftDown = newShift;
    }
    // Arrow nudge
    if (!currentElementId) return;
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
    if (e.type !== "keydown") return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0);
    const dy = (e.key === "ArrowUp"   ?  step : e.key === "ArrowDown"  ? -step : 0);
    const cur = cfg.store.getRectPatch(currentElementId) ?? {};
    const exported = findElement(cfg.getSnapshot(), currentElementId);
    const baseX = cur.hasAnchoredX ? cur.anchoredX : exported.rect.anchoredX;
    const baseY = cur.hasAnchoredY ? cur.anchoredY : exported.rect.anchoredY;
    cfg.store.setRectPatch(currentElementId, {
      ...cur,
      hasAnchoredX: true, anchoredX: baseX + dx,
      hasAnchoredY: true, anchoredY: baseY + dy,
    });
  }

  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);

  return { select, refresh: () => select(currentElementId), dispose };
}

function findElement(snap, elementId) {
  if (!snap?.sources) return null;
  for (const src of snap.sources)
    for (const el of (src.elements ?? []))
      if (el.id === elementId) return el;
  return null;
}

function findParentRect(exported, snap) {
  const path = exported.gameObjectPath || "";
  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (!parentPath || !snap?.sources) {
    const src = snap?.sources?.find(s => (s.elements ?? []).some(e => e.id === exported.id));
    return { width: src?.canvas?.referenceWidth ?? 1080, height: src?.canvas?.referenceHeight ?? 1920 };
  }
  for (const src of snap.sources) {
    for (const el of (src.elements ?? [])) {
      if (el.gameObjectPath === parentPath && el.rect) {
        return { width: el.rect.width, height: el.rect.height };
      }
    }
  }
  return { width: 1080, height: 1920 };
}

function originOffsetX(exported, parentRect) {
  const r = exported.rect;
  const midNorm = (r.anchorMinX + r.anchorMaxX) / 2;
  return parentRect.width * (midNorm - 0.5);
}

function originOffsetY(exported, parentRect) {
  const r = exported.rect;
  const midNorm = (r.anchorMinY + r.anchorMaxY) / 2;
  return parentRect.height * (midNorm - 0.5);
}

function collectGuidelines(targetEl) {
  // Every other layout-element div in the same containing canvas.
  const canvas = targetEl.closest("[data-canvas-root]");
  if (!canvas) return [];
  return Array.from(canvas.querySelectorAll("[data-element-id]")).filter(el => el !== targetEl);
}
