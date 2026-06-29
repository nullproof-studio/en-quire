// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../../src/parsers/parser.js';
import { buildSectionTree, parseAddress } from '../../../src/parsers/markdown-parser.js';
import { resolveSingleSection } from '@nullproof-studio/en-core';
import { replaceSection, insertSection, moveSection } from '../../helpers/md-ops.js';

function tree(md: string) {
  return buildSectionTree(parseMarkdown(md), md);
}

const BASE = [
  '# Doc',
  '',
  '## Existing ^existing',
  '',
  'body.',
  '',
].join('\n');

describe('insertSection auto-assigns a stable anchor', () => {
  it('appends a slugged ^id derived from the new heading', () => {
    const out = insertSection(BASE, tree(BASE), parseAddress('Existing'), 'after', 'New Section', 'content.');
    expect(out).toContain('## New Section ^new-section');
    // The new section is addressable by its fresh anchor.
    const section = resolveSingleSection(tree(out), parseAddress('^new-section'));
    expect(section.heading.text).toBe('New Section');
  });

  it('avoids collisions with anchors already in the document', () => {
    const md = '# Doc\n\n## Foo ^new-section\n\nx.\n';
    const out = insertSection(md, tree(md), parseAddress('Foo'), 'after', 'New Section', 'y.');
    expect(out).toContain('## New Section ^new-section-2');
  });

  it('respects an explicit anchor the author wrote into the heading', () => {
    const out = insertSection(BASE, tree(BASE), parseAddress('Existing'), 'after', 'New Section ^chosen', 'c.');
    expect(out).toContain('## New Section ^chosen');
    expect(out).not.toContain('^new-section');
  });
});

describe('replaceSection preserves the anchor across a rename', () => {
  it('keeps ^id when renaming via the string heading form', () => {
    const out = replaceSection(BASE, tree(BASE), parseAddress('^existing'), 'updated body.', 'Renamed Title');
    expect(out).toContain('## Renamed Title ^existing');
    // Still resolvable by the stable id after the rename.
    expect(resolveSingleSection(tree(out), parseAddress('^existing')).heading.text).toBe('Renamed Title');
  });

  it('keeps ^id when replacing the full heading line (replace_heading: true)', () => {
    const out = replaceSection(BASE, tree(BASE), parseAddress('^existing'), '## Renamed Title\n\nnew body.', true);
    expect(out).toContain('## Renamed Title ^existing');
  });

  it('lets the author override the anchor with an explicit one', () => {
    const out = replaceSection(BASE, tree(BASE), parseAddress('^existing'), 'b.', 'Renamed ^newid');
    expect(out).toContain('## Renamed ^newid');
    expect(out).not.toContain('^existing');
  });
});

describe('moveSection carries the anchor with the heading line', () => {
  it('keeps the ^id and stays resolvable after a move', () => {
    const md = [
      '# Doc',
      '',
      '## A ^a',
      '',
      'abody.',
      '',
      '## B ^b',
      '',
      'bbody.',
      '',
    ].join('\n');
    const out = moveSection(md, tree(md), parseAddress('^a'), parseAddress('^b'), 'child_end');
    // Heading level shifted (h2 → h3 under B) but the anchor travels with it.
    expect(out).toContain('^a');
    expect(resolveSingleSection(tree(out), parseAddress('^a')).heading.text).toBe('A');
  });
});
