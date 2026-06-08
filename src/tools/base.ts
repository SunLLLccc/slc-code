// Tool interface — fail-closed defaults for the slc-code tool system

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolInput {
  [key: string]: unknown;
}

export interface ToolOutput {
  /** Output text shown to the model. */
  output: string;
  /** Whether the execution resulted in an error. */
  isError?: boolean;
  /** Optional metadata for UI rendering. */
  metadata?: Record<string, unknown>;
  /**
   * Context modifier — changes to the shared context (e.g. file written,
   * working directory changed). Collected during a parallel batch and
   * applied after the entire batch completes to prevent races.
   * P5 placeholder: the scheduler collects these but does not apply them;
   * actual application is deferred to P6/P7 when concrete tools exist.
   */
  contextModifier?: Record<string, unknown>;
}

export interface ToolSecurity {
  /** Whether this tool only reads data (no side effects). Default: false. */
  readOnly: boolean;
  /** Whether this tool can safely run concurrently with other tools. Default: false. */
  concurrencySafe: boolean;
  /** Whether this tool is potentially destructive. Default: true. */
  destructive: boolean;
}

export interface ToolSchema {
  /** JSON Schema for tool input validation. */
  input: Record<string, unknown>;
  /** JSON Schema for tool output (optional). */
  output?: Record<string, unknown>;
}

export type PermissionDecision = "allow" | "deny" | "ask";

export interface ToolContext {
  /** Current working directory. */
  cwd: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Permission mode. */
  permissionMode?: string;
}

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

export interface Tool {
  /** Unique tool name (e.g. "file_read"). */
  readonly name: string;
  /** Human-readable description for the model. */
  readonly description: string;
  /** Input/output schemas. */
  readonly schema: ToolSchema;
  /** Security attributes — fail-closed defaults. */
  readonly security: ToolSecurity;

  /**
   * Execute the tool with validated input.
   * Returns the output to feed back to the model.
   */
  execute(input: ToolInput, context: ToolContext): Promise<ToolOutput>;

  /**
   * Semantic validation of input beyond JSON Schema.
   * Called after schema validation. Return an error message to reject,
   * or undefined/null to accept.
   */
  validate?(input: ToolInput): string | undefined;

  /**
   * Check permissions for this specific invocation.
   * Return "deny" to block, "ask" to prompt user, "allow" to proceed.
   * Default: delegates to the permission mode.
   */
  checkPermissions?(input: ToolInput, context: ToolContext): PermissionDecision;
}

// ---------------------------------------------------------------------------
// buildTool — convenience factory with fail-closed defaults
// ---------------------------------------------------------------------------

const FAIL_CLOSED_SECURITY: ToolSecurity = {
  readOnly: false,
  concurrencySafe: false,
  destructive: true,
};

export interface BuildToolOptions {
  name: string;
  description: string;
  schema: ToolSchema;
  security?: Partial<ToolSecurity>;
  execute: Tool["execute"];
  validate?: Tool["validate"];
  checkPermissions?: Tool["checkPermissions"];
}

/**
 * Create a Tool with fail-closed security defaults.
 * All safety-critical properties default to the most conservative value.
 */
export function buildTool(options: BuildToolOptions): Tool {
  return {
    name: options.name,
    description: options.description,
    schema: options.schema,
    security: {
      ...FAIL_CLOSED_SECURITY,
      ...options.security,
    },
    execute: options.execute,
    validate: options.validate,
    checkPermissions: options.checkPermissions,
  };
}
