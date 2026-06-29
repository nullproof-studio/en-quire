// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect, beforeEach } from 'vitest';
import { CiteRateLimiter } from '@nullproof-studio/en-core';

let now: number;
const clock = () => now;

beforeEach(() => {
  now = 1_700_000_000_000;
});

describe('CiteRateLimiter', () => {
  it('allows up to limit calls within the window', () => {
    const rl = new CiteRateLimiter({ perMinute: 3, clock });
    expect(rl.tryAcquire('agent-a')).toBe(true);
    expect(rl.tryAcquire('agent-a')).toBe(true);
    expect(rl.tryAcquire('agent-a')).toBe(true);
  });

  it('rejects the (limit + 1)-th call within the window', () => {
    const rl = new CiteRateLimiter({ perMinute: 2, clock });
    rl.tryAcquire('agent-a');
    rl.tryAcquire('agent-a');
    expect(rl.tryAcquire('agent-a')).toBe(false);
  });

  it('tracks each caller independently', () => {
    const rl = new CiteRateLimiter({ perMinute: 1, clock });
    expect(rl.tryAcquire('agent-a')).toBe(true);
    expect(rl.tryAcquire('agent-b')).toBe(true);
    expect(rl.tryAcquire('agent-a')).toBe(false);
    expect(rl.tryAcquire('agent-b')).toBe(false);
  });

  it('frees up tokens after the window expires', () => {
    const rl = new CiteRateLimiter({ perMinute: 2, clock });
    rl.tryAcquire('agent-a');
    rl.tryAcquire('agent-a');
    expect(rl.tryAcquire('agent-a')).toBe(false);
    now += 60_001;
    expect(rl.tryAcquire('agent-a')).toBe(true);
  });

  it('a partial window slide preserves recent timestamps', () => {
    const rl = new CiteRateLimiter({ perMinute: 2, clock });
    rl.tryAcquire('agent-a'); // t=0
    now += 30_000;
    rl.tryAcquire('agent-a'); // t=30s
    now += 35_000;            // t=65s — first call (t=0) is now > 60s old, second still in window
    expect(rl.tryAcquire('agent-a')).toBe(true); // first slot freed
    expect(rl.tryAcquire('agent-a')).toBe(false); // window full again
  });

  it('a perMinute of 0 rejects all calls', () => {
    const rl = new CiteRateLimiter({ perMinute: 0, clock });
    expect(rl.tryAcquire('agent-a')).toBe(false);
  });
});
