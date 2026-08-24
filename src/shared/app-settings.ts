/**
 * P4 应用设置契约。
 * 只暴露用户可理解的开关和三档桌宠尺寸；内部轮询/计时间隔不属于设置。
 */
import { z } from "zod";

export const PET_VISUAL_SIZES = Object.freeze({
  large: Object.freeze({ width: 105, height: 114 }),
  normal: Object.freeze({ width: 96, height: 104 }),
  small: Object.freeze({ width: 43, height: 52 })
} as const);

export type PetSize = keyof typeof PET_VISUAL_SIZES;

/**
 * 透明窗口外壳的内部缩放档位。视觉本体使用 PET_VISUAL_SIZES 精确控制，
 * 小档窗口仍保留最小状态文字空间，因此两者不应再视为同一个尺寸。
 */
export const PET_SIZE_ZOOMS: Readonly<Record<PetSize, number>> = Object.freeze({
  large: 0.55,
  normal: 0.5,
  small: 0.25
});

const LEGACY_PET_SIZE_ZOOMS: Readonly<Record<PetSize, number>> = Object.freeze({
  large: 1.25,
  normal: 1,
  small: 0.5
});

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
  sourceLabel: string;
}

export interface AppSettingsSnapshot {
  autoStart: boolean;
  autoStartSupported: boolean;
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
  value: unknown,
  presets: Readonly<Record<PetSize, number>>
): PetSize {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return "normal";

  let closest: PetSize = "normal";
  let distance = Number.POSITIVE_INFINITY;
  for (const [size, presetZoom] of Object.entries(presets) as Array<[
    PetSize,
    number
  ]>) {
    const nextDistance = Math.abs(zoom - presetZoom);
    if (nextDistance < distance) {
      closest = size;
      distance = nextDistance;
    }
  }
  return closest;
}

export function petSizeFromZoom(value: unknown): PetSize {
  return closestPetSize(value, PET_SIZE_ZOOMS);
}

export function normalizePetSize(value: unknown, legacyZoom?: unknown): PetSize {
  if (value === "large" || value === "normal" || value === "small") return value;
  // P4 早期版本只保存 1.25 / 1 / 0.5，迁移时必须按旧档位解释。
  return closestPetSize(legacyZoom, LEGACY_PET_SIZE_ZOOMS);
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
