import { z } from "zod";

/** 绑定只由系统文件选择器写入，Renderer 不能通过设置直接提交启动路径。 */
export const MusicBindingSchema = z.object({
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(32767).regex(/^(?:[a-zA-Z]:[\\/]|\\\\)/).regex(/\.(exe|lnk)$/i),
  executablePath: z.string().min(1).max(32767).regex(/^(?:[a-zA-Z]:[\\/]|\\\\)/).regex(/\.exe$/i)
}).strict();
export type MusicBinding = z.infer<typeof MusicBindingSchema>;
export function normalizeMusicBinding(raw: unknown): MusicBinding | null {
  const parsed = MusicBindingSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
