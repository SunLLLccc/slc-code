import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TopBar } from "../../src/repl/components/TopBar.js";

describe("TopBar", () => {
  it("displays product name", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId="abc-123-def" />,
    );
    expect(lastFrame()).toContain("slc code");
  });

  it("displays model name", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId="abc-123-def" />,
    );
    expect(lastFrame()).toContain("deepseek-v4-pro");
  });

  it("truncates session ID to 8 chars", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId="abc-123-def-456" />,
    );
    expect(lastFrame()).toContain("abc-123-");
    expect(lastFrame()).not.toContain("abc-123-def-456");
  });

  it("handles null session ID", () => {
    const { lastFrame } = render(
      <TopBar model="deepseek-v4-pro" sessionId={null} />,
    );
    expect(lastFrame()).toContain("no-session");
  });
});
