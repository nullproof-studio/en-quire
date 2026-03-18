// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown } from '../../../src/document/parser.js';
import { buildSectionTree } from '../../../src/document/section-tree.js';
import { findReplace } from '../../../src/document/section-ops.js';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/docs');

function parse(md: string) {
  const ast = parseMarkdown(md);
  return buildSectionTree(ast, md);
}

describe('findReplace — regex flag validation', () => {
  const md = readFileSync(resolve(fixturesDir, 'simple.md'), 'utf-8');
  const tree = parse(md);

  it('accepts valid flags', () => {
    expect(() => findReplace(md, tree, 'content', 'text', { flags: 'gi', preview: true })).not.toThrow();
    expect(() => findReplace(md, tree, 'content', 'text', { flags: 'gms', preview: true })).not.toThrow();
  });

  it('rejects invalid flags', () => {
    expect(() => findReplace(md, tree, 'content', 'text', { flags: 'gx', preview: true })).toThrow('Invalid regex flag "x"');
  });

  it('rejects completely invalid flag strings', () => {
    expect(() => findReplace(md, tree, 'content', 'text', { flags: 'abc', preview: true })).toThrow('Invalid regex flag');
  });
});
