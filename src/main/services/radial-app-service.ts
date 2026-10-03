import fs from "node:fs/promises";
import path from "node:path";
import type { RadialMenuSettings } from "../../shared/radial-settings";

export async function validateRadialAppPath(target: string): Promise<string> {
  if (!path.isAbsolute(target) || !/\.(exe|lnk)$/i.test(target) || target.includes("\0")) {
    throw new Error("请选择本地 .exe 程序或 .lnk 快捷方式");
  }
  const normalized = path.normalize(target);
  try {
    const stat = await fs.stat(normalized);
    if (!stat.isFile()) throw new Error();
  } catch { throw new Error("应用文件不存在或无法访问，请重新选择路径"); }
  return normalized;
}
export async function launchRadialApp(id: string, settings: RadialMenuSettings, openPath: (target: string) => Promise<string>): Promise<boolean> {
  const item = settings.items.find(entry => entry.id === id && entry.id.startsWith("app-"));
  if (!item?.path) throw new Error("应用入口不存在，请在轮盘菜单设置中重新绑定");
  const target = await validateRadialAppPath(item.path);
  const error = await openPath(target);
  if (error) throw new Error("应用启动失败，请检查权限或重新选择路径");
  return true;
}
