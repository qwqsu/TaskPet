/**
 * 注册任务 CRUD、完成/重开和历史查询 IPC。
 * Handler 只做边界校验与事件协调，业务规则保留在 TaskService。
 */
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { ZodTypeAny } from "zod";
import {
  CreateTaskInputSchema,
  EmptyTaskInputSchema,
  HistoryQuerySchema,
  OccurrenceIdInputSchema,
  TaskIdInputSchema,
  UpdateTaskInputSchema
} from "../../shared/task-schemas";
import type { TaskApiResult, TaskListItem } from "../../shared/task-types";
import { TaskService, TaskServiceError } from "../services/task-service";
import { TASK_CHANNELS } from "./task-channels";

export interface RegisterTaskIpcOptions {
  ipcMain: IpcMain;
  service: TaskService;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  onChanged: () => void;
  beforeTaskUpdate: (taskId: string) => void;
  beforeTaskArchive: (taskId: string) => void;
  beforeOccurrenceComplete: (occurrenceId: string) => void;
  onCompleted: (item: TaskListItem) => void;
  onReopened: (item: TaskListItem) => void;
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
  if (error instanceof TaskServiceError) {
    return failure(error.code, error.message);
  }

  console.error("TaskPet task IPC failed", error);
  return failure("INTERNAL_ERROR", "任务操作失败，请稍后重试");
}

export function registerTaskIpc(options: RegisterTaskIpcOptions): () => void {
  const registeredChannels: string[] = [];

  // 所有任务频道共用可信发送者、Zod 校验和统一 TaskApiResult。
  function handle<InputSchema extends ZodTypeAny, Output>(
    channel: string,
    schema: InputSchema,
    operation: (input: InputSchema["_output"]) => Output
  ): void {
    options.ipcMain.handle(channel, (event, rawInput): TaskApiResult<Output> => {
      if (!options.isTrustedSender(event)) {
        return failure("INVALID_INPUT", "拒绝来自未知窗口的任务请求");
      }

      const parsed = schema.safeParse(rawInput);
      if (!parsed.success) {
        return failure(
          "INVALID_INPUT",
          parsed.error.issues[0]?.message ?? "任务请求参数无效"
        );
      }

      try {
        return success(operation(parsed.data));
      } catch (error) {
        return asFailure(error);
      }
    });
    registeredChannels.push(channel);
  }

  handle(TASK_CHANNELS.listToday, EmptyTaskInputSchema, () => {
    return options.service.getTodayTasks();
  });

  handle(TASK_CHANNELS.history, HistoryQuerySchema, (query) => {
    return options.service.getHistory(query);
  });

  handle(TASK_CHANNELS.create, CreateTaskInputSchema, (input) => {
    const task = options.service.createTask(input);
    options.onChanged();
    return task;
  });

  handle(TASK_CHANNELS.update, UpdateTaskInputSchema, ({ id, patch }) => {
    options.beforeTaskUpdate(id);
    const task = options.service.updateTask(id, patch);
    options.onChanged();
    return task;
  });

  handle(TASK_CHANNELS.archive, TaskIdInputSchema, ({ id }) => {
    options.beforeTaskArchive(id);
    const task = options.service.archiveTask(id);
    options.onChanged();
    return task;
  });

  handle(TASK_CHANNELS.complete, OccurrenceIdInputSchema, ({ occurrenceId }) => {
    // 手动完成前先停止可能仍在内存计时的 Session，避免完成后继续累计。
    options.beforeOccurrenceComplete(occurrenceId);
    const result = options.service.completeOccurrence(occurrenceId);
    if (result.changed) {
      options.onChanged();
      options.onCompleted(result.item);
    }
    return result;
  });

  handle(TASK_CHANNELS.reopen, OccurrenceIdInputSchema, ({ occurrenceId }) => {
    const result = options.service.reopenOccurrence(occurrenceId);
    if (result.changed) {
      options.onChanged();
      options.onReopened(result.item);
    }
    return result;
  });

  // 返回清理函数，由 TaskSystem 在应用退出时调用。
  return () => {
    for (const channel of registeredChannels) {
      options.ipcMain.removeHandler(channel);
    }
  };
}
