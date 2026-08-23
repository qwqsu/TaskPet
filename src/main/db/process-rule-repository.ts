import type { TaskDatabase } from "./database";
import type { ProcessMatchMode, TaskProcessRule } from "../../shared/process-types";

interface ProcessRuleRow {
  id: string;
  task_id: string;
  platform: string;
  executable_name: string | null;
  executable_path: string | null;
  bundle_id: string | null;
  match_mode: ProcessMatchMode;
  created_at: string;
}

export interface NewProcessRule {
  id: string;
  taskId: string;
  platform: string;
  executableName: string | null;
  executablePath: string | null;
  bundleId: string | null;
  matchMode: ProcessMatchMode;
  createdAt: string;
}

function toProcessRule(row: ProcessRuleRow): TaskProcessRule {
  return {
    id: row.id,
    taskId: row.task_id,
    platform: row.platform,
    executableName: row.executable_name,
    executablePath: row.executable_path,
    bundleId: row.bundle_id,
    matchMode: row.match_mode,
    createdAt: row.created_at
  };
}

export class ProcessRuleRepository {
  constructor(private readonly database: TaskDatabase) {}

  transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  listAll(): TaskProcessRule[] {
    const rows = this.database.prepare(`
      SELECT * FROM task_process_rules
      ORDER BY created_at, id
    `).all() as ProcessRuleRow[];
    return rows.map(toProcessRule);
  }

  listForTask(taskId: string): TaskProcessRule[] {
    const rows = this.database.prepare(`
      SELECT * FROM task_process_rules
      WHERE task_id = ?
      ORDER BY created_at, id
    `).all(taskId) as ProcessRuleRow[];
    return rows.map(toProcessRule);
  }

  insert(rule: NewProcessRule): TaskProcessRule {
    this.database.prepare(`
      INSERT INTO task_process_rules (
        id, task_id, platform, executable_name, executable_path,
        bundle_id, match_mode, created_at
      ) VALUES (
        @id, @taskId, @platform, @executableName, @executablePath,
        @bundleId, @matchMode, @createdAt
      )
    `).run(rule);
    return this.require(rule.id);
  }

  deleteForTask(taskId: string): number {
    return this.database.prepare(
      "DELETE FROM task_process_rules WHERE task_id = ?"
    ).run(taskId).changes;
  }

  private require(id: string): TaskProcessRule {
    const row = this.database.prepare(
      "SELECT * FROM task_process_rules WHERE id = ?"
    ).get(id) as ProcessRuleRow | undefined;
    if (!row) throw new Error(`Process rule not found: ${id}`);
    return toProcessRule(row);
  }
}
