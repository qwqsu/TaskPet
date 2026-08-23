import { openTaskDatabase, type TaskDatabase } from "../src/main/db/database";
import { TaskService, type TaskClock } from "../src/main/services/task-service";

export class MutableClock implements TaskClock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}

export interface TaskHarness {
  database: TaskDatabase;
  clock: MutableClock;
  service: TaskService;
  close(): void;
}

export function createTaskHarness(
  initialDate = new Date(2026, 7, 23, 9, 30, 0)
): TaskHarness {
  const database = openTaskDatabase(":memory:", {
    migrationTimestamp: "2026-08-23T00:00:00.000Z"
  });
  const clock = new MutableClock(initialDate);
  let idCounter = 0;
  const service = new TaskService(database, {
    clock,
    idFactory: () => {
      idCounter += 1;
      const suffix = idCounter.toString(16).padStart(12, "0");
      return `00000000-0000-4000-8000-${suffix}`;
    }
  });

  return {
    database,
    clock,
    service,
    close: () => database.close()
  };
}
