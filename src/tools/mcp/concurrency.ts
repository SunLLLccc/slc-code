// MCP Connection Concurrency Limiter — semaphore-based

export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(maxConcurrent: number) {
    if (maxConcurrent < 1) {
      throw new Error("maxConcurrent must be at least 1");
    }
    this.maxConcurrent = maxConcurrent;
  }

  /** Run `fn` when a slot is available. Excess calls queue and wait. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Number of calls currently waiting for a slot. */
  getQueueSize(): number {
    return this.queue.length;
  }

  private acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  private release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}
