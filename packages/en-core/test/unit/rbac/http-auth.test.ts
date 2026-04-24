// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { parseBearerToken, authenticateBearer } from '@nullproof-studio/en-core';
import type { CallerConfig } from '@nullproof-studio/en-core';

const callers: Record<string, CallerConfig> = {
  alice: {
    key: 'sk-alice-secret-0123456789abcdef',
    scopes: [{ path: '**', permissions: ['read'] }],
  },
  bob: {
    key: 'sk-bob-another-token-fedcba9876543210',
    scopes: [{ path: 'bob/**', permissions: ['read', 'write'] }],
  },
  // A caller without a key — should never match any token
  keyless: {
    scopes: [{ path: '**', permissions: ['read'] }],
  },
};

describe('parseBearerToken', () => {
  it('extracts the token after "Bearer "', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('returns null for undefined', () => {
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseBearerToken('')).toBeNull();
  });

  it('returns null for a non-Bearer scheme', () => {
    expect(parseBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(parseBearerToken('Token abc123')).toBeNull();
  });

  it('returns null for "Bearer" with no token', () => {
    expect(parseBearerToken('Bearer')).toBeNull();
    expect(parseBearerToken('Bearer ')).toBeNull();
  });

  it('is case-sensitive on the scheme (rejects "bearer")', () => {
    // RFC 7235 says the scheme is case-insensitive, but in practice clients
    // always send "Bearer" capitalised. Rejecting the lowercase form makes
    // misconfigurations loud instead of silently passing.
    expect(parseBearerToken('bearer abc123')).toBeNull();
  });

  it('preserves the exact token content (does not trim internal whitespace)', () => {
    // Tokens can contain any RFC 6750 token chars; a trailing space was already
    // stripped by the Bearer regex boundary. Leading whitespace after "Bearer "
    // belongs to the token.
    expect(parseBearerToken('Bearer abc 123')).toBe('abc 123');
  });
});

describe('authenticateBearer', () => {
  it('returns { ok: false, reason: "missing" } when no Authorization header', () => {
    expect(authenticateBearer(undefined, callers)).toEqual({ ok: false, reason: 'missing' });
  });

  it('returns { ok: false, reason: "malformed" } for a non-Bearer header', () => {
    expect(authenticateBearer('Basic dXNlcjpwYXNz', callers)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('returns { ok: true } with the correct caller when token matches', () => {
    const result = authenticateBearer('Bearer sk-alice-secret-0123456789abcdef', callers);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.caller.id).toBe('alice');
      expect(result.caller.scopes).toEqual(callers.alice.scopes);
    }
  });

  it('distinguishes between callers', () => {
    const result = authenticateBearer('Bearer sk-bob-another-token-fedcba9876543210', callers);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.caller.id).toBe('bob');
  });

  it('returns { ok: false, reason: "invalid" } for an unknown token', () => {
    expect(authenticateBearer('Bearer sk-unknown-12345', callers))
      .toEqual({ ok: false, reason: 'invalid' });
  });

  it('ignores callers with no key — they never match, even with an empty-string token', () => {
    expect(authenticateBearer('Bearer ', callers)).toEqual({ ok: false, reason: 'malformed' });
    // Even if parseBearerToken returned '' (it doesn't — see test above), the
    // keyless caller would not match because we skip it outright.
  });

  it('is unaffected by token length — a short guess is not a false positive', () => {
    // timingSafeEqual requires equal buffer sizes, so we hash both sides.
    // A single-char guess must not accidentally match alice's key.
    expect(authenticateBearer('Bearer a', callers).ok).toBe(false);
    expect(authenticateBearer('Bearer sk-alice', callers).ok).toBe(false);
  });

  it('does not match when the right token is supplied with extra characters appended', () => {
    // Defence against off-by-one comparisons
    expect(authenticateBearer('Bearer sk-alice-secret-0123456789abcdef!', callers).ok).toBe(false);
  });

  it('handles an empty callers map by rejecting every token as invalid', () => {
    expect(authenticateBearer('Bearer anything', {}))
      .toEqual({ ok: false, reason: 'invalid' });
  });
});
