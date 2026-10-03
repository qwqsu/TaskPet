/**
 * Windows Raw Input 键盘适配器。
 * 使用 RIDEV_INPUTSINK 接收后台按键边沿，不安装 hook、不注入输入、不读取文本内容。
 */
import type { BrowserWindow } from "electron";
import koffi, { type KoffiFunc, type TypeObject } from "koffi";
import type { KeyboardCode } from "../../shared/app-settings";
import type {
  KeyboardInputSource,
  RawKeyboardEvent
} from "./keyboard-mapping-monitor";

const WM_INPUT = 0x00ff;
const RID_INPUT = 0x10000003;
const RIM_TYPEKEYBOARD = 1;
const RIDEV_REMOVE = 0x00000001;
const RIDEV_INPUTSINK = 0x00000100;
const RIDEV_DEVNOTIFY = 0x00002000;
const RI_KEY_BREAK = 0x0001;
const UINT_ERROR = 0xffffffff;

interface RawInputValue {
  header: { dwType: number; dwSize: number };
  keyboard: { MakeCode: number; Flags: number; VKey: number; Message: number };
}

export function pointerValueFromMessage(buffer: Buffer): bigint {
  if (buffer.byteLength >= 8) return buffer.readBigUInt64LE(0);
  if (buffer.byteLength >= 4) return BigInt(buffer.readUInt32LE(0));
  throw new TypeError("Windows message pointer buffer is too small");
}

export function keyboardCodeFromVirtualKey(virtualKey: number): KeyboardCode | null {
  if (virtualKey >= 0x41 && virtualKey <= 0x5a) {
    return `Key${String.fromCharCode(virtualKey)}` as KeyboardCode;
  }
  if (virtualKey >= 0x30 && virtualKey <= 0x39) {
    return `Digit${virtualKey - 0x30}` as KeyboardCode;
  }
  if (virtualKey >= 0x70 && virtualKey <= 0x7b) {
    return `F${virtualKey - 0x6f}` as KeyboardCode;
  }

  return ({
    0x08: "Backspace",
    0x09: "Tab",
    0x0d: "Enter",
    0x10: "Shift",
    0x11: "Control",
    0x12: "Alt",
    0x14: "CapsLock",
    0x20: "Space",
    0x21: "PageUp",
    0x22: "PageDown",
    0x23: "End",
    0x24: "Home",
    0x25: "ArrowLeft",
    0x26: "ArrowUp",
    0x27: "ArrowRight",
    0x28: "ArrowDown",
    0x2d: "Insert",
    0x2e: "Delete",
    0xba: "Semicolon",
    0xbb: "Equal",
    0xbc: "Comma",
    0xbd: "Minus",
    0xbe: "Period",
    0xbf: "Slash",
    0xc0: "Backquote",
    0xdb: "BracketLeft",
    0xdc: "Backslash",
    0xdd: "BracketRight",
    0xde: "Quote"
  } as Partial<Record<number, KeyboardCode>>)[virtualKey] ?? null;
}

export class WindowsRawKeyboardSource implements KeyboardInputSource {
  readonly supported = true;
  private readonly rawInputDeviceType: TypeObject;
  private readonly rawInputType: TypeObject;
  private readonly rawInputHeaderSize: number;
  private readonly registerRawInputDevices: KoffiFunc<(
    devices: unknown,
    deviceCount: number,
    deviceSize: number
  ) => boolean>;
  private readonly getRawInputData: KoffiFunc<(
    rawInputHandle: bigint,
    command: number,
    output: Buffer | null,
    size: Uint32Array,
    headerSize: number
  ) => number>;
  private callback: ((event: RawKeyboardEvent) => void) | null = null;
  private running = false;

  constructor(
    private readonly window: BrowserWindow,
    private readonly onError: (error: unknown) => void = () => {}
  ) {
    if (process.platform !== "win32") {
      throw new Error("WindowsRawKeyboardSource is available only on Windows");
    }

    const handleType = koffi.pointer(koffi.opaque());
    this.rawInputDeviceType = koffi.struct({
      usUsagePage: "uint16_t",
      usUsage: "uint16_t",
      dwFlags: "uint32_t",
      hwndTarget: handleType
    });
    const rawInputHeaderType = koffi.struct({
      dwType: "uint32_t",
      dwSize: "uint32_t",
      hDevice: handleType,
      wParam: "uintptr_t"
    });
    const rawKeyboardType = koffi.struct({
      MakeCode: "uint16_t",
      Flags: "uint16_t",
      Reserved: "uint16_t",
      VKey: "uint16_t",
      Message: "uint32_t",
      ExtraInformation: "uint32_t"
    });
    this.rawInputType = koffi.struct({
      header: rawInputHeaderType,
      keyboard: rawKeyboardType
    });
    this.rawInputHeaderSize = koffi.sizeof(rawInputHeaderType);

    const user32 = koffi.load("user32.dll");
    this.registerRawInputDevices = user32.func(
      "RegisterRawInputDevices",
      "bool",
      [koffi.pointer(this.rawInputDeviceType), "uint32_t", "uint32_t"]
    ) as typeof this.registerRawInputDevices;
    this.getRawInputData = user32.func(
      "GetRawInputData",
      "uint32_t",
      ["void *", "uint32_t", "void *", "uint32_t *", "uint32_t"]
    ) as typeof this.getRawInputData;
  }

  start(callback: (event: RawKeyboardEvent) => void): void {
    if (this.running) return;
    if (this.window.isDestroyed()) throw new Error("Cannot start keyboard input on a closed window");

    const hwndTarget = pointerValueFromMessage(this.window.getNativeWindowHandle());
    const device = {
      usUsagePage: 0x01,
      usUsage: 0x06,
      dwFlags: RIDEV_INPUTSINK | RIDEV_DEVNOTIFY,
      hwndTarget
    };
    if (!this.registerRawInputDevices(device, 1, koffi.sizeof(this.rawInputDeviceType))) {
      throw new Error("RegisterRawInputDevices failed for the TaskPet keyboard mapping");
    }

    try {
      this.callback = callback;
      this.window.hookWindowMessage(WM_INPUT, this.handleWindowMessage);
      this.running = true;
    } catch (error) {
      this.callback = null;
      this.registerRawInputDevices({
        usUsagePage: 0x01,
        usUsage: 0x06,
        dwFlags: RIDEV_REMOVE,
        hwndTarget: null
      }, 1, koffi.sizeof(this.rawInputDeviceType));
      throw error;
    }
  }

  stop(): void {
    if (!this.running) return;
    if (!this.window.isDestroyed()) {
      this.window.unhookWindowMessage(WM_INPUT);
      const device = {
        usUsagePage: 0x01,
        usUsage: 0x06,
        dwFlags: RIDEV_REMOVE,
        hwndTarget: null
      };
      this.registerRawInputDevices(device, 1, koffi.sizeof(this.rawInputDeviceType));
    }
    this.callback = null;
    this.running = false;
  }

  private readonly handleWindowMessage = (_wParam: Buffer, lParam: Buffer): void => {
    try {
      const rawInputHandle = pointerValueFromMessage(lParam);
      const size = new Uint32Array(1);
      const measured = this.getRawInputData(
        rawInputHandle,
        RID_INPUT,
        null,
        size,
        this.rawInputHeaderSize
      );
      if (measured === UINT_ERROR || !size[0]) return;

      const buffer = Buffer.alloc(size[0]);
      const bytesRead = this.getRawInputData(
        rawInputHandle,
        RID_INPUT,
        buffer,
        size,
        this.rawInputHeaderSize
      );
      if (bytesRead === UINT_ERROR || bytesRead < this.rawInputHeaderSize) return;

      const input = koffi.decode(buffer, this.rawInputType) as RawInputValue;
      if (input.header.dwType !== RIM_TYPEKEYBOARD) return;
      const code = keyboardCodeFromVirtualKey(input.keyboard.VKey);
      if (!code) return;
      this.callback?.({
        code,
        pressed: (input.keyboard.Flags & RI_KEY_BREAK) === 0
      });
    } catch (error) {
      this.onError(error);
    }
  };
}
