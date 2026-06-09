// AskUserTool — callback-based user prompting

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";

// ---------------------------------------------------------------------------
// Re-export callback type for external consumers
// ---------------------------------------------------------------------------

export type AskUserCallback = (questions: string[]) => Promise<string[]>;

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const askUserTool: Tool = buildTool({
  name: "AskUser",
  description: "Ask the user questions interactively",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          description: "Questions to ask",
          items: { type: "string" },
        },
      },
      required: ["questions"],
    },
  },
  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const questions = input.questions as string[];
    const askUser = context.askUser;

    if (!askUser) {
      return {
        output: "AskUser not available in non-interactive mode",
        isError: true,
      };
    }

    try {
      const answers = await askUser(questions);
      if (answers.length !== questions.length) {
        return {
          output: `Expected ${questions.length} answers, got ${answers.length}`,
          isError: true,
        };
      }

      // Format Q&A pairs
      const formatted = questions
        .map((q, i) => `Q: ${q}\nA: ${answers[i]}`)
        .join("\n\n");

      return { output: formatted };
    } catch (err) {
      return {
        output: `AskUser error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
});
