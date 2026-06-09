import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { InputLine } from "../../src/repl/components/InputLine.js";

describe("InputLine", () => {
  it("shows green prompt in normal mode", () => {
    const { lastFrame } = render(<InputLine value="hello" isAskMode={false} />);
    expect(lastFrame()).toContain("❯");
    expect(lastFrame()).toContain("hello");
  });

  it("shows yellow prompt in AskUser mode", () => {
    const { lastFrame } = render(<InputLine value="answer" isAskMode={true} />);
    expect(lastFrame()).toContain("❓");
    expect(lastFrame()).toContain("answer");
  });

  it("shows cursor block", () => {
    const { lastFrame } = render(<InputLine value="" isAskMode={false} />);
    expect(lastFrame()).toContain("█");
  });
});
