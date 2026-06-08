import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PromptSection {
  id: string;
  content: string;
  priority: number; // lower = higher priority
  cacheable?: boolean;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "../../resources/prompts");

/**
 * Load a prompt template from resources/prompts/{name}.md
 */
export async function loadPromptTemplate(name: string): Promise<string> {
  const filePath = join(PROMPTS_DIR, `${name}.md`);
  return readFile(filePath, "utf-8");
}

/**
 * Build ordered prompt sections from options.
 * Lower priority number = appears earlier in the prompt.
 */
export function buildSections(options: {
  systemPrompt?: string;
  rules?: string[];
  memory?: string;
}): PromptSection[] {
  const sections: PromptSection[] = [];

  if (options.systemPrompt) {
    sections.push({
      id: "system",
      content: options.systemPrompt,
      priority: 100,
      cacheable: true,
    });
  }

  if (options.rules && options.rules.length > 0) {
    sections.push({
      id: "rules",
      content: options.rules.join("\n"),
      priority: 200,
    });
  }

  if (options.memory) {
    sections.push({
      id: "memory",
      content: options.memory,
      priority: 300,
    });
  }

  return sections.sort((a, b) => a.priority - b.priority);
}
