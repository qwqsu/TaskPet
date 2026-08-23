const test = require("node:test");
const assert = require("node:assert/strict");
const { createPetDragSession, petBoundsForCursor } = require("../src/pet-window-drag");

test("dragging replaces a corrupted native size with the configured pet size", () => {
  const session = createPetDragSession({
    windowBounds: { x: 624, y: 106, width: 643, height: 634 },
    cursorPoint: { x: 720, y: 240 },
    windowSize: { width: 160, height: 191 }
  });

  assert.deepEqual(petBoundsForCursor(session, { x: 720, y: 240 }), {
    x: 624,
    y: 106,
    width: 160,
    height: 191
  });
});

test("dragging uses one DIP origin and never compounds previous window movement", () => {
  const session = createPetDragSession({
    windowBounds: { x: 100, y: 200, width: 240, height: 286 },
    cursorPoint: { x: 300, y: 400 },
    windowSize: { width: 240, height: 286 }
  });

  assert.deepEqual(petBoundsForCursor(session, { x: 340, y: 375 }), {
    x: 140,
    y: 175,
    width: 240,
    height: 286
  });
  assert.deepEqual(petBoundsForCursor(session, { x: 340, y: 375 }), {
    x: 140,
    y: 175,
    width: 240,
    height: 286
  });
});

test("drag session rejects invalid coordinates and dimensions", () => {
  assert.throws(() => createPetDragSession({
    windowBounds: { x: 0, y: 0 },
    cursorPoint: { x: Infinity, y: 0 },
    windowSize: { width: 240, height: 286 }
  }), /cursorPoint\.x must be finite/);
  assert.throws(() => createPetDragSession({
    windowBounds: { x: 0, y: 0 },
    cursorPoint: { x: 0, y: 0 },
    windowSize: { width: 0, height: 286 }
  }), /windowSize\.width must be positive/);
});
