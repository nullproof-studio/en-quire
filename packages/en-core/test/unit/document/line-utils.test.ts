// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import {
  countLines,
  lineToOffset,
  offsetToLine,
  readLineRange,
  replaceLineRange,
} from '@nullproof-studio/en-core';

const doc = 'alpha\nbeta\ngamma\ndelta\n';
// Layout (1-indexed):
//   line 1 "alpha"   bytes 0..5   (newline at 5)
//   line 2 "beta"    bytes 6..10  (newline at 10)
//   line 3 "gamma"   bytes 11..16 (newline at 16)
//   line 4 "delta"   bytes 17..22 (newline at 22)
// total length 23, 4 lines (trailing \n does not make a fifth line)

describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0);
  });

  it('counts a single line with no newline', () => {
    expect(countLines('foo')).toBe(1);
  });

  it('counts a single line with trailing newline', () => {
    expect(countLines('foo\n')).toBe(1);
  });

  it('counts multiple lines', () => {
    expect(countLines(doc)).toBe(4);
  });
});

describe('lineToOffset ↔ offsetToLine', () => {
  it('maps line 1 to offset 0', () => {
    expect(lineToOffset(doc, 1)).toBe(0);
  });

  it('maps line 2 to offset after first newline', () => {
    expect(lineToOffset(doc, 2)).toBe(6);
    expect(doc.slice(6, 10)).toBe('beta');
  });

  it('round-trips offset → line → offset for line starts', () => {
    for (let ln = 1; ln <= countLines(doc); ln++) {
      const offset = lineToOffset(doc, ln);
      expect(offsetToLine(doc, offset)).toBe(ln);
    }
  });

  it('offsets past EOF clamp to last line', () => {
    expect(offsetToLine(doc, 1000)).toBe(4);
  });

  it('lineToOffset past EOF returns content length', () => {
    expect(lineToOffset(doc, 99)).toBe(doc.length);
  });
});

describe('readLineRange', () => {
  it('reads a single line', () => {
    expect(readLineRange(doc, 2, 2)).toBe('beta\n');
  });

  it('reads a multi-line range', () => {
    expect(readLineRange(doc, 2, 3)).toBe('beta\ngamma\n');
  });

  it('reads last line without trailing newline when file has none', () => {
    const noTrailing = 'alpha\nbeta';
    expect(readLineRange(noTrailing, 2, 2)).toBe('beta');
  });

  it('reads entire document', () => {
    expect(readLineRange(doc, 1, 4)).toBe(doc);
  });

  it('throws when startLine < 1', () => {
    expect(() => readLineRange(doc, 0, 1)).toThrow(/startLine/);
  });

  it('throws when endLine < startLine', () => {
    expect(() => readLineRange(doc, 3, 2)).toThrow(/endLine/);
  });

  it('throws when startLine exceeds document length', () => {
    expect(() => readLineRange(doc, 99, 99)).toThrow(/exceeds/);
  });
});

describe('replaceLineRange', () => {
  it('replaces a single line', () => {
    expect(replaceLineRange(doc, 2, 2, 'BETA\n')).toBe('alpha\nBETA\ngamma\ndelta\n');
  });

  it('replaces multiple lines with fewer', () => {
    expect(replaceLineRange(doc, 2, 3, 'MIDDLE\n')).toBe('alpha\nMIDDLE\ndelta\n');
  });

  it('replaces with more lines than the range', () => {
    expect(replaceLineRange(doc, 2, 2, 'x\ny\nz\n')).toBe('alpha\nx\ny\nz\ngamma\ndelta\n');
  });

  it('inserts at start when endLine = startLine - 1', () => {
    // Insert before line 2 (between alpha and beta) → no deletion
    expect(replaceLineRange(doc, 2, 1, 'INS\n')).toBe('alpha\nINS\nbeta\ngamma\ndelta\n');
  });

  it('inserts at line 1 = before everything', () => {
    expect(replaceLineRange(doc, 1, 0, 'HEAD\n')).toBe('HEAD\nalpha\nbeta\ngamma\ndelta\n');
  });

  it('replaces the entire document', () => {
    expect(replaceLineRange(doc, 1, 4, 'NEW\n')).toBe('NEW\n');
  });

  it('throws when startLine < 1 and not the insertion special case', () => {
    expect(() => replaceLineRange(doc, 0, 0, 'x')).toThrow(/startLine/);
  });
});
