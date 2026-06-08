// Tests for non-interactive execution (--print / --stdin)

import { describe, it, expect } from "vitest";
import { MockProvider } from "../../src/engine/providers/base.js";
import { executePrint } from "../../src/core/noninteractive.js";

// ---------------------------------------------------------------------------
// executePrint
// ---------------------------------------------------------------------------

describe("executePrint", () => {
  it("returns text output from provider via QueryEngine", async () => {
    const provider = new MockProvider({ chunks: ["Hello from slc!"] });
    const result = await executePrint(provider, "Say hello");

    expect(result.text).toBe("Hello from slc!");
    expect(result.hasError).toBe(false);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("collects multi-chunk text", async () => {
    const provider = new MockProvider({ chunks: ["Line 1\n", "Line 2"] });
    const result = await executePrint(provider, "test");

    expect(result.text).toBe("Line 1\nLine 2");
  });

  it("reports error when provider throws", async () => {
    const provider = new (class {
      readonly name = "failing";
      readonly capabilities = {
        toolUse: true,
        streaming: true,
        vision: true,
        promptCache: true,
        extendedThinking: true,
      };
      async *chat() {
        throw new Error("API down");
      }
    })() as unknown as Parameters<typeof executePrint>[0];

    const result = await executePrint(provider, "test");

    expect(result.hasError).toBe(true);
    expect(result.errorMessage).toBe("API down");
  });

  it("returns empty text for empty provider response", async () => {
    const provider = new MockProvider({ chunks: [""] });
    const result = await executePrint(provider, "test");

    // MockProvider with empty chunk still yields "" then done
    expect(result.text).toBe("");
    expect(result.hasError).toBe(false);
  });
});
