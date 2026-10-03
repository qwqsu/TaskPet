import { z } from "zod";

export const RADIAL_BUILTINS = ["open-panel", "quick-add", "open-settings", "toggle-monitoring", "toggle-pet", "toggle-ignore-mouse", "toggle-always-on-top", "pet-opacity", "pet-scale", "radial-opacity", "radial-scale", "music", "quit"] as const;
export const RadialItemSchema = z.object({
  id: z.string().max(80).refine(id => (RADIAL_BUILTINS as readonly string[]).includes(id) || /^app-[a-zA-Z0-9-]+$/.test(id)),
  enabled: z.boolean(),
  name: z.string().trim().min(1).max(40).optional(),
  path: z.string().min(1).max(2048).optional()
}).strict().refine(item => !item.id.startsWith("app-") || Boolean(item.name && item.path), "应用名称和路径不能为空");
export const RadialSettingsSchema = z.object({
  enabled: z.boolean(), opacity: z.number().int().min(40).max(100),
  scale: z.number().int().min(50).max(130), showHints: z.boolean(), animations: z.boolean(),
  items: z.array(RadialItemSchema).max(45).refine(items => new Set(items.map(i => i.id)).size === items.length, "菜单项不能重复")
}).strict();
export type RadialMenuSettings = z.infer<typeof RadialSettingsSchema>;
export function defaultRadialSettings(): RadialMenuSettings {
  const visible = new Set(["open-panel", "open-settings", "toggle-monitoring", "pet-opacity", "pet-scale", "music", "toggle-always-on-top"]);
  return { enabled: true, opacity: 92, scale: 90, showHints: true, animations: true,
    items: RADIAL_BUILTINS.map(id => ({id, enabled: visible.has(id)})) };
}
export function normalizeRadialSettings(raw: unknown): RadialMenuSettings {
  // Preserve legal historical values; repair only obsolete or missing scale.
  let candidate = raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const source = raw as Record<string, unknown>;
    const valid = typeof source.scale === "number" && Number.isInteger(source.scale)
      && source.scale >= 50 && source.scale <= 130;
    candidate = {...source, scale: valid ? source.scale : 90};
  }
  const parsed = RadialSettingsSchema.safeParse(candidate);
  if (!parsed.success) return defaultRadialSettings();
  const ids = new Set(parsed.data.items.map(i => i.id));
  return {...parsed.data, items: [...parsed.data.items, ...RADIAL_BUILTINS.filter(id => !ids.has(id)).map(id => ({id, enabled: false}))]};
}
export function normalizePetScale(value: unknown, legacySize = "normal"): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 60 && value <= 180) return Math.round(value);
  return legacySize === "small" ? 60 : legacySize === "large" ? 110 : 100;
}
