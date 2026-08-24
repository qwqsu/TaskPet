/**
 * 设置/数据 IPC。Renderer 只能请求固定动作，不能传入任意文件路径或 URL。
 */
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { ZodTypeAny } from "zod";
import {
  UpdateAppSettingsInputSchema,
  type AppSettingsSnapshot,
  type DataActionResult,
  type UpdateAppSettingsInput
} from "../../shared/app-settings";
import { EmptyTaskInputSchema } from "../../shared/task-schemas";
import type { TaskApiResult } from "../../shared/task-types";
import { SETTINGS_CHANNELS } from "./settings-channels";

export interface RegisterSettingsIpcOptions {
  ipcMain: IpcMain;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  getSettings: () => AppSettingsSnapshot;
  updateSettings: (
    input: UpdateAppSettingsInput
  ) => AppSettingsSnapshot | Promise<AppSettingsSnapshot>;
  openDataDirectory: () => Promise<DataActionResult>;
  exportBackup: () => Promise<DataActionResult>;
  openStartupApps: () => Promise<void>;
  openGitHub: () => Promise<void>;
  openLicenses: () => Promise<void>;
}

function success<T>(data: T): TaskApiResult<T> {
  return { ok: true, data };
}

function failure<T>(message: string): TaskApiResult<T> {
  return { ok: false, error: { code: "INVALID_INPUT", message } };
}

export function registerSettingsIpc(options: RegisterSettingsIpcOptions): () => void {
  const registeredChannels: string[] = [];

  function handle<InputSchema extends ZodTypeAny, Output>(
    channel: string,
    schema: InputSchema,
    operation: (input: InputSchema["_output"]) => Output | Promise<Output>
  ): void {
    options.ipcMain.handle(channel, async (event, rawInput): Promise<TaskApiResult<Output>> => {
      if (!options.isTrustedSender(event)) {
        return failure("拒绝来自未知窗口的设置请求");
      }
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        return failure(parsed.error.issues[0]?.message ?? "设置请求参数无效");
      }
      try {
        return success(await operation(parsed.data));
      } catch (error) {
        console.error("TaskPet settings IPC failed", error);
        return {
          ok: false,
          error: {
            code: "INTERNAL_ERROR",
            message: error instanceof Error ? error.message : "设置操作失败，请稍后重试"
          }
        };
      }
    });
    registeredChannels.push(channel);
  }

  handle(SETTINGS_CHANNELS.get, EmptyTaskInputSchema, options.getSettings);
  handle(SETTINGS_CHANNELS.update, UpdateAppSettingsInputSchema, options.updateSettings);
  handle(SETTINGS_CHANNELS.openDataDirectory, EmptyTaskInputSchema, options.openDataDirectory);
  handle(SETTINGS_CHANNELS.exportBackup, EmptyTaskInputSchema, options.exportBackup);
  handle(SETTINGS_CHANNELS.openStartupApps, EmptyTaskInputSchema, options.openStartupApps);
  handle(SETTINGS_CHANNELS.openGitHub, EmptyTaskInputSchema, options.openGitHub);
  handle(SETTINGS_CHANNELS.openLicenses, EmptyTaskInputSchema, options.openLicenses);

  return () => {
    for (const channel of registeredChannels) options.ipcMain.removeHandler(channel);
  };
}
