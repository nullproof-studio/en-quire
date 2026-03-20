// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown } from '../../../src/document/parser.js';
import { buildSectionTree } from '../../../src/document/section-tree.js';
import {
  parseAddress,
  resolveAddress,
  resolveSingleSection,
} from '../../../src/document/section-address.js';
import { AddressResolutionError } from '../../../src/shared/errors.js';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/docs');

function loadTree(name: string) {
  const md = readFileSync(resolve(fixturesDir, name), 'utf-8');
  const ast = parseMarkdown(md);
  return buildSectionTree(ast, md);
}

describe('parseAddress', () => {
  it('parses text address', () => {
    expect(parseAddress('Section One')).toEqual({ type: 'text', text: 'Section One' });
  });

  it('parses path address', () => {
    expect(parseAddress('Section Two > Subsection 2.1')).toEqual({
      type: 'path',
      segments: ['Section Two', 'Subsection 2.1'],
    });
  });

  it('parses index address', () => {
    expect(parseAddress('[0, 1, 0]')).toEqual({
      type: 'index',
      indices: [0, 1, 0],
    });
  });

  it('parses pattern address', () => {
    expect(parseAddress('Section*')).toEqual({
      type: 'pattern',
      pattern: 'Section*',
    });
  });

  it('falls back to text for invalid JSON arrays', () => {
    expect(parseAddress('[not, valid]')).toEqual({
      type: 'text',
      text: '[not, valid]',
    });
  });
});

describe('resolveAddress', () => {
  describe('text address', () => {
    it('finds exact heading text', () => {
      const tree = loadTree('simple.md');
      const matches = resolveAddress(tree, { type: 'text', text: 'Section One' });
      expect(matches.length).toBe(1);
      expect(matches[0].heading.text).toBe('Section One');
    });

    it('returns empty for no match', () => {
      const tree = loadTree('simple.md');
      const matches = resolveAddress(tree, { type: 'text', text: 'Nonexistent' });
      expect(matches.length).toBe(0);
    });
  });

  describe('path address', () => {
    it('resolves hierarchical path', () => {
      const tree = loadTree('simple.md');
      const matches = resolveAddress(tree, {
        type: 'path',
        segments: ['Simple Document', 'Section Two', 'Subsection 2.1'],
      });
      expect(matches.length).toBe(1);
      expect(matches[0].heading.text).toBe('Subsection 2.1');
    });

    it('returns empty for broken path', () => {
      const tree = loadTree('simple.md');
      const matches = resolveAddress(tree, {
        type: 'path',
        segments: ['Simple Document', 'Nonexistent', 'Subsection 2.1'],
      });
      expect(matches.length).toBe(0);
    });
  });

  describe('index address', () => {
    it('resolves positional index', () => {
      const tree = loadTree('simple.md');
      // [0] = root, [0, 1] = Section Two, [0, 1, 0] = Subsection 2.1
      const matches = resolveAddress(tree, { type: 'index', indices: [0, 1, 0] });
      expect(matches.length).toBe(1);
      expect(matches[0].heading.text).toBe('Subsection 2.1');
    });

    it('returns empty for out of bounds', () => {
      const tree = loadTree('simple.md');
      const matches = resolveAddress(tree, { type: 'index', indices: [0, 99] });
      expect(matches.length).toBe(0);
    });
  });

  describe('pattern address', () => {
    it('matches glob pattern', () => {
      const tree = loadTree('simple.md');
      const matches = resolveAddress(tree, { type: 'pattern', pattern: 'Subsection*' });
      expect(matches.length).toBe(2);
      expect(matches.map((m) => m.heading.text)).toEqual([
        'Subsection 2.1',
        'Subsection 2.2',
      ]);
    });

    it('returns empty for no glob match', () => {
      const tree = loadTree('simple.md');
      const matches = resolveAddress(tree, { type: 'pattern', pattern: 'Nonexistent*' });
      expect(matches.length).toBe(0);
    });
  });
});

describe('heading marker stripping in addresses', () => {
  it('strips ## prefix from text address', () => {
    expect(parseAddress('## Section One')).toEqual({ type: 'text', text: 'Section One' });
  });

  it('strips ### prefix from text address', () => {
    expect(parseAddress('### Deep Section')).toEqual({ type: 'text', text: 'Deep Section' });
  });

  it('strips markers from each path segment', () => {
    expect(parseAddress('## Parent > ### Child')).toEqual({
      type: 'path',
      segments: ['Parent', 'Child'],
    });
  });

  it('resolves section with ## prefix in address', () => {
    const tree = loadTree('simple.md');
    const matches = resolveAddress(tree, parseAddress('## Section One'));
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('Section One');
  });

  it('does not strip # from non-heading text', () => {
    // A single # followed by no space is not a heading marker
    expect(parseAddress('#hashtag')).toEqual({ type: 'text', text: '#hashtag' });
  });
});

describe('partial path addressing', () => {
  it('resolves partial path without document root', () => {
    const tree = loadTree('simple.md');
    const matches = resolveAddress(tree, {
      type: 'path',
      segments: ['Section Two', 'Subsection 2.1'],
    });
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('Subsection 2.1');
  });

  it('resolves full path from root', () => {
    const tree = loadTree('simple.md');
    const matches = resolveAddress(tree, {
      type: 'path',
      segments: ['Simple Document', 'Section Two', 'Subsection 2.1'],
    });
    expect(matches.length).toBe(1);
    expect(matches[0].heading.text).toBe('Subsection 2.1');
  });

  it('resolves via parseAddress with > separator', () => {
    const tree = loadTree('simple.md');
    const address = parseAddress('Section Two > Subsection 2.1');
    const section = resolveSingleSection(tree, address);
    expect(section.heading.text).toBe('Subsection 2.1');
  });

  it('returns empty for non-matching partial path', () => {
    const tree = loadTree('simple.md');
    const matches = resolveAddress(tree, {
      type: 'path',
      segments: ['Section One', 'Subsection 2.1'],
    });
    expect(matches.length).toBe(0);
  });
});

describe('resolveSingleSection', () => {
  it('returns the single match', () => {
    const tree = loadTree('simple.md');
    const section = resolveSingleSection(tree, { type: 'text', text: 'Section One' });
    expect(section.heading.text).toBe('Section One');
  });

  it('throws on no match', () => {
    const tree = loadTree('simple.md');
    expect(() =>
      resolveSingleSection(tree, { type: 'text', text: 'Nonexistent' }),
    ).toThrow(AddressResolutionError);
  });

  it('throws on ambiguous match for patterns', () => {
    const tree = loadTree('simple.md');
    expect(() =>
      resolveSingleSection(tree, { type: 'pattern', pattern: 'Section*' }),
    ).toThrow(AddressResolutionError);
  });
});
