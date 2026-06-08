// CostTracker — minimal skeleton for recording provider usage and estimating cost

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost in USD. */
  costUsd: number;
  /** ISO timestamp. */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Placeholder price table (per 1M tokens)
// Real pricing can be loaded from config in later phases.
// ---------------------------------------------------------------------------

const PRICE_TABLE: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-8": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/** Get price per 1M tokens for a model, with a conservative default. */
function getPrice(
  model: string,
): { input: number; output: number } {
  // Try exact match first, then prefix match
  if (PRICE_TABLE[model]) return PRICE_TABLE[model];
  for (const [key, price] of Object.entries(PRICE_TABLE)) {
    if (model.startsWith(key)) return price;
  }
  // Default: use gpt-4o pricing as fallback
  return PRICE_TABLE["gpt-4o"]!;
}

// ---------------------------------------------------------------------------
// CostTracker
// ---------------------------------------------------------------------------

export class CostTracker {
  private readonly records: UsageRecord[] = [];

  /**
   * Record a single provider call's usage.
   */
  record(opts: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): UsageRecord {
    const price = getPrice(opts.model);
    const costUsd =
      (opts.inputTokens / 1_000_000) * price.input +
      (opts.outputTokens / 1_000_000) * price.output;

    const record: UsageRecord = {
      provider: opts.provider,
      model: opts.model,
      inputTokens: opts.inputTokens,
      outputTokens: opts.outputTokens,
      costUsd,
      timestamp: new Date().toISOString(),
    };

    this.records.push(record);
    return record;
  }

  /** Total estimated cost in USD. */
  getTotalCost(): number {
    return this.records.reduce((sum, r) => sum + r.costUsd, 0);
  }

  /** Total input tokens. */
  getTotalInputTokens(): number {
    return this.records.reduce((sum, r) => sum + r.inputTokens, 0);
  }

  /** Total output tokens. */
  getTotalOutputTokens(): number {
    return this.records.reduce((sum, r) => sum + r.outputTokens, 0);
  }

  /** Number of recorded calls. */
  getCallCount(): number {
    return this.records.length;
  }

  /** Return a snapshot of all records. */
  getRecords(): UsageRecord[] {
    return [...this.records];
  }

  /** Reset the tracker. */
  reset(): void {
    this.records.length = 0;
  }

  /** Format a cost summary string. */
  formatSummary(): string {
    const total = this.getTotalCost();
    return (
      `Session cost: $${total.toFixed(4)} ` +
      `(${this.getCallCount()} calls, ` +
      `${this.getTotalInputTokens()} in / ${this.getTotalOutputTokens()} out tokens)`
    );
  }
}
