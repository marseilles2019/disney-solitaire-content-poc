// Layout-edit helpers + Moveable bridge.
// T11 lands the pure math helpers. T12 will append createLayoutEditor below.

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
