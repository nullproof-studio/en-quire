// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { findText } from '@nullproof-studio/en-core';

const doc = [
  'alpha',
  'beta',
  'gamma FOO bar',
  'delta',
  'epsilon foo',
  'zeta FOObar',
  'eta',
  'theta',
].join('\n') + '\n';

describe('findText', () => {
  it('returns empty array for empty query', () => {
    expect(findText(doc, '')).toEqual([]);
  });

  it('returns empty array when no matches', () => {
    expect(findText(doc, 'zzzzz')).toEqual([]);
  });

  it('finds case-sensitive matches by default', () => {
    const hits = findText(doc, 'FOO');
    expect(hits.length).toBe(2);
    expect(hits[0].line).toBe(3);
    expect(hits[1].line).toBe(6);
  });

  it('finds case-insensitive matches when asked', () => {
    const hits = findText(doc, 'FOO', { case_sensitive: false });
    expect(hits.length).toBe(3);
    expect(hits.map(h => h.line)).toEqual([3, 5, 6]);
    // matched_text preserves the case of the original content
    expect(hits[0].matched_text).toBe('FOO');
    expect(hits[1].matched_text).toBe('foo');
    expect(hits[2].matched_text).toBe('FOO');
  });

  it('reports 1-indexed line and column', () => {
    const [hit] = findText(doc, 'FOO');
    expect(hit.line).toBe(3);
    // "gamma FOO bar" — F is at column 7 (1-indexed)
    expect(hit.col).toBe(7);
    expect(hit.offset).toBe(doc.indexOf('FOO'));
  });

  it('whole_word=true rejects matches inside a larger word', () => {
    // "FOObar" on line 6 should not match "FOO" under whole_word
    const hits = findText(doc, 'FOO', { whole_word: true });
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(3);
  });

  it('does not return overlapping matches', () => {
    const content = 'aaaa\n';
    // "aa" in "aaaa" naïvely has 3 matches at 0, 1, 2; we want non-overlapping: 0, 2
    const hits = findText(content, 'aa');
    expect(hits.length).toBe(2);
    expect(hits.map(h => h.offset)).toEqual([0, 2]);
  });

  it('includes context_before and context_after at requested depth', () => {
    const hits = findText(doc, 'FOO', { context_lines: 2 });
    const first = hits[0]; // line 3
    expect(first.context_before).toBe('alpha\nbeta\n');
    expect(first.context_after).toBe('delta\nepsilon foo\n');
  });

  it('clamps context near document edges', () => {
    const hits = findText(doc, 'alpha', { context_lines: 10 });
    const hit = hits[0]; // line 1
    expect(hit.context_before).toBe('');
    // All 7 remaining lines follow
    expect(hit.context_after.split('\n').filter(Boolean).length).toBe(7);
  });

  it('context_lines: 0 yields empty context strings', () => {
    const [hit] = findText(doc, 'FOO', { context_lines: 0 });
    expect(hit.context_before).toBe('');
    expect(hit.context_after).toBe('');
  });
});
