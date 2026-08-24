/**
 * 透明桌宠窗口的 Renderer。
 * 负责 spritesheet 动画、状态文字和点击/拖拽；尺寸只由设置页三档预设控制。
 */
const pet = document.getElementById("pet");
const stage = document.querySelector(".stage");
const sprite = document.getElementById("sprite");
const fallback = document.getElementById("fallback");
const petStatus = document.getElementById("petStatus");
const petStatusMessage = document.getElementById("petStatusMessage");
const petStatusDetail = document.getElementById("petStatusDetail");

// ---------- 动画格式与页面内存状态 ----------

const DEFAULT_FRAME = Object.freeze({ width: 192, height: 208, columns: 8, rows: 9 });
const DOUBLE_CLICK_DELAY_MS = 350;
const IDLE_MESSAGES = Object.freeze([
  "ヾ(•ω•`)o",
  "(❁´◡`❁)",
  "(‾◡◝)"
]);
const IDLE_MESSAGE_INTERVAL_MS = 5_000;
const ALLOWED_STATES = new Set([
  "idle",
  "working",
  "done",
  "attention",
  "drag-left",
  "drag-right"
]);
const DEFAULT_ANIMATIONS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  "drag-right": { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  "drag-left": { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  attention: { row: 3, durations: [140, 140, 140, 280] },
  done: { row: 4, durations: [140, 140, 140, 140, 280] },
  working: { row: 7, durations: [120, 120, 120, 120, 120, 220] }
};

let animations = { ...DEFAULT_ANIMATIONS };
let frame = { ...DEFAULT_FRAME };
let currentPet = null;
let currentState = "idle";
let frameIndex = 0;
let frameTimer = null;
let dragStart = null;
let lastDragDirection = null;
let visualSize = { width: 1, height: 1 };
let animationStarted = false;
let pendingSingleClickTimer = null;
let suppressNextClick = false;
let idleMessageIndex = 0;
let idleMessageTimer = null;

// ---------- 调试边框、输入归一化与三档尺寸 ----------

function updateDebugBoundsLabel() {
  stage.dataset.debugBounds = `窗口 ${window.innerWidth} × ${window.innerHeight}`;
}

function applyDebugBounds(enabled) {
  document.documentElement.classList.toggle("debug-pet-bounds", Boolean(enabled));
  updateDebugBoundsLabel();
}

function normalizeState(state) {
  return ALLOWED_STATES.has(state) ? state : "idle";
}

function positiveInteger(value, fallback, minimum = 1) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= minimum ? numeric : fallback;
}

function requiredPositiveNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new TypeError(`${label} must be a positive number`);
  }
  return numeric;
}

function requiredNonNegativeNumber(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new TypeError(`${label} must be a non-negative number`);
  }
  return numeric;
}

function normalizePetSizePreset(nextPreset = {}) {
  return {
    scale: requiredPositiveNumber(nextPreset.scale, "preset.scale"),
    petWidth: requiredPositiveNumber(nextPreset.petWidth, "preset.petWidth"),
    petHeight: requiredPositiveNumber(nextPreset.petHeight, "preset.petHeight"),
    windowWidth: requiredPositiveNumber(nextPreset.windowWidth, "preset.windowWidth"),
    windowHeight: requiredPositiveNumber(nextPreset.windowHeight, "preset.windowHeight"),
    petTop: requiredNonNegativeNumber(nextPreset.petTop, "preset.petTop"),
    statusGap: requiredNonNegativeNumber(nextPreset.statusGap, "preset.statusGap"),
    statusSideMargin: requiredNonNegativeNumber(
      nextPreset.statusSideMargin,
      "preset.statusSideMargin"
    ),
    statusPaddingX: requiredNonNegativeNumber(nextPreset.statusPaddingX, "preset.statusPaddingX"),
    statusPaddingY: requiredNonNegativeNumber(nextPreset.statusPaddingY, "preset.statusPaddingY"),
    idleFontSize: requiredPositiveNumber(nextPreset.idleFontSize, "preset.idleFontSize"),
    statusMessageFontSize: requiredPositiveNumber(
      nextPreset.statusMessageFontSize,
      "preset.statusMessageFontSize"
    ),
    statusDetailFontSize: requiredPositiveNumber(
      nextPreset.statusDetailFontSize,
      "preset.statusDetailFontSize"
    )
  };
}

function applyFrame(nextFrame = {}) {
  frame = {
    width: positiveInteger(nextFrame.width, DEFAULT_FRAME.width),
    height: positiveInteger(nextFrame.height, DEFAULT_FRAME.height),
    columns: positiveInteger(nextFrame.columns, DEFAULT_FRAME.columns, 8),
    rows: positiveInteger(nextFrame.rows, DEFAULT_FRAME.rows, 8)
  };
}

function applyAnimations(actions) {
  if (!Array.isArray(actions)) return;
  const next = { ...DEFAULT_ANIMATIONS };
  for (const action of actions) {
    if (!ALLOWED_STATES.has(action?.state)) continue;
    const row = Number(action.row);
    const durations = Array.isArray(action.durations)
      ? action.durations.map(Number).filter((duration) => Number.isFinite(duration) && duration > 0)
      : [];
    if (!Number.isInteger(row) || row < 0 || durations.length === 0) continue;
    next[action.state] = { row, durations };
  }
  animations = next;
}

function applyPetSizePreset(nextPreset) {
  const preset = normalizePetSizePreset(nextPreset);
  visualSize = { width: preset.petWidth, height: preset.petHeight };
  updateDebugBoundsLabel();
  const petLeft = Math.max(0, Math.round((preset.windowWidth - preset.petWidth) / 2));
  document.documentElement.style.setProperty("--pet-left", `${petLeft}px`);
  document.documentElement.style.setProperty("--pet-top", `${preset.petTop}px`);
  document.documentElement.style.setProperty("--pet-width", `${preset.petWidth}px`);
  document.documentElement.style.setProperty("--pet-height", `${preset.petHeight}px`);
  document.documentElement.style.setProperty(
    "--status-top",
    `${preset.petTop + preset.petHeight + preset.statusGap}px`
  );
  document.documentElement.style.setProperty(
    "--status-side-margin",
    `${preset.statusSideMargin}px`
  );
  document.documentElement.style.setProperty("--status-padding-x", `${preset.statusPaddingX}px`);
  document.documentElement.style.setProperty("--status-padding-y", `${preset.statusPaddingY}px`);
  document.documentElement.style.setProperty("--idle-font-size", `${preset.idleFontSize}px`);
  document.documentElement.style.setProperty(
    "--status-message-font-size",
    `${preset.statusMessageFontSize}px`
  );
  document.documentElement.style.setProperty(
    "--status-detail-font-size",
    `${preset.statusDetailFontSize}px`
  );
  document.documentElement.style.setProperty(
    "--fallback-scale-x",
    String(preset.petWidth / 126)
  );
  document.documentElement.style.setProperty(
    "--fallback-scale-y",
    String(preset.petHeight / 164)
  );
  document.documentElement.classList.add("pet-size-ready");
  updateSpriteMetrics();
  drawFrame();
}

function getAtlasScale() {
  return {
    x: visualSize.width / frame.width,
    y: visualSize.height / frame.height
  };
}

// ---------- Codex-compatible spritesheet 绘制 ----------

function updateSpriteMetrics() {
  const atlasScale = getAtlasScale();
  sprite.style.width = `${visualSize.width}px`;
  sprite.style.height = `${visualSize.height}px`;
  sprite.style.backgroundSize = `${frame.width * frame.columns * atlasScale.x}px ${frame.height * frame.rows * atlasScale.y}px`;
}

function drawFrame() {
  // 每一行代表一个状态，每一列代表该状态的一帧。
  const animation = animations[currentState] || animations.idle;
  const atlasScale = getAtlasScale();
  const x = -(frameIndex * frame.width * atlasScale.x);
  const y = -(animation.row * frame.height * atlasScale.y);
  sprite.style.backgroundPosition = `${x}px ${y}px`;
}

function scheduleNextFrame() {
  clearTimeout(frameTimer);
  const animation = animations[currentState] || animations.idle;
  const duration = animation.durations[frameIndex] || 160;
  frameTimer = setTimeout(() => {
    frameIndex = (frameIndex + 1) % animation.durations.length;
    drawFrame();
    scheduleNextFrame();
  }, duration);
}

function setAnimationState(state) {
  currentState = normalizeState(state);
  animationStarted = true;
  frameIndex = 0;
  pet.dataset.state = currentState;
  drawFrame();
  scheduleNextFrame();
}

function setPet(petPayload) {
  currentPet = petPayload || null;
  applyFrame(currentPet?.frame);

  if (!currentPet?.spritesheetUrl) {
    sprite.classList.remove("ready");
    fallback.classList.add("show");
    return;
  }

  sprite.style.backgroundImage = `url("${currentPet.spritesheetUrl}")`;
  updateSpriteMetrics();
  sprite.classList.add("ready");
  fallback.classList.remove("show");
  drawFrame();
}

function renderPetStatus(message, detail, isIdleText = false) {
  const visible = message.length > 0 || detail.length > 0;
  petStatus.setAttribute("aria-live", isIdleText ? "off" : "polite");
  petStatusMessage.textContent = message;
  petStatusDetail.textContent = detail;
  petStatus.classList.toggle("has-detail", detail.length > 0);
  petStatus.classList.toggle("idle-text", isIdleText);
  petStatus.classList.toggle("show", visible);
  petStatus.hidden = !visible;
}

function stopIdleMessageRotation() {
  if (idleMessageTimer !== null) clearTimeout(idleMessageTimer);
  idleMessageTimer = null;
}

function showNextIdleMessage() {
  if (currentState !== "idle") return;
  const message = IDLE_MESSAGES[idleMessageIndex % IDLE_MESSAGES.length];
  idleMessageIndex = (idleMessageIndex + 1) % IDLE_MESSAGES.length;
  renderPetStatus(message, "", true);
  idleMessageTimer = setTimeout(showNextIdleMessage, IDLE_MESSAGE_INTERVAL_MS);
}

function updatePetStatus(state, message, detail) {
  stopIdleMessageRotation();
  if (state === "idle" && message.length === 0 && detail.length === 0) {
    showNextIdleMessage();
    return;
  }
  renderPetStatus(message, detail);
}

function setPetState(payload) {
  if (payload?.activePet && payload.activePet.key !== currentPet?.key) {
    setPet(payload.activePet);
  }
  const message = typeof payload?.message === "string" ? payload.message.slice(0, 160) : "";
  const detail = typeof payload?.detail === "string" ? payload.detail.slice(0, 32) : "";
  const nextState = normalizeState(payload?.state);
  if (!animationStarted || nextState !== currentState) setAnimationState(nextState);
  // 标题和计时写入不同元素；idle 只显示无边框颜文字。
  updatePetStatus(nextState, message, detail);
}

// ---------- 单击与拖拽 ----------

function startDrag(event) {
  if (event.button !== 0) return;
  const pointerId = event.pointerId;
  pet.setPointerCapture(pointerId);
  window.taskPet.startWindowDrag();
  dragStart = {
    pointerId,
    startScreenX: event.screenX,
    startScreenY: event.screenY,
    lastScreenX: event.screenX,
    moved: false
  };
  lastDragDirection = null;
}

function moveDrag(event) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  const dx = event.screenX - dragStart.startScreenX;
  const dy = event.screenY - dragStart.startScreenY;
  if (Math.abs(dx) >= 5 || Math.abs(dy) >= 5) dragStart.moved = true;
  const stepX = event.screenX - dragStart.lastScreenX;
  dragStart.lastScreenX = event.screenX;

  window.taskPet.moveWindow();

  if (Math.abs(stepX) < 1) return;
  const direction = stepX > 0 ? "drag-right" : "drag-left";
  if (direction !== lastDragDirection) {
    lastDragDirection = direction;
    window.taskPet.setDragDirection(direction);
  }
}

function endDrag(event) {
  // 真正拖拽只保存位置；单击/双击在 click 事件中按设置分发。
  if (!dragStart || event.pointerId !== dragStart.pointerId) return;
  // pointercancel 不会继续产生 click，不能让它误吞下一次正常单击。
  suppressNextClick = event.type === "pointerup" && dragStart.moved;
  dragStart = null;
  lastDragDirection = null;
  window.taskPet.finishDrag();
}

function handlePetClick(event) {
  if (event.button !== 0) return;
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }
  if (event.detail >= 2) {
    clearTimeout(pendingSingleClickTimer);
    pendingSingleClickTimer = null;
    window.taskPet.performMouseAction("double");
    return;
  }
  clearTimeout(pendingSingleClickTimer);
  pendingSingleClickTimer = setTimeout(() => {
    pendingSingleClickTimer = null;
    window.taskPet.performMouseAction("left");
  }, DOUBLE_CLICK_DELAY_MS);
}

function handlePetContextMenu(event) {
  event.preventDefault();
  window.taskPet.performMouseAction("right");
}

// ---------- 首次初始化与 DOM 事件绑定 ----------

window.taskPet.getInitialState().then((initial) => {
  const config = initial?.config || {};
  applyAnimations(initial?.actions);
  applyPetSizePreset(config.preset);
  applyDebugBounds(config.debugPetBounds);
  setPet(initial?.activePet);
  setPetState(initial);
  window.taskPet.rendererReady();
}).catch((error) => {
  console.error(`Failed to initialize TaskPet renderer: ${error.message}`);
  fallback.classList.add("show");
});

window.taskPet.onPetChange(setPet);
window.taskPet.onStateChange(setPetState);
window.taskPet.onPetSizeChange((payload) => applyPetSizePreset(payload?.preset));
pet.addEventListener("pointerdown", startDrag);
pet.addEventListener("pointermove", moveDrag);
pet.addEventListener("pointerup", endDrag);
pet.addEventListener("pointercancel", endDrag);
pet.addEventListener("click", handlePetClick);
pet.addEventListener("contextmenu", handlePetContextMenu);
window.addEventListener("beforeunload", () => {
  clearTimeout(pendingSingleClickTimer);
  stopIdleMessageRotation();
});
