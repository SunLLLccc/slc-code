// Non-interactive execution — --print and --stdin wired through QueryEngine

import type { Provider } from "../engine/providers/base.js";
import { QueryEngine } from "../engine/engine.js";
import type { StreamEvent } from "../engine/types.js";
import { assembleSystemPrompt } from "../prompt/assembly.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NonInteractiveResult {
  /** The text output from the model. */
  text: string;
  /** Whether an error occurred. */
  hasError: boolean;
  /** Error message if hasError is true. */
  errorMessage?: string;
  /** All events for optional streaming. */
  events: StreamEvent[];
}

// ---------------------------------------------------------------------------
// Execute a single query and collect the text result
// ---------------------------------------------------------------------------

/**
 * Run a single query in non-interactive mode.
 * Returns the collected text output and metadata.
 */
export async function executePrint(
  provider: Provider,
  query: string,
  options?: { signal?: AbortSignal; cwd?: string; userConfigDir?: string; skipPromptAssembly?: boolean },
): Promise<NonInteractiveResult> {
  const systemPrompt = await assembleSystemPrompt({
    cwd: options?.cwd,
    userConfigDir: options?.userConfigDir,
    skip: options?.skipPromptAssembly,
  });
  const engine = new QueryEngine(provider, systemPrompt ? { systemPrompt } : undefined);
  const events: StreamEvent[] = [];
  let hasError = false;
  let errorMessage: string | undefined;

  for await (const event of engine.query(query)) {
    events.push(event);

    if (event.type === "error") {
      hasError = true;
      errorMessage = event.error.message;
    }
  }

  // Collect text from events
  let text = "";
  for (const event of events) {
    if (event.type === "text_delta") {
      text += event.text;
    }
    if (event.type === "done") break;
  }

  return { text, hasError, errorMessage, events };
}

/**
 * Read stdin and execute as a single query.
 * Returns the same result as executePrint.
 */
export async function executeStdin(
  provider: Provider,
  options?: { signal?: AbortSignal; cwd?: string; userConfigDir?: string; skipPromptAssembly?: boolean },
): Promise<NonInteractiveResult> {
  const query = await readStdin();
  if (!query.trim()) {
    return {
      text: "",
      hasError: true,
      errorMessage: "No input from stdin",
      events: [],
    };
  }
  return executePrint(provider, query, options);
}

/** Read all of stdin as a string. */
function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data);
    });
    // If stdin is not a pipe (e.g. terminal), resolve empty immediately
    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}
