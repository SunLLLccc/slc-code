import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { StartupPanel, getLayoutMode } from "../../src/repl/components/StartupPanel.js";

// ---------------------------------------------------------------------------
// getLayoutMode (pure function)
// ---------------------------------------------------------------------------

describe("getLayoutMode", () => {
  it("returns sideBySide for >= 100 columns", () => {
    expect(getLayoutMode(100)).toBe("sideBySide");
    expect(getLayoutMode(120)).toBe("sideBySide");
    expect(getLayoutMode(200)).toBe("sideBySide");
  });

  it("returns stacked for 60-99 columns", () => {
    expect(getLayoutMode(99)).toBe("stacked");
    expect(getLayoutMode(80)).toBe("stacked");
    expect(getLayoutMode(60)).toBe("stacked");
  });

  it("returns compact for < 60 columns", () => {
    expect(getLayoutMode(59)).toBe("compact");
    expect(getLayoutMode(40)).toBe("compact");
    expect(getLayoutMode(20)).toBe("compact");
  });
});

// ---------------------------------------------------------------------------
// StartupPanel rendering
// ---------------------------------------------------------------------------

// ink-testing-library defaults stdout.columns to a large number (>= 100),
// so the default render gives us the sideBySide layout.

describe("StartupPanel", () => {
  const defaultProps = {
    version: "0.1.0",
    model: "test-model-v4",
    cwd: "/home/user/project",
  };

  it("displays slc code and version", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("slc code");
    expect(frame).toContain("0.1.0");
  });

  it("displays model name", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    expect(lastFrame()).toContain("test-model-v4");
  });

  it("displays cwd", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    expect(lastFrame()).toContain("project");
  });

  it("displays tips", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("Tips for getting started");
    expect(frame).toContain("Press / to use commands");
    expect(frame).toContain("Press @ to mention files");
    expect(frame).toContain("Press Esc twice to reset");
  });

  it("displays No recent activity", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    expect(lastFrame()).toContain("No recent activity");
  });

  it("displays Runtime section", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("Runtime");
    expect(frame).toContain("Model: test-model-v4");
  });

  it("renders logo characters in wide layout (ink-testing-library default >= 100 cols)", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    // The logo uses ▀ or ▄ half-block characters
    const frame = lastFrame();
    expect(frame).toMatch(/▀|▄/);
  });

  it("renders cyan border in wide layout", () => {
    const { lastFrame } = render(<StartupPanel {...defaultProps} />);
    // Round border uses ╭╮╰╯ or ┌┐└┘ box characters
    const frame = lastFrame();
    expect(frame).toMatch(/[╭╮╰╯┌┐└┘│─]/);
  });

  it("shortens home directory to ~", () => {
    const home = process.env.HOME ?? "/home/user";
    const { lastFrame } = render(
      <StartupPanel {...defaultProps} cwd={`${home}/projects/my-app`} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("~");
  });
});
