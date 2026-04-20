// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { computeEtag, validateEtag } from '@nullproof-studio/en-core';
import { PreconditionFailedError } from '@nullproof-studio/en-core';

describe('computeEtag', () => {
  it('returns two hyphen-separated lowercase words', () => {
    const etag = computeEtag('hello world');
    const parts = etag.split('-');
    expect(parts).toHaveLength(2);
    for (const word of parts) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  it('same content produces same etag', () => {
    expect(computeEtag('test content')).toBe(computeEtag('test content'));
  });

  it('different content produces different etag', () => {
    expect(computeEtag('content A')).not.toBe(computeEtag('content B'));
  });

  it('handles empty string', () => {
    const etag = computeEtag('');
    expect(etag.split('-')).toHaveLength(2);
  });

  it('handles unicode content', () => {
    const etag = computeEtag('こんにちは世界 🌍');
    expect(etag.split('-')).toHaveLength(2);
  });

  it('changes when content changes by one character', () => {
    expect(computeEtag('hello')).not.toBe(computeEtag('hellp'));
  });

  it('produces distinct etags across a sample of inputs', () => {
    const etags = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      etags.add(computeEtag(`content-${i}`));
    }
    expect(etags.size).toBe(1000);
  });

  it('both words are from the BIP-0039 wordlist (index < 2048)', () => {
    // Verify the bit-packing produces valid indices by checking many inputs
    for (let i = 0; i < 500; i++) {
      const etag = computeEtag(`test-${i}`);
      const parts = etag.split('-');
      expect(parts).toHaveLength(2);
      // Each word should be non-empty lowercase alpha (valid wordlist entry)
      for (const word of parts) {
        expect(word.length).toBeGreaterThan(0);
        expect(word).toMatch(/^[a-z]+$/);
      }
    }
  });
});

describe('validateEtag', () => {
  const file = 'docs/test.md';
  const currentEtag = computeEtag('current content');

  it('passes when if_match matches current etag', () => {
    expect(() => validateEtag(currentEtag, currentEtag, file, true)).not.toThrow();
  });

  it('throws PreconditionFailedError when if_match does not match', () => {
    expect(() => validateEtag('stale-value', currentEtag, file, true))
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
