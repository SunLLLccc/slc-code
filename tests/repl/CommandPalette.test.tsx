import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { CommandPalette } from "../../src/repl/components/CommandPalette.js";
import type { Command } from "../../src/commands/registry.js";

const mockCommands: Command[] = [
  { name: "help", description: "Show help info", aliases: ["h", "?"], execute: async () => "" },
  { name: "clear", description: "Clear conversation", execute: async () => "" },
  { name: "config", description: "View configuration", execute: async () => "" },
  { name: "model", description: "View/switch model", usage: "/model <name>", execute: async () => "" },
];

describe("CommandPalette", () => {
  it("shows all commands when filter is empty", () => {
    const { lastFrame } = render(<CommandPalette commands={mockCommands} filter="" selectedIndex={0} />);
    expect(lastFrame()).toContain("/help");
    expect(lastFrame()).toContain("/clear");
    expect(lastFrame()).toContain("/config");
    expect(lastFrame()).toContain("/model");
  });

  it("filters commands by name", () => {
    const { lastFrame } = render(<CommandPalette commands={mockCommands} filter="mo" selectedIndex={0} />);
    expect(lastFrame()).toContain("/model");
    expect(lastFrame()).not.toContain("/help");
  });

  it("shows aliases in parentheses", () => {
    const { lastFrame } = render(<CommandPalette commands={mockCommands} filter="" selectedIndex={0} />);
    expect(lastFrame()).toContain("(h, ?)");
  });

  it("shows usage when present", () => {
    const { lastFrame } = render(<CommandPalette commands={mockCommands} filter="" selectedIndex={0} />);
    expect(lastFrame()).toContain("/model <name>");
  });

  it("shows descriptions", () => {
    const { lastFrame } = render(<CommandPalette commands={mockCommands} filter="" selectedIndex={0} />);
    expect(lastFrame()).toContain("Show help info");
  });

  it("shows no matching message when filter has no results", () => {
    const { lastFrame } = render(<CommandPalette commands={mockCommands} filter="xyz" selectedIndex={0} />);
    expect(lastFrame()).toContain("No matching");
  });
});
