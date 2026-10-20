import { z } from "zod";

export const THEME_IDS = ["classic-warm", "midnight-blue", "cream", "forest", "sakura"] as const;
export const AppearanceSchema = z.object({
  themeMode: z.enum(["manual", "system"]),
  themeId: z.enum(THEME_IDS)
}).strict();
export type AppearanceSettings = z.infer<typeof AppearanceSchema>;
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const parsed = AppearanceSchema.safeParse(raw);
  return parsed.success ? parsed.data : { themeMode: "manual", themeId: "classic-warm" };
}
export function resolveTheme(appearance: AppearanceSettings, dark: boolean): typeof THEME_IDS[number] {
  return appearance.themeMode === "system" ? (dark ? "midnight-blue" : "classic-warm") : appearance.themeId;
}
