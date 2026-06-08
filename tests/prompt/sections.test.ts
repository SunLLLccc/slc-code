import { describe, it, expect } from "vitest";
import {
  loadPromptTemplate,
  buildSections,
  type PromptSection,
} from "../../src/prompt/sections.js";

describe("loadPromptTemplate", () => {
  it("loads system.md prompt template", async () => {
    const content = await loadPromptTemplate("system");
    expect(content).toBeTruthy();
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(0);
  });

  it("throws for non-existent template", async () => {
    await expect(loadPromptTemplate("nonexistent_xyz")).rejects.toThrow();
  });
});

describe("buildSections", () => {
  it("returns empty array when no options provided", () => {
    const sections = buildSections({});
    expect(sections).toEqual([]);
  });

  it("creates system section with priority 100", () => {
    const sections = buildSections({ systemPrompt: "Hello" });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "system",
      content: "Hello",
      priority: 100,
      cacheable: true,
    });
  });

  it("creates rules section with priority 200", () => {
    const sections = buildSections({ rules: ["Rule 1", "Rule 2"] });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "rules",
      content: "Rule 1\nRule 2",
      priority: 200,
    });
  });

  it("creates memory section with priority 300", () => {
    const sections = buildSections({ memory: "User prefers dark mode" });
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      id: "memory",
      content: "User prefers dark mode",
      priority: 300,
    });
  });

  it("sorts sections by priority (lower first)", () => {
    const sections = buildSections({
      memory: "mem",
      rules: ["rule"],
      systemPrompt: "sys",
    });
    expect(sections.map((s: PromptSection) => s.id)).toEqual([
      "system",
      "rules",
      "memory",
    ]);
  });

  it("skips rules when array is empty", () => {
    const sections = buildSections({ rules: [], systemPrompt: "sys" });
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe("system");
  });
});
