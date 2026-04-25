// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { levenshtein, rankByLevenshtein } from '@nullproof-studio/en-core';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('docs', 'docs')).toBe(0);
  });

  it('returns length of other string when one is empty', () => {
    expect(levenshtein('', 'docs')).toBe(4);
    expect(levenshtein('docs', '')).toBe(4);
  });

  it('counts a single substitution', () => {
    expect(levenshtein('docs', 'dogs')).toBe(1);
  });

  it('counts a single insertion', () => {
    expect(levenshtein('docs', 'doces')).toBe(1);
  });

  it('counts a single deletion', () => {
    expect(levenshtein('docs', 'dcs')).toBe(1);
  });

  it('counts mixed edits', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('rankByLevenshtein', () => {
  it('returns the closest matches first', () => {
    const result = rankByLevenshtein('docs', ['memory', 'docs', 'dogs', 'docks'], 4);
    expect(result.slice(0, 3)).toEqual(['docs', 'docks', 'dogs']);
    expect(result[3]).toBe('memory');
  });

  it('caps results at limit', () => {
    const candidates = ['docs', 'dogs', 'doxs', 'docx', 'dock'];
    const result = rankByLevenshtein('docs', candidates, 3);
    expect(result.length).toBe(3);
    expect(result[0]).toBe('docs');
  });

  it('breaks ties lexically for determinism', () => {
    // All distance 1 from "docs"
    const result = rankByLevenshtein('docs', ['zogs', 'aogs', 'mogs'], 3);
    expect(result).toEqual(['aogs', 'mogs', 'zogs']);
  });

  it('is case-insensitive when ranking', () => {
    const result = rankByLevenshtein('DOCS', ['skills', 'Docs', 'memory'], 1);
    expect(result).toEqual(['Docs']);
  });

  it('returns empty array for empty candidate list', () => {
    expect(rankByLevenshtein('docs', [], 20)).toEqual([]);
  });

  it('handles limit larger than candidate count', () => {
    const result = rankByLevenshtein('docs', ['dogs', 'cats'], 20);
    expect(result.length).toBe(2);
  });
});
