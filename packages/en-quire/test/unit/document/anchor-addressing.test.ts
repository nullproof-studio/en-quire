// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../../src/parsers/parser.js';
import { buildSectionTree, parseAddress } from '../../../src/parsers/markdown-parser.js';
import { parserRegistry } from '@nullproof-studio/en-core';
import '../../../src/parsers/markdown-parser.js';
import { resolveSingleSection, resolveAddress, buildOutline } from '@nullproof-studio/en-core';

const MD = [
  '# Doc',
  '',
  '## Implementation Notes ^impl',
  '',
  'x.',
  '',
  '### Storage Mapping ^store-map',
  '',
  'body.',
  '',
  '## Plain Heading',
  '',
  'y.',
  '',
].join('\n');

function tree() {
  return buildSectionTree(parseMarkdown(MD), MD);
}

describe('anchor extraction in the section tree', () => {
  it('strips the ^id token from heading text and captures it as anchorId', () => {
    const t = tree();
    const impl = t[0].children[0];
    expect(impl.heading.text).toBe('Implementation Notes');
    expect(impl.heading.anchorId).toBe('impl');

    const store = impl.children[0];
    expect(store.heading.text).toBe('Storage Mapping');
    expect(store.heading.anchorId).toBe('store-map');
  });

  it('leaves un-anchored headings with no anchorId', () => {
    const plain = tree()[0].children[1];
    expect(plain.heading.text).toBe('Plain Heading');
    expect(plain.heading.anchorId).toBeUndefined();
  });
});

describe('parseAddress — anchor form', () => {
  it('parses a bare ^id token into an anchor address', () => {
    expect(parseAddress('^store-map')).toEqual({ type: 'anchor', id: 'store-map' });
  });

  it('does not treat a heading containing a caret mid-text as an anchor', () => {
    expect(parseAddress('mc^2 energy')).toEqual({ type: 'text', text: 'mc^2 energy' });
  });
});

describe('resolving by anchor', () => {
  it('resolves a section by its ^id regardless of nesting', () => {
    const section = resolveSingleSection(tree(), parseAddress('^store-map'));
    expect(section.heading.text).toBe('Storage Mapping');
  });

  it('resolves independent of the heading display text (the stability property)', () => {
    // Same anchor, different (renamed) display text — still resolves.
    const renamed = MD.replace('### Storage Mapping ^store-map', '### Persistence Layer ^store-map');
    const t = buildSectionTree(parseMarkdown(renamed), renamed);
    const section = resolveSingleSection(t, parseAddress('^store-map'));
    expect(section.heading.text).toBe('Persistence Layer');
  });

  it('returns empty for an unknown anchor', () => {
    expect(resolveAddress(tree(), { type: 'anchor', id: 'nope' })).toHaveLength(0);
  });
});

describe('link-graph stability: a stored ^id fragment dereferences across a rename', () => {
  it('resolves the fragment both before and after the heading text changes', () => {
    // Simulates what context-bundle does: parseAddress(storedFragment) → read.
    const storedFragment = '^store-map'; // as the extractor persists [[doc#^store-map]]

    const before = resolveSingleSection(tree(), parseAddress(storedFragment));
    expect(before.heading.text).toBe('Storage Mapping');

    // Author renames the heading display text; the ^id token stays.
    const renamed = MD.replace('### Storage Mapping ^store-map', '### Persistence ^store-map');
    const t = buildSectionTree(parseMarkdown(renamed), renamed);
    const after = resolveSingleSection(t, parseAddress(storedFragment));
    // Same stored link, now points at the renamed section — no link rot.
    expect(after.heading.text).toBe('Persistence');
  });
});

describe('validate flags duplicate anchors', () => {
  it('warns when two headings share an ^id', () => {
    const parser = parserRegistry.getParser('x.md');
    const warnings = parser.validate('# A ^dup\n\nx.\n\n## B ^dup\n\ny.\n');
    expect(warnings.some((w) => w.includes('Duplicate anchor "^dup"'))).toBe(true);
  });

  it('does not warn when anchors are unique', () => {
    const parser = parserRegistry.getParser('x.md');
    const warnings = parser.validate('# A ^a\n\nx.\n\n## B ^b\n\ny.\n');
    expect(warnings.some((w) => w.includes('Duplicate anchor'))).toBe(false);
  });
});

describe('outline surfaces anchor ids', () => {
  it('includes id for anchored sections and omits it otherwise', () => {
    const outline = buildOutline(MD, tree());
    const impl = outline.find((e) => e.text === 'Implementation Notes');
    const plain = outline.find((e) => e.text === 'Plain Heading');
    expect(impl?.id).toBe('impl');
    expect(plain?.id).toBeUndefined();
  });
});
