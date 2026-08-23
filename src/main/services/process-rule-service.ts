import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskDatabase } from "../db/database";
import { ProcessRuleRepository } from "../db/process-rule-repository";
import { TaskRepository } from "../db/task-repository";
import {
  SetProcessRuleInputSchema,
  type SetProcessRuleInput
} from "../../shared/task-schemas";
import type { TaskProcessRule } from "../../shared/process-types";
import { TaskServiceError, type TaskClock } from "./task-service";

export interface ProcessRuleServiceOptions {
  clock?: TaskClock;
  idFactory?: () => string;
  platform?: NodeJS.Platform;
}

export class ProcessRuleService {
  private readonly rules: ProcessRuleRepository;
  private readonly tasks: TaskRepository;
  private readonly clock: TaskClock;
  private readonly idFactory: () => string;
  private readonly platform: NodeJS.Platform;

  constructor(database: TaskDatabase, options: ProcessRuleServiceOptions = {}) {
    this.rules = new ProcessRuleRepository(database);
    this.tasks = new TaskRepository(database);
    this.clock = options.clock ?? { now: () => new Date() };
    this.idFactory = options.idFactory ?? randomUUID;
    this.platform = options.platform ?? process.platform;
  }

  listRules(): TaskProcessRule[] {
    return this.rules.listAll();
  }

  listRulesForTask(taskId: string): TaskProcessRule[] {
    return this.rules.listForTask(taskId);
  }

  replaceRule(input: SetProcessRuleInput): TaskProcessRule {
    const parsed = SetProcessRuleInputSchema.parse(input);
    const task = this.tasks.findTask(parsed.taskId);
    if (!task) throw new TaskServiceError("NOT_FOUND", "任务不存在");
    if (!task.enabled || task.archivedAt) {
      throw new TaskServiceError("CONFLICT", "已归档或停用任务不能绑定程序");
    }
    if (this.platform !== "win32") {
      throw new TaskServiceError("CONFLICT", "当前版本仅支持绑定 Windows 程序");
    }

    const executablePath = parsed.executablePath
      ? path.win32.normalize(parsed.executablePath)
      : null;
    const executableName = parsed.matchMode === "exact_path" && executablePath
      ? path.win32.basename(executablePath)
      : path.win32.basename(parsed.executableName);

    return this.rules.transaction(() => {
      this.rules.deleteForTask(parsed.taskId);
      return this.rules.insert({
        id: this.idFactory(),
        taskId: parsed.taskId,
        platform: this.platform,
        executableName,
        executablePath,
        bundleId: null,
        matchMode: parsed.matchMode,
        createdAt: this.clock.now().toISOString()
      });
    });
  }

  removeRules(taskId: string): boolean {
    const task = this.tasks.findTask(taskId);
    if (!task) throw new TaskServiceError("NOT_FOUND", "任务不存在");
    return this.rules.deleteForTask(taskId) > 0;
  }
}
