// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { normaliseForFallback } from '@nullproof-studio/en-core';

describe('normaliseForFallback', () => {
  it('returns identical strings unchanged', () => {
    expect(normaliseForFallback('plain ascii text')).toBe('plain ascii text');
  });

  it('folds curly double quotes to straight ascii', () => {
    expect(normaliseForFallback('he said “hello”')).toBe('he said "hello"');
  });

  it('folds curly single quotes and apostrophes to straight ascii', () => {
    expect(normaliseForFallback('it’s a ‘thing’')).toBe("it's a 'thing'");
  });

  it('folds en-dash and em-dash to ascii hyphen', () => {
    expect(normaliseForFallback('$150–200M and 1—2')).toBe('$150-200M and 1-2');
  });

  it('folds the Unicode minus sign to ascii hyphen', () => {
    expect(normaliseForFallback('temp −5 degrees')).toBe('temp -5 degrees');
  });

  it('replaces NBSP (U+00A0) with a regular space', () => {
    expect(normaliseForFallback('two words')).toBe('two words');
  });

  it('replaces tab characters with a single space', () => {
    expect(normaliseForFallback('col1\tcol2')).toBe('col1 col2');
  });

  it('strips zero-width and bidi-override characters entirely', () => {
    // U+200B zero-width space, U+200C ZWNJ, U+200D ZWJ, U+200E LTR, U+200F RTL,
    // U+202E RTL override, U+FEFF BOM
    const dirty = 'a​b‌c‍d‎e‏f‮g﻿h';
    expect(normaliseForFallback(dirty)).toBe('abcdefgh');
  });

  it('collapses runs of whitespace to a single space', () => {
    expect(normaliseForFallback('a   b\n\nc\t\td')).toBe('a b c d');
  });

  it('applies NFKC compatibility decomposition (ligatures, full-width)', () => {
    // U+FB01 (ﬁ ligature) decomposes to "fi" under NFKC
    expect(normaliseForFallback('ofﬁce')).toBe('office');
    // Full-width digits decompose to ascii under NFKC
    expect(normaliseForFallback('１２３')).toBe('123');
  });

  it('combines all the above transformations in one pass', () => {
    const messy = '“It’s $150–200M”​';
    expect(normaliseForFallback(messy)).toBe('"It\'s $150-200M"');
  });

  it('produces equal output for source and quote that differ only in cosmetic punctuation', () => {
    const source = 'She wrote: “we raised $14M”.';
    const quote = '"we raised $14M"';
    expect(normaliseForFallback(source)).toContain(normaliseForFallback(quote));
  });

  it('returns empty string for empty input', () => {
    expect(normaliseForFallback('')).toBe('');
  });

  it('preserves leading and trailing content but collapses internal whitespace', () => {
    expect(normaliseForFallback('  hello  world  ')).toBe(' hello world ');
  });
});
