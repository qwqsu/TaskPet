const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/renderer/renderer.js"), "utf8");

// Run the real renderer and its registered DOM listeners, with deterministic time.
async function createRenderer(doubleClickDelayMs = 900) {
  let now = 0;
  let nextTimer = 0;
  const timers = new Map();
  const calls = { actions: [], drag: [] };
  function element() {
    const listeners = new Map();
    const captures = new Set();
    return {
      dataset: {}, style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, callback) { listeners.set(type, callback); },
      removeEventListener(type) { listeners.delete(type); },
      emit(type, properties = {}) {
        const event = {
          type, button: 0, pointerId: 1, isPrimary: true,
          screenX: 100, screenY: 100, detail: 1,
          preventDefault() { this.defaultPrevented = true; }, ...properties
        };
        listeners.get(type)?.(event);
        return event;
      },
      setPointerCapture(id) { captures.add(id); },
      hasPointerCapture(id) { return captures.has(id); },
      releasePointerCapture(id) {
        captures.delete(id);
        this.emit("lostpointercapture", { pointerId: id });
      }
    };
  }
  const elements = Object.fromEntries([
    "pet", "sprite", "fallback", "petStatus", "petStatusMessage", "petStatusDetail"
  ].map((id) => [id, element()]));
  const document = Object.assign(element(), {
    hidden: true, documentElement: element(),
    getElementById: (id) => elements[id], querySelector: () => element()
  });
  // All dimensions are positive; layout itself is outside these gesture tests.
  const preset = Object.fromEntries([
    "scale", "petWidth", "petHeight", "windowWidth", "windowHeight", "petTop",
    "statusGap", "statusSideMargin", "statusPaddingX", "statusPaddingY",
    "statusMessageFontSize", "statusDetailFontSize"
  ].map((name) => [name, 10]));
  let ready = false;
  const window = Object.assign(element(), {
    innerWidth: 100, innerHeight: 100,
    taskPet: {
      getInitialState: async () => ({ config: { preset, doubleClickDelayMs } }),
      rendererReady() { ready = true; },
      onPetChange() {}, onStateChange() {}, onPetSizeChange() {},
      performMouseAction: (gesture) => calls.actions.push(gesture),
      startWindowDrag: () => calls.drag.push("start"),
      moveWindow: () => calls.drag.push("move"),
      setDragDirection: (direction) => calls.drag.push(direction),
      finishDrag: () => calls.drag.push("finish")
    }
  });
  vm.runInNewContext(source, {
    document, window, console,
    setTimeout(callback, delay) {
      const id = ++nextTimer;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id)
  });
  await Promise.resolve();
  assert.equal(ready, true, "real initial-state configuration was consumed");
  function advance(ms) {
    const end = now + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    }
    now = end;
  }
  const pet = elements.pet;
  function click(detail = 1) {
    pet.emit("pointerdown");
    pet.emit("pointerup");
    pet.emit("click", { detail });
  }
  return { pet, window, elements, calls, advance, click };
}

test("single click waits exactly the supplied system double-click interval", async () => {
  for (const delay of [200, 900, 1500]) {
    const r = await createRenderer(delay);
    r.click();
    r.advance(delay - 1);
    assert.deepEqual(r.calls.actions, []);
    r.advance(1);
    assert.deepEqual(r.calls.actions, ["left"]);
    r.advance(2000);
    assert.deepEqual(r.calls.actions, ["left"]);
    assert.deepEqual(r.calls.drag, [], "clicks must not start or finish a native drag");
  }
});

test("slow system-valid double click cancels the single on its second pointerdown", async () => {
  const r = await createRenderer();
  r.click();
  r.advance(899);
  r.pet.emit("pointerdown");
  r.advance(2000); // Second press remains held beyond the first click's deadline.
  assert.deepEqual(r.calls.actions, []);
  r.pet.emit("pointerup");
  r.pet.emit("click", { detail: 2 });
  r.advance(2000);
  assert.deepEqual(r.calls.actions, ["double"]);
  assert.deepEqual(r.calls.drag, []);
});

test("triple and higher click counts dispatch only one double, then a new single works", async () => {
  const r = await createRenderer();
  for (const detail of [1, 2, 3, 4]) {
    r.click(detail);
    r.advance(50);
  }
  r.advance(1000);
  assert.deepEqual(r.calls.actions, ["double"]);
  r.click();
  r.advance(900);
  assert.deepEqual(r.calls.actions, ["double", "left"]);
});

test("two independent single clicks retain separate actions", async () => {
  const r = await createRenderer();
  r.click();
  r.advance(1000);
  r.click();
  r.advance(900);
  assert.deepEqual(r.calls.actions, ["left", "left"]);
});

test("subthreshold jitter causes no native movement or drag animation", async () => {
  const r = await createRenderer();
  r.pet.emit("pointerdown");
  r.pet.emit("pointermove", { screenX: 104, screenY: 104 });
  r.pet.emit("pointermove", { screenX: 97, screenY: 98 });
  r.pet.emit("pointerup", { screenX: 97, screenY: 98 });
  r.pet.emit("click");
  r.advance(900);
  assert.deepEqual(r.calls.drag, []);
  assert.deepEqual(r.calls.actions, ["left"]);
  assert.equal(r.pet.hasPointerCapture(1), false);
});

test("crossing the drag threshold cancels clicks and finishes one native session", async () => {
  for (const offset of [{ screenX: 105 }, { screenY: 95 }]) {
    const r = await createRenderer();
    r.click();
    r.advance(100);
    r.pet.emit("pointerdown");
    r.pet.emit("pointermove", offset);
    assert.deepEqual(r.calls.drag.slice(0, 2), ["start", "move"]);
    r.advance(1000);
    r.pet.emit("pointermove", { screenX: 90 });
    r.pet.emit("pointerup", { screenX: 90 });
    r.pet.emit("click", { detail: 2 }); // Browser click after captured drag.
    r.advance(1000);
    assert.deepEqual(r.calls.actions, []);
    assert.equal(r.calls.drag.filter((call) => call === "start").length, 1);
    assert.equal(r.calls.drag.filter((call) => call === "finish").length, 1);
    assert.equal(r.calls.drag.at(-1), "finish");
    assert.ok(r.calls.drag.includes("drag-left"));
    r.click();
    r.advance(900);
    assert.deepEqual(r.calls.actions, ["left"]);
  }
});

test("pointercancel and lost capture clean both pressed and dragging states", async () => {
  for (const cancellation of ["pointercancel", "lostpointercapture"]) {
    for (const moved of [false, true]) {
      const r = await createRenderer();
      r.click();
      r.advance(100);
      r.pet.emit("pointerdown");
      if (moved) r.pet.emit("pointermove", { screenX: 110 });
      r.pet.emit(cancellation);
      r.pet.emit("pointermove", { screenX: 120 });
      r.pet.emit("pointerup");
      r.advance(2000);
      assert.deepEqual(r.calls.actions, []);
      assert.equal(r.pet.hasPointerCapture(1), false);
      assert.equal(r.calls.drag.filter((call) => call === "finish").length, moved ? 1 : 0);
      if (!moved) assert.deepEqual(r.calls.drag, []);
      r.click();
      r.advance(900);
      assert.deepEqual(r.calls.actions, ["left"], "cancellation cannot swallow next click");
    }
  }
});

test("a browser click count following a drag cannot turn that drag into a double click", async () => {
  const r = await createRenderer();
  r.pet.emit("pointerdown");
  r.pet.emit("pointermove", { screenX: 110 });
  r.pet.emit("pointerup", { screenX: 110 });
  r.pet.emit("click");
  r.click(2);
  r.advance(2000);
  assert.deepEqual(r.calls.actions, []);
  r.click();
  r.advance(900);
  assert.deepEqual(r.calls.actions, ["left"]);
});

test("foreign pointers cannot move or end the active press", async () => {
  const r = await createRenderer();
  r.pet.emit("pointerdown");
  r.pet.emit("pointerdown", { pointerId: 2, isPrimary: false });
  r.pet.emit("pointermove", { pointerId: 2, screenX: 200 });
  r.pet.emit("pointercancel", { pointerId: 2 });
  r.pet.emit("pointerup", { pointerId: 2 });
  assert.equal(r.pet.hasPointerCapture(1), true);
  assert.equal(r.pet.hasPointerCapture(2), false);
  r.pet.emit("pointerup");
  r.pet.emit("click");
  r.advance(900);
  assert.deepEqual(r.calls.drag, []);
  assert.deepEqual(r.calls.actions, ["left"]);
});

test("right click dispatches only its binding and other controls do not enter pet gestures", async () => {
  const r = await createRenderer();
  r.pet.emit("pointerdown", { button: 2 });
  r.pet.emit("pointerup", { button: 2 });
  r.pet.emit("click", { button: 2 });
  assert.equal(r.pet.emit("contextmenu", { button: 2 }).defaultPrevented, true);
  r.elements.petStatus.emit("click");
  r.window.emit("click");
  r.advance(2000);
  assert.deepEqual(r.calls.actions, ["right"]);
  assert.deepEqual(r.calls.drag, []);
});

test("unloading cancels a pending single click", async () => {
  const r = await createRenderer();
  r.click();
  r.window.emit("beforeunload");
  r.advance(2000);
  assert.deepEqual(r.calls.actions, []);
});

test("completed click without primary-pointer metadata still dispatches once", async () => {
  const r = await createRenderer();
  r.pet.emit("pointerdown");
  r.pet.emit("pointerup");
  r.pet.emit("click", {isPrimary:false});
  r.advance(900);
  assert.deepEqual(r.calls.actions, ["left"]);
});
