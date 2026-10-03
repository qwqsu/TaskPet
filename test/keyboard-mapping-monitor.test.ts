import test from "node:test";
import assert from "node:assert/strict";
import {
  KeyboardMappingMonitor,
  type KeyboardInputSource,
  type RawKeyboardEvent
} from "../src/main/input/keyboard-mapping-monitor";

class FakeKeyboardSource implements KeyboardInputSource {
  readonly supported = true;
  starts = 0;
  stops = 0;
  callback: ((event: RawKeyboardEvent) => void) | null = null;

  start(callback: (event: RawKeyboardEvent) => void): void {
    this.starts += 1;
    this.callback = callback;
  }

  stop(): void {
    this.stops += 1;
    this.callback = null;
  }

  emit(event: RawKeyboardEvent): void {
    this.callback?.(event);
  }
}

test("keyboard monitor listens only while an enabled mapping exists", () => {
  const source = new FakeKeyboardSource();
  const bubbles: string[] = [];
  const monitor = new KeyboardMappingMonitor(source, ({ label }) => bubbles.push(label));

  monitor.update({ enabled: true, mappings: [] });
  assert.equal(source.starts, 0);

  monitor.update({
    enabled: true,
    mappings: [{ key: "KeyA", label: "写代码", enabled: true }]
  });
  assert.equal(source.starts, 1);
  source.emit({ code: "KeyB", pressed: true });
  source.emit({ code: "KeyA", pressed: true });
  source.emit({ code: "KeyA", pressed: true });
  assert.deepEqual(bubbles, ["写代码"], "auto-repeat must not create duplicate bubbles");

  source.emit({ code: "KeyA", pressed: false });
  source.emit({ code: "KeyA", pressed: true });
  assert.deepEqual(bubbles, ["写代码", "写代码"]);

  monitor.update({
    enabled: true,
    mappings: [{ key: "KeyA", label: "写代码", enabled: false }]
  });
  assert.equal(source.stops, 1);
});

test("capture suppression stops global input and resumes without retaining pressed keys", () => {
  const source = new FakeKeyboardSource();
  const bubbles: string[] = [];
  const monitor = new KeyboardMappingMonitor(source, ({ label }) => bubbles.push(label));
  monitor.update({
    enabled: true,
    mappings: [{ key: "Space", label: "跳跃", enabled: true }]
  });
  source.emit({ code: "Space", pressed: true });
  monitor.setSuppressed(true);
  assert.equal(source.stops, 1);
  source.emit({ code: "Space", pressed: true });
  monitor.setSuppressed(false);
  assert.equal(source.starts, 2);
  source.emit({ code: "Space", pressed: true });
  assert.deepEqual(bubbles, ["跳跃", "跳跃"]);
  monitor.close();
  assert.equal(source.stops, 2);
});

test("keyboard source start failures are reported without crashing settings updates", () => {
  const expected = new Error("native registration failed");
  const errors: unknown[] = [];
  const source: KeyboardInputSource = {
    supported: true,
    start: () => { throw expected; },
    stop: () => undefined
  };
  const monitor = new KeyboardMappingMonitor(source, () => undefined, (error) => errors.push(error));
  assert.doesNotThrow(() => monitor.update({
    enabled: true,
    mappings: [{ key: "F1", label: "帮助", enabled: true }]
  }));
  assert.deepEqual(errors, [expected]);
});

