// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { countWords } from '@nullproof-studio/en-core';

describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only content', () => {
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('counts simple English words', () => {
    expect(countWords('hello world')).toBe(2);
  });

  it('ignores punctuation', () => {
    expect(countWords('Hello, world! How are you?')).toBe(5);
  });

  it('counts contractions as one word', () => {
    // Intl.Segmenter treats "don't" as a single word
    expect(countWords("don't do that")).toBe(3);
  });

  it('strips fenced code blocks', () => {
    const md = [
      'Prose before.',
      '```js',
      'const a = 1;',
      'function foo() { return a; }',
      '```',
      'Prose after.',
    ].join('\n');
    // "Prose before" (2) + "Prose after" (2) = 4 — code block excluded
    expect(countWords(md)).toBe(4);
  });

  it('strips tilde-fenced code blocks', () => {
    const md = 'before\n~~~\nlots of code tokens\n~~~\nafter';
    expect(countWords(md)).toBe(2);
  });

  it('counts inline code as words', () => {
    // Inline `code` stays in the text; the backticks are punctuation and
    // the token inside counts as one word.
    expect(countWords('use `foo` here')).toBe(3);
  });

  it('counts CJK content using segmenter (not whitespace split)', () => {
    // "今天天气很好" = "Today the weather is nice" — no spaces, but
    // Intl.Segmenter breaks it into word-like segments.
    // The exact segment count is locale-dependent but must be > 1.
    const count = countWords('今天天气很好');
    expect(count).toBeGreaterThan(1);
  });

  it('counts markdown-formatted text correctly', () => {
    // **bold** and *italic* asterisks are punctuation; words inside count once.
    expect(countWords('**bold** and *italic* text')).toBe(4);
  });

  it('handles multi-paragraph content', () => {
    const md = 'First paragraph here.\n\nSecond paragraph too.';
    expect(countWords(md)).toBe(6);
  });

  it('handles indented code blocks loosely (not stripped)', () => {
    // Four-space indented code is Markdown's alternate code block form, but
    // stripping it reliably is hard. We accept that indented code contributes
    // to the count — fenced blocks (the common case in modern Markdown) are
    // what matter, and those are stripped.
    const md = 'prose\n\n    const a = 1;\n\nmore prose';
    expect(countWords(md)).toBeGreaterThan(4);
  });

  it('counts words in a realistic section body', () => {
    const body = [
      '**Claim:** Three agent identities are live on the public internet.',
      '',
      '**Evidence:**',
      '',
      '- First bullet point with several words.',
      '- Second bullet point also with words.',
    ].join('\n');
    // Rough expectation: ~20 words
    const count = countWords(body);
    expect(count).toBeGreaterThanOrEqual(18);
    expect(count).toBeLessThanOrEqual(24);
  });
});
