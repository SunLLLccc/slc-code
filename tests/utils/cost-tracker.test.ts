// Tests for CostTracker

import { describe, it, expect } from "vitest";
import { CostTracker } from "../../src/utils/cost-tracker.js";

describe("CostTracker", () => {
  it("records a single call and computes cost", () => {
    const tracker = new CostTracker();
    const record = tracker.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(record.provider).toBe("anthropic");
    expect(record.model).toBe("claude-sonnet-4-6");
    expect(record.inputTokens).toBe(1000);
    expect(record.outputTokens).toBe(500);
    // claude-sonnet-4-6: $3/1M input, $15/1M output
    // cost = 1000/1M * 3 + 500/1M * 15 = 0.003 + 0.0075 = 0.0105
    expect(record.costUsd).toBeCloseTo(0.0105, 6);
  });

  it("accumulates totals across multiple calls", () => {
    const tracker = new CostTracker();
    tracker.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
    });
    tracker.record({
      provider: "openai",
      model: "gpt-4o",
      inputTokens: 2000,
      outputTokens: 1000,
    });

    expect(tracker.getCallCount()).toBe(2);
    expect(tracker.getTotalInputTokens()).toBe(3000);
    expect(tracker.getTotalOutputTokens()).toBe(1500);
    expect(tracker.getTotalCost()).toBeGreaterThan(0);
  });

  it("uses fallback pricing for unknown models", () => {
    const tracker = new CostTracker();
    const record = tracker.record({
      provider: "local",
      model: "llama3-custom",
      inputTokens: 1000,
      outputTokens: 500,
    });

    // Unknown model uses gpt-4o fallback pricing: $2.5/1M input, $10/1M output
    expect(record.costUsd).toBeCloseTo(0.0075, 6);
  });

  it("reset() clears all records", () => {
    const tracker = new CostTracker();
    tracker.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(tracker.getCallCount()).toBe(1);
    tracker.reset();
    expect(tracker.getCallCount()).toBe(0);
    expect(tracker.getTotalCost()).toBe(0);
  });

  it("formatSummary() returns readable string", () => {
    const tracker = new CostTracker();
    tracker.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
    });

    const summary = tracker.formatSummary();
    expect(summary).toContain("$0.0105");
    expect(summary).toContain("1 calls");
    expect(summary).toContain("1000 in");
    expect(summary).toContain("500 out");
  });

  it("getRecords() returns a snapshot", () => {
    const tracker = new CostTracker();
    tracker.record({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      inputTokens: 1000,
      outputTokens: 500,
    });

    const records = tracker.getRecords();
    expect(records).toHaveLength(1);
    // Mutating the snapshot should not affect the tracker
    records.push({
      provider: "fake",
      model: "fake",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      timestamp: "",
    });
    expect(tracker.getRecords()).toHaveLength(1);
  });
});
