// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
//
// Regression guards for the CodeQL `js/polynomial-redos` alerts on PR #93.
// Several heading/anchor regexes had an unanchored greedy `\s+ … \s*$` (or a
// trailing `+$`) shape that backtracks in O(n²) on whitespace-heavy input. Each
// timing test below runs in ~1s on the pre-fix code and a fraction of a
// millisecond once the backtracking is removed; the generous 200ms bound
// distinguishes the two without being sensitive to machine speed. The
// characterization tests pin the exact behaviour the fixes must preserve.
import { describe, it, expect } from 'vitest';
import { extractAnchor, slugify, assignAnchors } from '../../../src/document/anchors.js';
import { buildCitationAppend } from '../../../src/cite/append-citation.js';

/** Run `fn` and return its elapsed wall-clock time in milliseconds. */
function elapsed(fn: () => void): number {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

// Large enough that O(n²) backtracking takes ~1s, small enough not to hang.
const N = 50_000;
const BUDGET_MS = 200;

describe('ReDoS guards — pathological whitespace runs stay linear', () => {
  it('extractAnchor: a run of whitespace with no anchor returns fast', () => {
    const input = ' '.repeat(N);
    let result!: ReturnType<typeof extractAnchor>;
    const ms = elapsed(() => {
      result = extractAnchor(input);
    });
    expect(result).toEqual({ text: input });
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('assignAnchors: a heading whose text trails into whitespace returns fast', () => {
    // `\s+#+\s*$` (the closed-ATX stripper) is the quadratic culprit here: the
    // trailing whitespace makes it scan for a `#` run that never comes.
    const md = `## x${' '.repeat(N)}`;
    let out!: ReturnType<typeof assignAnchors>;
    const ms = elapsed(() => {
      out = assignAnchors(md);
    });
    expect(out.assigned).toHaveLength(1);
    expect(out.assigned[0].anchorId).toBe('x');
    expect(ms).toBeLessThan(BUDGET_MS);
  });

  it('buildCitationAppend: a whitespace-heavy body ending in text returns fast', () => {
    const before = `${' '.repeat(N)}x`; // trailing non-space defeats `/\s+$/`
    let out = '';
    const ms = elapsed(() => {
      out = buildCitationAppend(before, '[1] ref', 'Citations');
    });
    expect(out).toContain('## Citations');
    expect(out).toContain('[1] ref');
    expect(ms).toBeLessThan(BUDGET_MS);
  });
});

describe('ReDoS guards — behaviour the fixes must preserve', () => {
  it('extractAnchor tolerates trailing whitespace after the id', () => {
    expect(extractAnchor('Heading ^id   ')).toEqual({ text: 'Heading', anchorId: 'id' });
  });

  it('extractAnchor still ignores carets without leading whitespace', () => {
    expect(extractAnchor('E = mc^2')).toEqual({ text: 'E = mc^2' });
  });

  it('slugify strips leading and trailing separators', () => {
    expect(slugify('  --Foo__Bar--  ')).toBe('foo-bar');
    expect(slugify('---')).toBe('');
  });

  it('assignAnchors strips a closed-ATX closer before deriving the slug', () => {
    const { content, assigned } = assignAnchors('## Foo ##\n');
    expect(content).toContain('## Foo ^foo');
    expect(assigned[0].anchorId).toBe('foo');
  });

  it('buildCitationAppend trims a normal trailing-newline body unchanged', () => {
    const out = buildCitationAppend('# Doc\n\nBody\n\n', '[1] ref', 'Citations');
    expect(out).toBe('# Doc\n\nBody\n\n## Citations\n\n[1] ref\n');
  });
});
