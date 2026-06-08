// Tool scheduler — partition, validate, and execute tool calls

import type { Tool, ToolInput, ToolOutput, ToolContext } from "./base.js";
import type { ToolRegistry } from "./registry.js";
import { validateSchema } from "./validate.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ScheduledResult {
  toolCallId: string;
  toolName: string;
  output: ToolOutput;
}

export type PermissionChecker = (
  tool: Tool,
  input: ToolInput,
  context: ToolContext,
) => "allow" | "deny" | "ask";

// ---------------------------------------------------------------------------
// PreToolUse Hook — P5 placeholder for P11 real implementation
// ---------------------------------------------------------------------------

export interface PreToolUseHook {
  /** Unique name for debugging. */
  readonly name: string;
  /**
   * Called after semantic validation, before permission checks.
   * Return "deny" to block execution, "allow" to proceed.
   * Throw → treated as deny with standard error result.
   */
  run(tool: Tool, input: ToolInput, context: ToolContext): Promise<"allow" | "deny">;
}

// ---------------------------------------------------------------------------
// Scheduler options
// ---------------------------------------------------------------------------

export interface SchedulerOptions {
  /** External permission checker (e.g. user consent UI). */
  permissionChecker?: PermissionChecker;
  /** PreToolUse hooks — executed in order after semantic validation, before permissions. */
  preToolUseHooks?: PreToolUseHook[];
}

// ---------------------------------------------------------------------------
// Partition tool calls by concurrency safety
// ---------------------------------------------------------------------------

export interface PartitionedCalls {
  /** Safe to execute in parallel. */
  parallel: ToolCall[];
  /** Must execute serially. */
  serial: ToolCall[];
}

/**
 * Partition tool calls into parallel-safe and serial groups.
 * Tools not found in the registry are placed in serial (fail-safe).
 */
export function partitionToolCalls(
  calls: ToolCall[],
  registry: ToolRegistry,
): PartitionedCalls {
  const parallel: ToolCall[] = [];
  const serial: ToolCall[] = [];

  for (const call of calls) {
    const tool = registry.get(call.name);
    if (tool && tool.security.concurrencySafe) {
      parallel.push(call);
    } else {
      // Unknown tools or non-concurrency-safe tools go to serial
      serial.push(call);
    }
  }

  return { parallel, serial };
}

// ---------------------------------------------------------------------------
// Parse and validate tool input
// ---------------------------------------------------------------------------

function parseArguments(raw: string): { ok: true; value: ToolInput } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Tool arguments must be a JSON object" };
    }
    return { ok: true, value: parsed as ToolInput };
  } catch (e) {
    return { ok: false, error: `Invalid JSON in tool arguments: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Execute a single tool call through the full pipeline
// ---------------------------------------------------------------------------

async function executeOne(
  call: ToolCall,
  registry: ToolRegistry,
  context: ToolContext,
  options?: SchedulerOptions,
): Promise<ScheduledResult> {
  // 1. Look up tool
  const tool = registry.get(call.name);
  if (!tool) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      output: {
        output: `Unknown tool: ${call.name}`,
        isError: true,
      },
    };
  }

  // 2. Parse arguments
  const parsed = parseArguments(call.arguments);
  if (!parsed.ok) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      output: { output: parsed.error, isError: true },
    };
  }
  const input = parsed.value;

  // 3. JSON Schema validation
  const schemaErrors = validateSchema(input, tool.schema.input);
  if (schemaErrors.length > 0) {
    const message = schemaErrors
      .map((e) => `${e.path}: ${e.message}`)
      .join("; ");
    return {
      toolCallId: call.id,
      toolName: call.name,
      output: { output: `Schema validation failed: ${message}`, isError: true },
    };
  }

  // 4. Semantic validation — wrapped in try/catch to prevent bare exceptions
  if (tool.validate) {
    let validationError: string | undefined;
    try {
      validationError = tool.validate(input);
    } catch (e) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: {
          output: `Validation error: ${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        },
      };
    }
    if (validationError) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: { output: validationError, isError: true },
      };
    }
  }

  // 5. PreToolUse hooks — executed in order, any deny stops pipeline
  // P5 placeholder: real hooks implemented in P11
  const hooks = options?.preToolUseHooks ?? [];
  for (const hook of hooks) {
    let hookDecision: "allow" | "deny";
    try {
      hookDecision = await hook.run(tool, input, context);
    } catch (e) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: {
          output: `Hook "${hook.name}" error: ${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        },
      };
    }
    if (hookDecision === "deny") {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: {
          output: `Hook "${hook.name}" denied tool: ${call.name}`,
          isError: true,
        },
      };
    }
  }

  // 6. Tool-level permission check (PRD 7.2: tool deny is highest priority)
  if (tool.checkPermissions) {
    let toolDecision: "allow" | "deny" | "ask";
    try {
      toolDecision = tool.checkPermissions(input, context);
    } catch (e) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: {
          output: `Permission check error: ${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        },
      };
    }
    if (toolDecision === "deny") {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: { output: `Tool denied execution: ${call.name}`, isError: true },
      };
    }
    if (toolDecision === "ask") {
      // P5: no UI → treat as blocked
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: { output: `Tool requires confirmation: ${call.name}`, isError: true },
      };
    }
    // tool allows → proceed to external permission checker
  }

  // 7. External permission check — wrapped in try/catch
  const permissionChecker = options?.permissionChecker;
  if (permissionChecker) {
    let decision: "allow" | "deny" | "ask";
    try {
      decision = permissionChecker(tool, input, context);
    } catch (e) {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: {
          output: `External permission check error: ${e instanceof Error ? e.message : String(e)}`,
          isError: true,
        },
      };
    }
    if (decision === "deny") {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: { output: `Permission denied for tool: ${call.name}`, isError: true },
      };
    }
    if (decision === "ask") {
      return {
        toolCallId: call.id,
        toolName: call.name,
        output: { output: `Tool requires confirmation: ${call.name}`, isError: true },
      };
    }
  }

  // 8. Execute
  try {
    const output = await tool.execute(input, context);
    return {
      toolCallId: call.id,
      toolName: call.name,
      output,
    };
  } catch (e) {
    return {
      toolCallId: call.id,
      toolName: call.name,
      output: {
        output: `Tool execution error: ${e instanceof Error ? e.message : String(e)}`,
        isError: true,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Schedule and execute tool calls
// ---------------------------------------------------------------------------

export interface ScheduleResult {
  results: ScheduledResult[];
  /**
   * Collected context modifiers from all tool executions in this batch.
   * For parallel batches, these are gathered after the entire batch completes
   * to prevent races. P5 placeholder: modifiers are collected but not applied;
   * actual application is deferred to P6/P7.
   */
  contextModifiers: Array<Record<string, unknown>>;
}

/**
 * Execute a batch of tool calls through the scheduler.
 *
 * 1. Partition into parallel-safe and serial groups.
 * 2. Execute parallel group concurrently; collect context modifiers after batch.
 * 3. Execute serial group sequentially.
 * 4. Return all results + collected context modifiers.
 */
export async function scheduleToolCalls(
  calls: ToolCall[],
  registry: ToolRegistry,
  context: ToolContext,
  permissionCheckerOrOptions?: PermissionChecker | SchedulerOptions,
): Promise<ScheduleResult> {
  // Backward-compatible overload: accept raw PermissionChecker or full options
  const options: SchedulerOptions | undefined =
    typeof permissionCheckerOrOptions === "function"
      ? { permissionChecker: permissionCheckerOrOptions }
      : permissionCheckerOrOptions;

  if (calls.length === 0) {
    return { results: [], contextModifiers: [] };
  }

  const { parallel, serial } = partitionToolCalls(calls, registry);
  const results: ScheduledResult[] = [];
  const contextModifiers: Array<Record<string, unknown>> = [];

  // Execute parallel group concurrently
  if (parallel.length > 0) {
    const parallelResults = await Promise.all(
      parallel.map((call) => executeOne(call, registry, context, options)),
    );
    // Collect context modifiers AFTER entire parallel batch completes
    // Only successful results contribute contextModifiers
    for (const r of parallelResults) {
      results.push(r);
      if (!r.output.isError && r.output.contextModifier) {
        contextModifiers.push(r.output.contextModifier);
      }
    }
  }

  // Execute serial group sequentially
  for (const call of serial) {
    const result = await executeOne(call, registry, context, options);
    results.push(result);
    if (!result.output.isError && result.output.contextModifier) {
      contextModifiers.push(result.output.contextModifier);
    }
  }

  return { results, contextModifiers };
}
