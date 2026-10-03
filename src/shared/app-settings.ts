/**
 * TaskPet 应用设置契约。
 * 只暴露用户可理解的开关、三档桌宠尺寸与本地键盘映射；
 * 内部轮询/计时间隔和完整按键历史都不属于设置。
 */
import { z } from "zod";
import { RadialSettingsSchema, type RadialMenuSettings } from "./radial-settings";

export const PET_SIZE_PRESETS = Object.freeze({
  small: Object.freeze({
    scale: 0.25,
    petWidth: 48,
    petHeight: 52,
    windowWidth: 60,
    windowHeight: 72,
    petTop: 0,
    statusGap: 2,
    statusSideMargin: 6,
    statusPaddingX: 2,
    statusPaddingY: 0,
    statusMessageFontSize: 5,
    statusDetailFontSize: 7
  }),
  normal: Object.freeze({
    scale: 0.5,
    petWidth: 96,
    petHeight: 104,
    windowWidth: 120,
    windowHeight: 143,
    petTop: 0,
    statusGap: 5,
    statusSideMargin: 12,
    statusPaddingX: 5,
    statusPaddingY: 2,
    statusMessageFontSize: 10,
    statusDetailFontSize: 13
  }),
  large: Object.freeze({
    scale: 0.55,
    petWidth: 105,
    petHeight: 115,
    windowWidth: 132,
    windowHeight: 157,
    petTop: 0,
    statusGap: 5,
    statusSideMargin: 12,
    statusPaddingX: 6,
    statusPaddingY: 2,
    statusMessageFontSize: 10,
    statusDetailFontSize: 14
  })
} as const);

export type PetSize = keyof typeof PET_SIZE_PRESETS;
export type PetSizePreset = typeof PET_SIZE_PRESETS[PetSize];

export interface AutoStartStatus {
  supported: boolean;
  registered: boolean;
  willLaunch: boolean | null;
  blockedByWindows: boolean;
}

export const PET_MOUSE_ACTIONS = Object.freeze([
  "open-panel",
  "quick-add",
  "open-settings",
  "open-radial-menu",
  "toggle-monitoring",
  "recall-pet",
  "quit",
  "none"
] as const);

export type PetMouseAction = typeof PET_MOUSE_ACTIONS[number];
export type PetMouseGesture = "left" | "double" | "right";

export interface PetMouseBindings {
  leftClick: PetMouseAction;
  doubleClick: PetMouseAction;
  rightClick: PetMouseAction;
}

export const DEFAULT_PET_MOUSE_BINDINGS: Readonly<PetMouseBindings> = Object.freeze({
  leftClick: "open-panel",
  doubleClick: "toggle-monitoring",
  rightClick: "open-radial-menu"
});

export const MIN_PET_OPACITY = 20;
export const MAX_PET_OPACITY = 100;
export const PET_OPACITY_STEP = 1;
export const DEFAULT_PET_OPACITY = 100;
export const MAX_KEYBOARD_MAPPINGS = 32;

export const SUPPORTED_KEYBOARD_CODES = Object.freeze([
  ...Array.from({ length: 26 }, (_, index) => `Key${String.fromCharCode(65 + index)}`),
  ...Array.from({ length: 10 }, (_, index) => `Digit${index}`),
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
  "Space",
  "Enter",
  "Tab",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Shift",
  "Control",
  "Alt",
  "CapsLock",
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash"
] as const);

export type KeyboardCode = string;

export interface KeyboardMappingEntry {
  key: KeyboardCode;
  label: string;
  enabled: boolean;
}

export interface KeyboardMappingSettings {
  enabled: boolean;
  mappings: ReadonlyArray<KeyboardMappingEntry>;
}

export const DEFAULT_KEYBOARD_MAPPING_SETTINGS: Readonly<KeyboardMappingSettings> = Object.freeze({
  enabled: true,
  mappings: Object.freeze([])
});

export interface PetSettingsOption {
  key: string;
  displayName: string;
  description: string;
  spritesheetUrl: string;
  frame: {
    width: number;
    height: number;
    columns: number;
    rows: number;
  };
}

export interface AppSettingsSnapshot {
  petScale: number;
  radialMenu: RadialMenuSettings;
  autoStart: AutoStartStatus;
  petSize: PetSize;
  petOpacity: number;
  ignoreMouseEvents: boolean;
  alwaysOnTop: boolean;
  mouseBindings: PetMouseBindings;
  keyboardMapping: KeyboardMappingSettings;
  keyboardInputSupported: boolean;
  activePetKey: string | null;
  pets: PetSettingsOption[];
  dataDirectory: string;
  appName: string;
  version: string;
  githubUrl: string;
}

export interface DataActionResult {
  canceled: boolean;
  filePath: string | null;
}

export const MAX_PET_ZIP_BYTES = 50 * 1024 * 1024;

export const DroppedPetZipInputSchema = z.object({
  fileName: z.string()
    .trim()
    .min(1, "ZIP 文件名不能为空")
    .max(255, "ZIP 文件名过长")
    .regex(/\.zip$/i, "请选择 .zip 宠物包"),
  bytes: z.custom<Uint8Array>(
    (value) => value instanceof Uint8Array,
    { message: "ZIP 文件内容无效" }
  ).refine(
    (value) => value.byteLength > 0 && value.byteLength <= MAX_PET_ZIP_BYTES,
    "宠物 ZIP 为空或超过 50 MB"
  )
}).strict();

export type DroppedPetZipInput = z.input<typeof DroppedPetZipInputSchema>;

export interface ImportPetResult {
  canceled: boolean;
  petKey: string | null;
  settings: AppSettingsSnapshot;
}

export type PanelCommand = "open-add-task";

export const PetMouseBindingsSchema = z.object({
  leftClick: z.enum(PET_MOUSE_ACTIONS),
  doubleClick: z.enum(PET_MOUSE_ACTIONS),
  rightClick: z.enum(PET_MOUSE_ACTIONS)
}).strict();

const supportedKeyboardCodeSet = new Set<string>(SUPPORTED_KEYBOARD_CODES);
const KeyboardCodeSchema = z.string().refine(
  (value) => supportedKeyboardCodeSet.has(value),
  "不支持该按键"
);

export const KeyboardMappingEntrySchema = z.object({
  key: KeyboardCodeSchema,
  label: z.string()
    .trim()
    .min(1, "显示文字不能为空")
    .max(16, "显示文字过长")
    .refine((value) => [...value].length <= 8, "显示文字最多 8 个字符"),
  enabled: z.boolean()
}).strict();

export const KeyboardMappingSettingsSchema = z.object({
  enabled: z.boolean(),
  mappings: z.array(KeyboardMappingEntrySchema)
    .max(MAX_KEYBOARD_MAPPINGS, `最多添加 ${MAX_KEYBOARD_MAPPINGS} 个按键`)
    .superRefine((mappings, context) => {
      const keys = new Set<string>();
      for (const [index, mapping] of mappings.entries()) {
        if (keys.has(mapping.key)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "不能重复添加同一个按键",
            path: [index, "key"]
          });
        }
        keys.add(mapping.key);
      }
    })
}).strict();

export const UpdateAppSettingsInputSchema = z.object({
  petScale: z.number().int().min(60).max(180).optional(),
  radialMenu: RadialSettingsSchema.optional(),
  autoStart: z.boolean().optional(),
  petSize: z.enum(["large", "normal", "small"]).optional(),
  petOpacity: z.number()
    .int()
    .min(MIN_PET_OPACITY)
    .max(MAX_PET_OPACITY)
    .optional(),
  ignoreMouseEvents: z.boolean().optional(),
  alwaysOnTop: z.boolean().optional(),
  mouseBindings: PetMouseBindingsSchema.optional(),
  keyboardMapping: KeyboardMappingSettingsSchema.optional(),
  activePetKey: z.string().trim().min(1).max(240).optional()
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: "至少需要修改一个设置"
});

export type UpdateAppSettingsInput = z.input<typeof UpdateAppSettingsInputSchema>;

export const KeyboardCaptureModeInputSchema = z.object({
  active: z.boolean()
}).strict();

export type KeyboardCaptureModeInput = z.input<typeof KeyboardCaptureModeInputSchema>;

function closestPetSize(
  value: unknown
): PetSize {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return "normal";

  let closest: PetSize = "normal";
  let distance = Number.POSITIVE_INFINITY;
  for (const [size, preset] of Object.entries(PET_SIZE_PRESETS) as Array<[
    PetSize,
    PetSizePreset
  ]>) {
    const nextDistance = Math.abs(zoom - preset.scale);
    if (nextDistance < distance) {
      closest = size;
      distance = nextDistance;
    }
  }
  return closest;
}

export function normalizePetSize(value: unknown, legacyZoom?: unknown): PetSize {
  if (value === "large" || value === "normal" || value === "small") return value;
  // 旧版本只保存 zoom；新代码在这里识别一次，之后只使用 PetSize preset。
  return closestPetSize(legacyZoom);
}

export function normalizePetMouseBindings(value: unknown): PetMouseBindings {
  const parsed = PetMouseBindingsSchema.safeParse(value);
  if (!parsed.success) return { ...DEFAULT_PET_MOUSE_BINDINGS };
  // 1.0.1 之前的默认右键动作是“打开设置”；只迁移完整的旧默认组合，
  // 用户自定义过任意一项时仍原样保留。
  if (
    parsed.data.leftClick === "open-panel"
    && parsed.data.doubleClick === "toggle-monitoring"
    && parsed.data.rightClick === "open-settings"
  ) {
    return { ...DEFAULT_PET_MOUSE_BINDINGS };
  }
  return parsed.data;
}

export function normalizePetOpacity(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < MIN_PET_OPACITY || numeric > MAX_PET_OPACITY) {
    return DEFAULT_PET_OPACITY;
  }
  return Math.round(numeric / PET_OPACITY_STEP) * PET_OPACITY_STEP;
}

export function normalizeKeyboardMappingSettings(value: unknown): KeyboardMappingSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { enabled: DEFAULT_KEYBOARD_MAPPING_SETTINGS.enabled, mappings: [] };
  }

  const raw = value as { enabled?: unknown; mappings?: unknown };
  const mappings: KeyboardMappingEntry[] = [];
  const keys = new Set<string>();
  if (Array.isArray(raw.mappings)) {
    for (const candidate of raw.mappings) {
      const parsed = KeyboardMappingEntrySchema.safeParse(candidate);
      if (!parsed.success || keys.has(parsed.data.key)) continue;
      keys.add(parsed.data.key);
      mappings.push(parsed.data);
      if (mappings.length >= MAX_KEYBOARD_MAPPINGS) break;
    }
  }
  return {
    enabled: raw.enabled !== false,
    mappings
  };
}

export function petMouseActionForGesture(
  bindings: PetMouseBindings,
  gesture: unknown
): PetMouseAction | null {
  if (gesture === "left") return bindings.leftClick;
  if (gesture === "double") return bindings.doubleClick;
  if (gesture === "right") return bindings.rightClick;
  return null;
}
