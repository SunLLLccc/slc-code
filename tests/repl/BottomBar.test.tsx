import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { BottomBar } from "../../src/repl/components/BottomBar.js";

describe("BottomBar", () => {
  it("displays shortcut hints", () => {
    const { lastFrame } = render(<BottomBar inputTokens={0} outputTokens={0} />);
    expect(lastFrame()).toContain("↑↓");
    expect(lastFrame()).toContain("Tab");
    expect(lastFrame()).toContain("Ctrl+C");
  });

  it("displays token stats when available", () => {
    const { lastFrame } = render(<BottomBar inputTokens={500} outputTokens={700} />);
    expect(lastFrame()).toContain("500");
    expect(lastFrame()).toContain("700");
  });

  it("displays estimate when no token data", () => {
    const { lastFrame } = render(<BottomBar inputTokens={0} outputTokens={0} estimatedOutputTokens={120} />);
    expect(lastFrame()).toContain("~120");
  });
});
