// WebFetchTool — fetch a URL and return content

import type { Tool, ToolInput, ToolOutput, ToolContext } from "../base.js";
import { buildTool } from "../base.js";
import { sanitizeUnicode } from "../../security/unicode.js";

const MAX_RESPONSE_BYTES = 50 * 1024; // 50KB
const FETCH_TIMEOUT_MS = 30_000;

export const webFetchTool: Tool = buildTool({
  name: "WebFetch",
  description: "Fetch a URL and return content",
  security: {
    readOnly: true,
    concurrencySafe: true,
    destructive: false,
  },
  schema: {
    input: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch" },
        prompt: { type: "string", description: "Optional prompt for extraction" },
      },
      required: ["url"],
    },
  },
  async execute(input: ToolInput, context: ToolContext): Promise<ToolOutput> {
    const url = input.url as string;
    const signal = context.signal;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      // Combine external abort signal with our timeout
      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "slc-code/0.1.0",
          "Accept": "text/html, text/plain, application/json, */*",
        },
        redirect: "follow",
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          output: sanitizeUnicode(`HTTP ${response.status}: ${response.statusText} for ${url}`),
          isError: true,
        };
      }

      // Read response body with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        return { output: sanitizeUnicode("Empty response body") };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let truncated = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (totalBytes + value.length > MAX_RESPONSE_BYTES) {
          // Take only what we need to fill the limit
          const remaining = MAX_RESPONSE_BYTES - totalBytes;
          if (remaining > 0) {
            chunks.push(value.slice(0, remaining));
          }
          truncated = true;
          reader.cancel();
          break;
        }
        chunks.push(value);
        totalBytes += value.length;
      }

      // Decode as UTF-8
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let content = "";
      for (const chunk of chunks) {
        content += decoder.decode(chunk, { stream: true });
      }
      content += decoder.decode(); // flush

      if (truncated) {
        content += "\n\n[Response truncated at 50KB]";
      }

      return { output: sanitizeUnicode(content) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("aborted") || message.includes("AbortError")) {
        return {
          output: sanitizeUnicode(`Request timed out after ${FETCH_TIMEOUT_MS / 1000}s: ${url}`),
          isError: true,
        };
      }
      return {
        output: sanitizeUnicode(`Fetch error: ${message}`),
        isError: true,
      };
    }
  },
});
