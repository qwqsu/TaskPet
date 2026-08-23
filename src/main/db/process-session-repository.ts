/**
 * process_sessions 的 SQL 访问层。
 * checkpoint 更新恢复点；finalize 只允许把尚未结束的 Session 收尾一次。
 */
import type { TaskDatabase } from "./database";
import type { ProcessSession } from "../../shared/process-types";

interface ProcessSessionRow {
  id: string;
  task_id: string;
  occurrence_id: string;
  executable_name: string | null;
  executable_path: string | null;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  duration_sec: number;
  finalized: number;
}

export interface NewProcessSession {
  id: string;
  taskId: string;
  occurrenceId: string;
  executableName: string | null;
  executablePath: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  durationSec: number;
  finalized: boolean;
}

function toProcessSession(row: ProcessSessionRow): ProcessSession {
  return {
    id: row.id,
    taskId: row.task_id,
    occurrenceId: row.occurrence_id,
    executableName: row.executable_name,
    executablePath: row.executable_path,
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    endedAt: row.ended_at,
    durationSec: row.duration_sec,
    finalized: row.finalized === 1
  };
}

export class ProcessSessionRepository {
  constructor(private readonly database: TaskDatabase) {}

  insert(session: NewProcessSession): ProcessSession {
    this.database.prepare(`
      INSERT INTO process_sessions (
        id, task_id, occurrence_id, executable_name, executable_path,
        started_at, last_seen_at, ended_at, duration_sec, finalized
      ) VALUES (
        @id, @taskId, @occurrenceId, @executableName, @executablePath,
        @startedAt, @lastSeenAt, @endedAt, @durationSec, @finalized
      )
    `).run({ ...session, finalized: session.finalized ? 1 : 0 });
    return this.require(session.id);
  }

  listOpen(): ProcessSession[] {
    const rows = this.database.prepare(`
      SELECT * FROM process_sessions
      WHERE finalized = 0
      ORDER BY started_at, id
    `).all() as ProcessSessionRow[];
    return rows.map(toProcessSession);
  }

  checkpoint(id: string, lastSeenAt: string, durationSec: number): boolean {
    return this.database.prepare(`
      UPDATE process_sessions
      SET last_seen_at = ?, duration_sec = ?
      WHERE id = ? AND finalized = 0
    `).run(lastSeenAt, durationSec, id).changes === 1;
  }

  finalize(id: string, endedAt: string, durationSec: number): boolean {
    return this.database.prepare(`
      UPDATE process_sessions
      SET last_seen_at = ?, ended_at = ?, duration_sec = ?, finalized = 1
      WHERE id = ? AND finalized = 0
    `).run(endedAt, endedAt, durationSec, id).changes === 1;
  }

  listForOccurrence(occurrenceId: string): ProcessSession[] {
    const rows = this.database.prepare(`
      SELECT * FROM process_sessions
      WHERE occurrence_id = ?
      ORDER BY started_at, id
    `).all(occurrenceId) as ProcessSessionRow[];
    return rows.map(toProcessSession);
  }

  private require(id: string): ProcessSession {
    const row = this.database.prepare(
      "SELECT * FROM process_sessions WHERE id = ?"
    ).get(id) as ProcessSessionRow | undefined;
    if (!row) throw new Error(`Process session not found: ${id}`);
    return toProcessSession(row);
  }
}
