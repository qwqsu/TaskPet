import test from "node:test";
import assert from "node:assert/strict";
import {
  keyboardCodeFromVirtualKey,
  pointerValueFromMessage
} from "../src/main/input/windows-raw-keyboard-source";

test("Windows virtual keys map only to explicitly supported keyboard codes", () => {
  assert.equal(keyboardCodeFromVirtualKey(0x41), "KeyA");
  assert.equal(keyboardCodeFromVirtualKey(0x5a), "KeyZ");
  assert.equal(keyboardCodeFromVirtualKey(0x30), "Digit0");
  assert.equal(keyboardCodeFromVirtualKey(0x7b), "F12");
  assert.equal(keyboardCodeFromVirtualKey(0x20), "Space");
  assert.equal(keyboardCodeFromVirtualKey(0x25), "ArrowLeft");
  assert.equal(keyboardCodeFromVirtualKey(0x01), null, "mouse input is not supported");
});

test("native Windows message handles retain their pointer width", () => {
  const x64 = Buffer.alloc(8);
  x64.writeBigUInt64LE(0x1234_5678_9abcn);
  assert.equal(pointerValueFromMessage(x64), 0x1234_5678_9abcn);
  const x86 = Buffer.alloc(4);
  x86.writeUInt32LE(0x89abcdef);
  assert.equal(pointerValueFromMessage(x86), 0x89abcdefn);
  assert.throws(() => pointerValueFromMessage(Buffer.alloc(2)), /too small/);
});

