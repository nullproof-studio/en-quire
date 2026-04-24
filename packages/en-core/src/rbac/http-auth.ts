// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { createHash, timingSafeEqual } from 'node:crypto';
import type { CallerConfig, CallerIdentity } from '../shared/types.js';

export type AuthResult =
  | { ok: true; caller: CallerIdentity }
  | { ok: false; reason: 'missing' | 'malformed' | 'invalid' };

/**
 * Extract the token from a `Bearer <token>` Authorization header.
 * Returns null when:
 *   - the header is absent or empty
 *   - the scheme is anything other than `Bearer` (case-sensitive — "bearer"
 *     also returns null so misconfigurations surface loudly rather than
 *     silently passing on some clients but not others)
 *   - the scheme is `Bearer` but the token part is missing or blank
 */
export function parseBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) return null;
  const token = match[1];
  return token.length > 0 ? token : null;
}

/**
 * Authenticate an incoming request against the configured callers.
 *
 * Comparison is constant-time via SHA-256 hash + `timingSafeEqual` — both
 * sides are reduced to a fixed 32-byte buffer before comparison, so token
 * length is not leaked through timing. Every configured caller is iterated
 * even after a match to equalise loop timing.
 *
 * Callers without a `key` (stdio-only callers) are skipped outright.
 */
export function authenticateBearer(
  authHeader: string | undefined,
  callers: Record<string, CallerConfig>,
): AuthResult {
  if (authHeader === undefined) {
    return { ok: false, reason: 'missing' };
  }

  const token = parseBearerToken(authHeader);
  if (token === null) {
    return { ok: false, reason: 'malformed' };
  }

  const tokenHash = createHash('sha256').update(token).digest();
  let matched: { id: string; config: CallerConfig } | null = null;

  for (const [id, config] of Object.entries(callers)) {
    if (!config.key) continue;
    const keyHash = createHash('sha256').update(config.key).digest();
    const equal = timingSafeEqual(tokenHash, keyHash);
    if (equal && matched === null) {
      matched = { id, config };
    }
    // deliberately continue iterating so total time is independent of
    // match position
  }

  if (matched) {
    return {
      ok: true,
      caller: { id: matched.id, scopes: matched.config.scopes },
    };
  }
  return { ok: false, reason: 'invalid' };
}
