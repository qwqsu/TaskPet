import { z } from "zod";
import { isLocalDateKey } from "./local-date";

const titleSchema = z.string().trim().min(1, "任务标题不能为空").max(120, "任务标题不能超过 120 个字符");
const descriptionSchema = z.string().trim().max(2000, "任务描述不能超过 2000 个字符").nullable();
const p1CompletionModeSchema = z.enum(["manual", "duration"]);
const dateKeySchema = z.string().refine(isLocalDateKey, "日期必须是有效的 YYYY-MM-DD");

function validateDuration(
  value: { completionMode: "manual" | "duration"; targetDurationSec: number },
  context: z.RefinementCtx
): void {
  if (value.completionMode === "duration" && value.targetDurationSec <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetDurationSec"],
      message: "时长任务必须设置大于 0 的目标时长"
    });
  }

  if (value.completionMode === "manual" && value.targetDurationSec !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetDurationSec"],
      message: "手动任务的目标时长必须为 0"
    });
  }
}

export const CreateTaskInputSchema = z.object({
  title: titleSchema,
  description: descriptionSchema.optional().default(null),
  taskType: z.enum(["daily", "one_time"]),
  completionMode: p1CompletionModeSchema,
  targetDurationSec: z.number().int().nonnegative(),
  sortOrder: z.number().int().optional()
}).strict().superRefine(validateDuration);

export const UpdateTaskPatchSchema = z.object({
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  completionMode: p1CompletionModeSchema.optional(),
  targetDurationSec: z.number().int().nonnegative().optional(),
  sortOrder: z.number().int().optional()
}).strict().refine((patch) => Object.keys(patch).length > 0, "至少需要修改一个字段");

export const UpdateTaskInputSchema = z.object({
  id: z.string().uuid(),
  patch: UpdateTaskPatchSchema
}).strict();

export const TaskIdInputSchema = z.object({
  id: z.string().uuid()
}).strict();

export const OccurrenceIdInputSchema = z.object({
  occurrenceId: z.string().uuid()
}).strict();

export const HistoryQuerySchema = z.object({
  fromDate: dateKeySchema,
  toDate: dateKeySchema
}).strict().refine((query) => query.fromDate <= query.toDate, {
  path: ["fromDate"],
  message: "开始日期不能晚于结束日期"
});

export const EmptyTaskInputSchema = z.undefined();

export const PanelReadyInputSchema = z.object({
  ok: z.boolean()
}).strict();

export type CreateTaskInput = z.input<typeof CreateTaskInputSchema>;
export type UpdateTaskPatch = z.input<typeof UpdateTaskPatchSchema>;
export type UpdateTaskInput = z.input<typeof UpdateTaskInputSchema>;
export type TaskIdInput = z.input<typeof TaskIdInputSchema>;
export type OccurrenceIdInput = z.input<typeof OccurrenceIdInputSchema>;
export type HistoryQuery = z.input<typeof HistoryQuerySchema>;
