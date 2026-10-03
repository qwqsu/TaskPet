/**
 * 将平台键盘边沿事件过滤为用户明确配置的本地视觉反馈。
 * 本模块不保存历史、不记录未映射按键，也不阻止原应用继续接收输入。
 */
import type {
  KeyboardCode,
  KeyboardMappingSettings
} from "../../shared/app-settings";

export interface RawKeyboardEvent {
  code: KeyboardCode;
  pressed: boolean;
}

export interface KeyboardInputSource {
  readonly supported: boolean;
  start(callback: (event: RawKeyboardEvent) => void): void;
  stop(): void;
}

export interface KeyboardBubbleEvent {
  code: KeyboardCode;
  label: string;
}

export class KeyboardMappingMonitor {
  private readonly mappings = new Map<KeyboardCode, string>();
  private readonly pressed = new Set<KeyboardCode>();
  private sourceRunning = false;
  private enabled = true;
  private suppressed = false;

  constructor(
    private readonly source: KeyboardInputSource,
    private readonly onBubble: (event: KeyboardBubbleEvent) => void,
    private readonly onError: (error: unknown) => void = () => {}
  ) {}

  get supported(): boolean {
    return this.source.supported;
  }

  update(settings: KeyboardMappingSettings): void {
    this.enabled = settings.enabled;
    this.mappings.clear();
    for (const mapping of settings.mappings) {
      if (mapping.enabled) this.mappings.set(mapping.key, mapping.label);
    }
    this.pressed.clear();
    this.reconcile();
  }

  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.pressed.clear();
    this.reconcile();
  }

  close(): void {
    this.suppressed = true;
    this.pressed.clear();
    this.stopSource();
  }

  private reconcile(): void {
    const shouldRun = this.source.supported
      && this.enabled
      && !this.suppressed
      && this.mappings.size > 0;
    if (shouldRun && !this.sourceRunning) {
      try {
        this.source.start((event) => this.handleInput(event));
        this.sourceRunning = true;
      } catch (error) {
        this.sourceRunning = false;
        this.onError(error);
      }
    } else if (!shouldRun) {
      this.stopSource();
    }
  }

  private stopSource(): void {
    if (!this.sourceRunning) return;
    this.source.stop();
    this.sourceRunning = false;
  }

  private handleInput(event: RawKeyboardEvent): void {
    const label = this.mappings.get(event.code);
    if (!event.pressed) {
      this.pressed.delete(event.code);
      return;
    }
    if (!label || this.pressed.has(event.code)) return;

    // Windows 自动 repeat 会重复产生 keydown；只有 keyup 后的下一次按下才创建气泡。
    this.pressed.add(event.code);
    this.onBubble({ code: event.code, label });
  }
}

export class UnsupportedKeyboardInputSource implements KeyboardInputSource {
  readonly supported = false;

  start(): void {}

  stop(): void {}
}
