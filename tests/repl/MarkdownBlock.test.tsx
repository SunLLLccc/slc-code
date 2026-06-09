import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { MarkdownBlock } from "../../src/repl/components/MarkdownBlock.js";

describe("MarkdownBlock", () => {
  it("renders plain text", () => {
    const { lastFrame } = render(<MarkdownBlock content="hello world" />);
    expect(lastFrame()).toContain("hello world");
  });

  it("renders bold text without asterisks", () => {
    const { lastFrame } = render(<MarkdownBlock content="this is **bold** text" />);
    expect(lastFrame()).toContain("bold");
    expect(lastFrame()).not.toContain("**");
  });

  it("renders code blocks", () => {
    const { lastFrame } = render(<MarkdownBlock content={'```python\nprint("hello")\n```'} />);
    expect(lastFrame()).toContain('print("hello")');
  });

  it("renders inline code without backticks", () => {
    const { lastFrame } = render(<MarkdownBlock content="use `npm install` to install" />);
    expect(lastFrame()).toContain("npm install");
    expect(lastFrame()).not.toContain("`");
  });

  it("renders list items with bullets", () => {
    const { lastFrame } = render(<MarkdownBlock content="- item 1\n- item 2" />);
    expect(lastFrame()).toContain("item 1");
    expect(lastFrame()).toContain("item 2");
  });

  it("renders links as text (url)", () => {
    const { lastFrame } = render(<MarkdownBlock content="[click here](https://example.com)" />);
    expect(lastFrame()).toContain("click here");
    expect(lastFrame()).toContain("https://example.com");
  });
});
