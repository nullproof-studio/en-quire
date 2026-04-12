// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { computeEtag, validateEtag } from '../../../src/shared/etag.js';
import { PreconditionFailedError } from '../../../src/shared/errors.js';

describe('computeEtag', () => {
  it('returns a 16-char hex string', () => {
    const etag = computeEtag('hello world');
    expect(etag).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same content produces same etag', () => {
    expect(computeEtag('test content')).toBe(computeEtag('test content'));
  });

  it('different content produces different etag', () => {
    expect(computeEtag('content A')).not.toBe(computeEtag('content B'));
  });

  it('handles empty string', () => {
    const etag = computeEtag('');
    expect(etag).toMatch(/^[0-9a-f]{16}$/);
  });

  it('handles unicode content', () => {
    const etag = computeEtag('こんにちは世界 🌍');
    expect(etag).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when content changes by one character', () => {
    expect(computeEtag('hello')).not.toBe(computeEtag('hellp'));
  });
});

describe('validateEtag', () => {
  const file = 'docs/test.md';
  const currentEtag = computeEtag('current content');

  it('passes when if_match matches current etag', () => {
    expect(() => validateEtag(currentEtag, currentEtag, file, true)).not.toThrow();
  });

  it('throws PreconditionFailedError when if_match does not match', () => {
    expect(() => validateEtag('stale_etag_value', currentEtag, file, true))
      .toThrow(PreconditionFailedError);
  });

  it('throws PreconditionFailedError when if_match is undefined and feature enabled', () => {
    expect(() => validateEtag(undefined, currentEtag, file, true))
      .toThrow(PreconditionFailedError);
  });

  it('passes when if_match is undefined and feature disabled', () => {
    expect(() => validateEtag(undefined, currentEtag, file, false)).not.toThrow();
  });

  it('passes when if_match mismatches but feature disabled', () => {
    expect(() => validateEtag('wrong', currentEtag, file, false)).not.toThrow();
  });

  it('error includes current_etag for recovery', () => {
    try {
      validateEtag('stale', currentEtag, file, true);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PreconditionFailedError);
      expect((err as PreconditionFailedError).current_etag).toBe(currentEtag);
    }
  });

  it('error includes file path', () => {
    try {
      validateEtag('stale', currentEtag, file, true);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as PreconditionFailedError).file).toBe(file);
    }
  });

  it('error code is precondition_failed', () => {
    try {
      validateEtag('stale', currentEtag, file, true);
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as PreconditionFailedError).code).toBe('precondition_failed');
    }
  });
});
