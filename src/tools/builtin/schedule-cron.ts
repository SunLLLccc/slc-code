// ScheduleCronTool — SLC-managed schedule via .slc/schedules/

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";

// ---------------------------------------------------------------------------
// Cron validation
// ---------------------------------------------------------------------------

const CRON_FIELD_COUNT = 5;

/**
 * Basic cron format validation: 5 space-separated fields.
 * Each field may contain digits, *, commas, hyphens, and slashes.
 */
function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== CRON_FIELD_COUNT) return false;

  const fieldPattern = /^[\d*,\-/]+$/;
  return fields.every((f) => fieldPattern.test(f));
}

// ---------------------------------------------------------------------------
// Schedule record
// ---------------------------------------------------------------------------

interface ScheduleRecord {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const scheduleCronTool: Tool = buildTool({
  name: "ScheduleCron",
  description: "Schedule a cron job",
  security: {
    readOnly: false,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        cron: { type: "string", description: "Cron expression (5 fields)" },
        prompt: { type: "string", description: "Prompt to enqueue" },
        recurring: { type: "boolean", description: "Whether the job recurs (default: true)" },
      },
      required: ["cron", "prompt"],
    },
  },
  validate(input: ToolInput): string | undefined {
    const cron = input.cron as string;
    if (!isValidCron(cron)) {
      return `Invalid cron expression: "${cron}". Expected 5 fields (minute hour day-of-month month day-of-week).`;
    }
    return undefined;
  },
  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const cron = (input.cron as string).trim();
    const prompt = input.prompt as string;
    const recurring = (input.recurring as boolean) ?? true;

    const id = randomUUID().replace(/-/g, "").slice(0, 12);
    const record: ScheduleRecord = {
      id,
      cron,
      prompt,
      recurring,
      createdAt: new Date().toISOString(),
    };

    const schedulesDir = join(context.cwd, ".slc", "schedules");

    try {
      await mkdir(schedulesDir, { recursive: true });
      await writeFile(
        join(schedulesDir, `${id}.json`),
        JSON.stringify(record, null, 2) + "\n",
        "utf-8",
      );
    } catch (err) {
      return {
        output: `Failed to save schedule: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }

    return {
      output: `Schedule created with ID: ${id}\nCron: ${cron}\nRecurring: ${recurring}\nPrompt: ${prompt}`,
      metadata: { jobId: id },
    };
  },
});
