import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { ZodTypeAny } from "zod";
import {
  EmptyTaskInputSchema,
  SetProcessRuleInputSchema,
  TaskIdInputSchema
} from "../../shared/task-schemas";
import type {
  RunningProgram,
  RuntimeTaskSnapshot,
  TaskProcessRule
} from "../../shared/process-types";
import type { TaskApiResult } from "../../shared/task-types";
import type { ProcessProvider } from "../process/process-provider";
import { toRunningPrograms } from "../process/process-provider";
import { ProcessRuleService } from "../services/process-rule-service";
import { TaskServiceError } from "../services/task-service";
import { PROCESS_CHANNELS } from "./process-channels";

export interface RegisterProcessIpcOptions {
  ipcMain: IpcMain;
  ruleService: ProcessRuleService;
  processProvider: ProcessProvider;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  pickExecutable: () => Promise<RunningProgram | null>;
  runtimeSnapshots: () => RuntimeTaskSnapshot[];
  beforeRuleChange: (taskId: string) => void;
  onChanged: () => void;
}

function success<T>(data: T): TaskApiResult<T> {
  return { ok: true, data };
}

function failure<T>(
  code: "INVALID_INPUT" | "NOT_FOUND" | "CONFLICT" | "INTERNAL_ERROR",
  message: string
): TaskApiResult<T> {
  return { ok: false, error: { code, message } };
}

function asFailure<T>(error: unknown): TaskApiResult<T> {
  if (error instanceof TaskServiceError) return failure(error.code, error.message);
  console.error("TaskPet process IPC failed", error);
  return failure("INTERNAL_ERROR", "程序绑定操作失败，请稍后重试");
}

export function registerProcessIpc(options: RegisterProcessIpcOptions): () => void {
  const registeredChannels: string[] = [];

  function handle<InputSchema extends ZodTypeAny, Output>(
    channel: string,
    schema: InputSchema,
    operation: (input: InputSchema["_output"]) => Output | Promise<Output>
  ): void {
    options.ipcMain.handle(channel, async (event, rawInput): Promise<TaskApiResult<Output>> => {
      if (!options.isTrustedSender(event)) {
        return failure("INVALID_INPUT", "拒绝来自未知窗口的程序请求");
      }
      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        return failure(
          "INVALID_INPUT",
          parsed.error.issues[0]?.message ?? "程序请求参数无效"
        );
      }
      try {
        return success(await operation(parsed.data));
      } catch (error) {
        return asFailure(error);
      }
    });
    registeredChannels.push(channel);
  }

  handle< typeof EmptyTaskInputSchema, TaskProcessRule[] >(
    PROCESS_CHANNELS.listRules,
    EmptyTaskInputSchema,
    () => options.ruleService.listRules()
  );

  handle(PROCESS_CHANNELS.setRule, SetProcessRuleInputSchema, (input) => {
    options.beforeRuleChange(input.taskId);
    const rule = options.ruleService.replaceRule(input);
    options.onChanged();
    return rule;
  });

  handle(PROCESS_CHANNELS.removeRules, TaskIdInputSchema, ({ id }) => {
    options.beforeRuleChange(id);
    const changed = options.ruleService.removeRules(id);
    if (changed) options.onChanged();
    return changed;
  });

  handle(PROCESS_CHANNELS.listRunning, EmptyTaskInputSchema, async () => {
    return toRunningPrograms(await options.processProvider.listProcesses());
  });

  handle(PROCESS_CHANNELS.pickExecutable, EmptyTaskInputSchema, () => {
    return options.pickExecutable();
  });

  handle(PROCESS_CHANNELS.runtimeSnapshot, EmptyTaskInputSchema, () => {
    return options.runtimeSnapshots();
  });

  return () => {
    for (const channel of registeredChannels) options.ipcMain.removeHandler(channel);
  };
}
