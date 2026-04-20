// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import '../../../src/parsers/markdown-parser.js';
import { parserRegistry } from '@nullproof-studio/en-core';
import { readSection, deleteSection, buildOutline } from '@nullproof-studio/en-core';
import { replaceSection, appendToSection } from '../../helpers/md-ops.js';

const parser = parserRegistry.getParser('test.md');

describe('preamble — markdown parser', () => {
  it('creates preamble for frontmatter before first heading', () => {
    const md = '---\ntitle: Hello\n---\n\n# Title\n\nBody.\n';
    const tree = parser.parse(md);
    expect(tree[0].heading.text).toBe('__preamble');
    expect(tree[0].heading.level).toBe(0);
    expect(tree[0].bodyEndOffset).toBe(md.indexOf('# Title'));
  });

  it('creates preamble for JSX imports before first heading', () => {
    const md = 'import { Button } from "./Button";\n\n# Page\n\nContent.\n';
    const tree = parser.parse(md);
    expect(tree[0].heading.text).toBe('__preamble');
    const preambleContent = md.slice(tree[0].bodyStartOffset, tree[0].bodyEndOffset);
    expect(preambleContent).toContain('import { Button }');
  });

  it('omits preamble when no pre-heading content', () => {
    const md = '# Title\n\nBody.\n';
    const tree = parser.parse(md);
    expect(tree[0].heading.text).toBe('Title');
  });

  it('creates preamble spanning entire document when no headings', () => {
    const md = 'Just some text without any headings.\n';
    const tree = parser.parse(md);
    expect(tree.length).toBe(1);
    expect(tree[0].heading.text).toBe('__preamble');
    expect(tree[0].sectionEndOffset).toBe(md.length);
  });

  it('addresses preamble via __preamble text', () => {
    const md = '---\ntitle: Test\n---\n\n# Heading\n\nBody.\n';
    const tree = parser.parse(md);
    const address = parser.parseAddress('__preamble');
    const result = readSection(md, tree, address);
    expect(result.heading).toBe('__preamble');
    expect(result.content).toContain('title: Test');
  });

  it('reads preamble content', () => {
    const md = '---\nkey: value\n---\n\n# Title\n\nBody.\n';
    const tree = parser.parse(md);
    const address = parser.parseAddress('__preamble');
    const result = readSection(md, tree, address);
    expect(result.content).toContain('key: value');
    expect(result.content).not.toContain('# Title');
  });

  it('replaces preamble content', () => {
    const md = '---\nold: data\n---\n\n# Title\n\nBody.\n';
    const tree = parser.parse(md);
    const address = parser.parseAddress('__preamble');
    const result = replaceSection(md, tree, address, '---\nnew: data\n---\n');
    expect(result).toContain('new: data');
    expect(result).not.toContain('old: data');
    expect(result).toContain('# Title');
  });

  it('deletes preamble content', () => {
    const md = '---\ntitle: Test\n---\n\n# Title\n\nBody.\n';
    const tree = parser.parse(md);
    const address = parser.parseAddress('__preamble');
    const result = deleteSection(md, tree, address);
    expect(result).toContain('# Title');
    expect(result).not.toContain('title: Test');
  });

  it('includes preamble in outline at level 0', () => {
    const md = '---\ntitle: Test\n---\n\n# Heading\n\nBody.\n';
    const tree = parser.parse(md);
    const outline = buildOutline(md, tree);
    expect(outline[0].text).toBe('__preamble');
    expect(outline[0].level).toBe(0);
    expect(outline[0].has_content).toBe(true);
    expect(outline[1].text).toBe('Heading');
  });

  it('preamble shifts sibling indices correctly', () => {
    const md = '---\ntitle: Test\n---\n\n# A\n\nContent.\n\n# B\n\nContent.\n';
    const tree = parser.parse(md);
    expect(tree[0].index).toBe(0); // __preamble
    expect(tree[1].index).toBe(1); // A
    expect(tree[2].index).toBe(2); // B
  });

  it('index address [0] refers to preamble when present', () => {
    const md = '---\ntitle: Test\n---\n\n# Heading\n\nBody.\n';
    const tree = parser.parse(md);
    const address = parser.parseAddress('[0]');
    const result = readSection(md, tree, address);
    expect(result.heading).toBe('__preamble');
  });

  it('appends to preamble', () => {
    const md = '---\ntitle: Test\n---\n\n# Title\n\nBody.\n';
    const tree = parser.parse(md);
    const address = parser.parseAddress('__preamble');
    const result = appendToSection(md, tree, address, '\nimport { X } from "x";');
    expect(result).toContain('import { X } from "x";');
    expect(result.indexOf('import')).toBeLessThan(result.indexOf('# Title'));
  });

  it('does not add leading blank lines when replacing preamble', () => {
    const md = '---\ntitle: Old\n---\n\n# Title\n\nBody.\n';
    const tree = parser.parse(md);
    const address = parser.parseAddress('__preamble');
    const result = replaceSection(md, tree, address, '---\ntitle: New\n---\n');
    // Frontmatter must start at line 1 — no leading blank lines
    expect(result).toMatch(/^---\n/);
    expect(result).not.toMatch(/^\n/);
    expect(result).toContain('title: New');
    expect(result).toContain('# Title');
  });

  it('omits preamble when only whitespace before heading', () => {
    const md = '\n\n# Title\n\nBody.\n';
    const tree = parser.parse(md);
    expect(tree[0].heading.text).toBe('Title');
  });
});
