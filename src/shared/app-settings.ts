/**
 * TaskPet 应用设置契约。
 * 只暴露用户可理解的开关和三档桌宠尺寸；内部轮询/计时间隔不属于设置。
 */
import { z } from "zod";

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
    idleFontSize: 8,
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
    idleFontSize: 13,
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
    idleFontSize: 14,
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
  rightClick: "open-settings"
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
  autoStart: AutoStartStatus;
  petSize: PetSize;
  alwaysOnTop: boolean;
  mouseBindings: PetMouseBindings;
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

export const UpdateAppSettingsInputSchema = z.object({
  autoStart: z.boolean().optional(),
  petSize: z.enum(["large", "normal", "small"]).optional(),
  alwaysOnTop: z.boolean().optional(),
  mouseBindings: PetMouseBindingsSchema.optional(),
  activePetKey: z.string().trim().min(1).max(240).optional()
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: "至少需要修改一个设置"
});

export type UpdateAppSettingsInput = z.input<typeof UpdateAppSettingsInputSchema>;

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
  return parsed.success ? parsed.data : { ...DEFAULT_PET_MOUSE_BINDINGS };
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
