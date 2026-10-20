/** 完成状态与运行计时分离；旧任务保留达标即停止的行为。 */
import type { Migration } from "./001-init";

export const continueTimingMigration: Migration = {
  version: 3,
  name: "continue-timing",
  sql: `ALTER TABLE tasks ADD COLUMN continue_timing_after_completion INTEGER NOT NULL DEFAULT 0
    CHECK (continue_timing_after_completion IN (0, 1));`
};
