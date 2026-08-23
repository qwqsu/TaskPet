/**
 * 桌宠原生拖拽的纯计算模块。
 * 使用 Main Process 的 DIP 鼠标坐标和固定窗口尺寸，避免 Renderer 坐标混用导致窗口越拖越大。
 */
function finiteNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TypeError(`${label} must be finite`);
  return numeric;
}

function positiveInteger(value, label) {
  const numeric = Math.round(finiteNumber(value, label));
  if (numeric <= 0) throw new RangeError(`${label} must be positive`);
  return numeric;
}

function createPetDragSession({ windowBounds, cursorPoint, windowSize }) {
  // 冻结起点，后续位置始终相对同一原点计算，不累计上一帧舍入误差。
  return Object.freeze({
    windowX: Math.round(finiteNumber(windowBounds?.x, "windowBounds.x")),
    windowY: Math.round(finiteNumber(windowBounds?.y, "windowBounds.y")),
    cursorX: finiteNumber(cursorPoint?.x, "cursorPoint.x"),
    cursorY: finiteNumber(cursorPoint?.y, "cursorPoint.y"),
    width: positiveInteger(windowSize?.width, "windowSize.width"),
    height: positiveInteger(windowSize?.height, "windowSize.height")
  });
}

function petBoundsForCursor(session, cursorPoint) {
  const cursorX = finiteNumber(cursorPoint?.x, "cursorPoint.x");
  const cursorY = finiteNumber(cursorPoint?.y, "cursorPoint.y");
  return {
    x: Math.round(session.windowX + cursorX - session.cursorX),
    y: Math.round(session.windowY + cursorY - session.cursorY),
    width: positiveInteger(session.width, "session.width"),
    height: positiveInteger(session.height, "session.height")
  };
}

module.exports = {
  createPetDragSession,
  petBoundsForCursor
};
