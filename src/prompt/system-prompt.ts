import { loadPromptTemplate } from "./sections.js";

/**
 * Build the complete system prompt string.
 *
 * Loads the default template from resources/prompts/system.md
 * (or uses a provided override), then appends rules and memory sections.
 */
export async function buildSystemPrompt(options: {
  template?: string;
  rules?: string[];
  memory?: string;
}): Promise<string> {
  const base = options.template ?? (await loadPromptTemplate("system"));

  const parts: string[] = [base];

  if (options.rules && options.rules.length > 0) {
    parts.push("## Rules\n");
    parts.push(options.rules.join("\n"));
  }

  if (options.memory) {
    parts.push("## Memory\n");
    parts.push(options.memory);
  }

  return parts.join("\n\n");
}
