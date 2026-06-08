// MCP Auth Cache — simple TTL + failure-blocking token cache

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuthEntry {
  serverName: string;
  token: string;
  expiresAt: number; // timestamp (ms)
  failedAt?: number; // timestamp of last failure
}

// ---------------------------------------------------------------------------
// McpAuthCache
// ---------------------------------------------------------------------------

const DEFAULT_FAILURE_TTL_MS = 15 * 60 * 1000; // 15 minutes

export class McpAuthCache {
  private readonly entries = new Map<string, AuthEntry>();
  private readonly failureTtlMs: number;

  constructor(failureTtlMs?: number) {
    this.failureTtlMs = failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
  }

  /** Store a token for `serverName` with an optional TTL (default: no expiry). */
  set(serverName: string, token: string, ttlMs?: number): void {
    this.entries.set(serverName, {
      serverName,
      token,
      expiresAt: ttlMs ? Date.now() + ttlMs : Number.MAX_SAFE_INTEGER,
    });
  }

  /** Return the cached token, or null if expired / failed / missing. */
  get(serverName: string): string | null {
    const entry = this.entries.get(serverName);
    if (!entry) return null;

    // Blocked due to failure
    if (entry.failedAt && Date.now() - entry.failedAt < this.failureTtlMs) {
      return null;
    }

    // Token expired
    if (Date.now() >= entry.expiresAt) {
      return null;
    }

    return entry.token;
  }

  /** Record a failure for `serverName`, blocking reads for failureTtlMs.
   *  Works even without a prior set() — creates a minimal entry if needed. */
  markFailed(serverName: string): void {
    let entry = this.entries.get(serverName);
    if (!entry) {
      entry = {
        serverName,
        token: "",
        expiresAt: 0,
      };
      this.entries.set(serverName, entry);
    }
    entry.failedAt = Date.now();
  }

  /** Whether `serverName` is currently within its failure blocking window.
   *  Returns true after markFailed() regardless of token existence. */
  isBlocked(serverName: string): boolean {
    const entry = this.entries.get(serverName);
    if (!entry || !entry.failedAt) return false;
    return Date.now() - entry.failedAt < this.failureTtlMs;
  }

  /** Remove all cached entries. */
  clear(): void {
    this.entries.clear();
  }
}
