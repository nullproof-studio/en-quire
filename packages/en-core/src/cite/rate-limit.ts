// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

export interface CiteRateLimiterOptions {
  /** Maximum external citation attempts per caller per 60-second window. */
  perMinute: number;
  /** Pluggable for tests. Defaults to Date.now. */
  clock?: () => number;
}

/**
 * In-memory sliding-window rate limiter for external citation attempts.
 * Per-caller; window is fixed at 60 seconds. Process-local — restarts of the
 * MCP server reset the limiter, which is acceptable because every attempt is
 * also persisted to cite_audit_log.
 */
export class CiteRateLimiter {
  private readonly perMinute: number;
  private readonly clock: () => number;
  private readonly window = 60_000;
  private readonly buckets = new Map<string, number[]>();

  constructor(opts: CiteRateLimiterOptions) {
    this.perMinute = opts.perMinute;
    this.clock = opts.clock ?? (() => Date.now());
  }

  tryAcquire(caller_id: string): boolean {
    if (this.perMinute <= 0) return false;
    const now = this.clock();
    const cutoff = now - this.window;
    const bucket = (this.buckets.get(caller_id) ?? []).filter((t) => t > cutoff);
    if (bucket.length >= this.perMinute) {
      this.buckets.set(caller_id, bucket);
      return false;
    }
    bucket.push(now);
    this.buckets.set(caller_id, bucket);
    return true;
  }
}
