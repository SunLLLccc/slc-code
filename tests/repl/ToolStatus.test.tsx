import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ToolStatusLine } from "../../src/repl/components/ToolStatus.js";
import type { ToolCallStatus } from "../../src/repl/output-types.js";

describe("ToolStatusLine", () => {
  it("shows pending state with dim color", () => {
    const status: ToolCallStatus = { id: "1", name: "bash", params: "ls -la", state: "pending" };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("●");
    expect(lastFrame()).toContain("bash");
    expect(lastFrame()).toContain("ls -la");
  });

  it("shows pending state without params", () => {
    const status: ToolCallStatus = { id: "1", name: "bash", params: "", state: "pending" };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("●");
    expect(lastFrame()).toContain("bash");
  });

  it("shows success state with result summary", () => {
    const status: ToolCallStatus = { id: "1", name: "bash", params: "ls -la", state: "success", result: "3 lines" };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("✓");
    expect(lastFrame()).toContain("bash");
    expect(lastFrame()).toContain("3 lines");
  });

  it("shows error state with error message", () => {
    const status: ToolCallStatus = { id: "1", name: "bash", params: "rm -rf /", state: "error", result: "Permission denied" };
    const { lastFrame } = render(<ToolStatusLine status={status} />);
    expect(lastFrame()).toContain("✗");
    expect(lastFrame()).toContain("Permission denied");
  });
});
