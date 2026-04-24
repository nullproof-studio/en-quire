// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import '../../../src/parsers/plaintext-parser.js';
import { parserRegistry, ValidationError } from '@nullproof-studio/en-core';

describe('plaintext parser', () => {
  it('registers for .txt, .text, and .log', () => {
    expect(parserRegistry.getParser('a.txt').extensions).toContain('.txt');
    expect(parserRegistry.getParser('a.text').extensions).toContain('.text');
    expect(parserRegistry.getParser('a.log').extensions).toContain('.log');
  });

  it('returns a single whole-file pseudo-section', () => {
    const parser = parserRegistry.getParser('a.txt');
    const content = 'line one\nline two\nline three\n';
    const tree = parser.parse(content);
    expect(tree.length).toBe(1);
    expect(tree[0].heading.text).toBe('__whole');
    expect(tree[0].heading.level).toBe(0);
    expect(tree[0].bodyStartOffset).toBe(0);
    expect(tree[0].bodyEndOffset).toBe(content.length);
    expect(tree[0].sectionEndOffset).toBe(content.length);
    expect(tree[0].children).toEqual([]);
  });

  it('returns empty tree for empty content', () => {
    const parser = parserRegistry.getParser('a.txt');
    expect(parser.parse('')).toEqual([]);
  });

  it('parseAddress throws with a helpful message', () => {
    const parser = parserRegistry.getParser('a.txt');
    expect(() => parser.parseAddress('anything')).toThrow(ValidationError);
    expect(() => parser.parseAddress('anything')).toThrow(/line-range or anchor tools/);
  });

  it('validate returns empty warnings (plain text is always structurally valid)', () => {
    const parser = parserRegistry.getParser('a.txt');
    expect(parser.validate('anything')).toEqual([]);
    expect(parser.validate('')).toEqual([]);
  });

  it('declares generateToc: false capability', () => {
    expect(parserRegistry.getParser('a.txt').capabilities.generateToc).toBe(false);
  });
});
