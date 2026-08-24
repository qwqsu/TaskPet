/**
 * P4 应用设置契约。
 * 只暴露用户可理解的开关和三档桌宠尺寸；内部轮询/计时间隔不属于设置。
 */
import { z } from "zod";

export const PET_SIZE_ZOOMS = Object.freeze({
  large: 1.25,
  normal: 1,
  small: 0.5
} as const);

export type PetSize = keyof typeof PET_SIZE_ZOOMS;

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

export type PanelCommand = "open-add-task" | "open-settings";

export const UpdateAppSettingsInputSchema = z.object({
  autoStart: z.boolean().optional(),
  petSize: z.enum(["large", "normal", "small"]).optional(),
  alwaysOnTop: z.boolean().optional(),
  activePetKey: z.string().trim().min(1).max(240).optional()
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: "至少需要修改一个设置"
});

export type UpdateAppSettingsInput = z.input<typeof UpdateAppSettingsInputSchema>;

export function petSizeFromZoom(value: unknown): PetSize {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return "normal";

  let closest: PetSize = "normal";
  let distance = Number.POSITIVE_INFINITY;
  for (const [size, presetZoom] of Object.entries(PET_SIZE_ZOOMS) as Array<[
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

export function normalizePetSize(value: unknown, legacyZoom?: unknown): PetSize {
  if (value === "large" || value === "normal" || value === "small") return value;
  return petSizeFromZoom(legacyZoom);
}

