// WebSearchTool — search the web via a pluggable SearchProvider

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { sanitizeUnicode } from "../../security/unicode.js";

// ---------------------------------------------------------------------------
// Search provider interface
// ---------------------------------------------------------------------------

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchProvider {
  search(query: string, maxResults?: number): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Default provider — returns informational message
// ---------------------------------------------------------------------------

const DEFAULT_MAX_RESULTS = 10;
const MAX_OUTPUT_BYTES = 10 * 1024; // 10KB

function defaultSearchProvider(): SearchProvider {
  return {
    async search(_query: string, _maxResults?: number): Promise<SearchResult[]> {
      return [];
    },
  };
}

// ---------------------------------------------------------------------------
// Module-level provider (can be swapped at runtime)
// ---------------------------------------------------------------------------

let activeProvider: SearchProvider | null = null;

/** Set the active search provider (called at startup or from config). */
export function setSearchProvider(provider: SearchProvider): void {
  activeProvider = provider;
}

/** Get the current search provider. */
export function getSearchProvider(): SearchProvider {
  return activeProvider ?? defaultSearchProvider();
}

// ---------------------------------------------------------------------------
// Format results to string with 10KB limit
// ---------------------------------------------------------------------------

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results found. No search provider is configured — use setSearchProvider() to register one.";
  }

  let output = "";
  for (const result of results) {
    const entry = `**${result.title}**\n${result.url}\n${result.snippet}\n\n`;
    if (output.length + entry.length > MAX_OUTPUT_BYTES) {
      output += "[Results truncated at 10KB]";
      break;
    }
    output += entry;
  }

  return output.trim();
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export const webSearchTool: Tool = buildTool({
  name: "WebSearch",
  description: "Search the web",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        maxResults: { type: "number", description: "Maximum results to return" },
      },
      required: ["query"],
    },
  },
  async execute(input: ToolInput, _context: ToolContext): Promise<ToolOutput> {
    const query = input.query as string;
    const maxResults = (input.maxResults as number) ?? DEFAULT_MAX_RESULTS;

    try {
      const provider = getSearchProvider();
      const results = await provider.search(query, maxResults);
      const output = formatResults(results);
      return { output: sanitizeUnicode(output) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        output: sanitizeUnicode(`Search error: ${message}`),
        isError: true,
      };
    }
  },
});
