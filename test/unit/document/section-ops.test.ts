// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown } from '../../../src/document/parser.js';
import { buildSectionTree } from '../../../src/document/section-tree.js';
import {
  readSection,
  replaceSection,
  insertSection,
  appendToSection,
  deleteSection,
  buildOutline,
  findReplace,
  generateToc,
} from '../../../src/document/section-ops.js';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/docs');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

function parse(md: string) {
  const ast = parseMarkdown(md);
  return buildSectionTree(ast, md);
}

describe('readSection', () => {
  it('reads a section with its content', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section One' });
    expect(result.heading).toBe('Section One');
    expect(result.content).toContain('## Section One');
    expect(result.content).toContain('Content of section one.');
  });

  it('includes children by default', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section Two' });
    expect(result.content).toContain('Subsection 2.1');
    expect(result.content).toContain('Subsection 2.2');
  });

  it('excludes children when requested', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section Two' }, false);
    expect(result.content).toContain('Content of section two.');
    expect(result.content).not.toContain('Subsection 2.1');
  });

  it('provides sibling context', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section Two' });
    expect(result.prev_sibling).toBe('Section One');
    expect(result.next_sibling).toBe('Section Three');
  });

  it('has no prev_sibling for first child', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = readSection(md, tree, { type: 'text', text: 'Section One' });
    expect(result.prev_sibling).toBeUndefined();
  });
});

describe('replaceSection', () => {
  it('replaces section body', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(md, tree, { type: 'text', text: 'A' }, 'New content.\n');
    expect(result).toContain('## A');
    expect(result).toContain('New content.');
    expect(result).not.toContain('Old content.');
    expect(result).toContain('Keep this.');
  });

  it('replaces heading when requested', () => {
    const md = '# Doc\n\n## A\n\nOld content.\n\n## B\n\nKeep this.\n';
    const tree = parse(md);
    const result = replaceSection(
      md, tree,
      { type: 'text', text: 'A' },
      '## A Renamed\n\nNew content.\n',
      true,
    );
    expect(result).toContain('## A Renamed');
    expect(result).not.toContain('Old content.');
  });
});

describe('insertSection', () => {
  it('inserts before an anchor', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'B' }, 'before', 'Inserted', 'New content.');
    expect(result.indexOf('## Inserted')).toBeLessThan(result.indexOf('## B'));
  });

  it('inserts after an anchor', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'A' }, 'after', 'Inserted', 'New content.');
    expect(result.indexOf('## Inserted')).toBeGreaterThan(result.indexOf('## A'));
    expect(result.indexOf('## Inserted')).toBeLessThan(result.indexOf('## B'));
  });

  it('inserts as child with correct level', () => {
    const md = '# Doc\n\n## A\n\nContent A.\n';
    const tree = parse(md);
    const result = insertSection(md, tree, { type: 'text', text: 'A' }, 'child_end', 'Sub', 'Sub content.');
    expect(result).toContain('### Sub');
  });
});

describe('appendToSection', () => {
  it('appends content to section body', () => {
    const md = '# Doc\n\n## A\n\nExisting content.\n\n## B\n\nContent B.\n';
    const tree = parse(md);
    const result = appendToSection(md, tree, { type: 'text', text: 'A' }, 'Appended line.');
    expect(result).toContain('Existing content.');
    expect(result).toContain('Appended line.');
    // Appended content should be before Section B
    expect(result.indexOf('Appended line.')).toBeLessThan(result.indexOf('## B'));
  });
});

describe('deleteSection', () => {
  it('removes a section and its children', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const result = deleteSection(md, tree, { type: 'text', text: 'Section Two' });
    expect(result).not.toContain('Section Two');
    expect(result).not.toContain('Subsection 2.1');
    expect(result).not.toContain('Subsection 2.2');
    expect(result).toContain('Section One');
    expect(result).toContain('Section Three');
  });
});

describe('buildOutline', () => {
  it('builds outline for full document', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const outline = buildOutline(md, tree);
    expect(outline.length).toBe(6);
    expect(outline[0].text).toBe('Simple Document');
    expect(outline[0].has_children).toBe(true);
    expect(outline[1].text).toBe('Section One');
    expect(outline[1].has_children).toBe(false);
  });

  it('respects maxDepth', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const outline = buildOutline(md, tree, undefined, 2);
    const texts = outline.map((e) => e.text);
    expect(texts).toContain('Simple Document');
    expect(texts).toContain('Section One');
    expect(texts).not.toContain('Subsection 2.1');
  });

  it('builds outline from a root section', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const outline = buildOutline(md, tree, { type: 'text', text: 'Section Two' });
    expect(outline[0].text).toBe('Section Two');
    expect(outline.length).toBe(3); // Section Two + 2 subsections
  });
});

describe('findReplace', () => {
  it('finds matches in preview mode', () => {
    const md = '# Doc\n\n## A\n\nHello world. Hello again.\n';
    const tree = parse(md);
    const { matches } = findReplace(md, tree, 'Hello', 'Hi', { preview: true });
    expect(matches.length).toBe(2);
    expect(matches[0].section_path).toContain('A');
  });

  it('replaces all matches', () => {
    const md = '# Doc\n\n## A\n\nHello world. Hello again.\n';
    const tree = parse(md);
    const { result, replacementCount } = findReplace(md, tree, 'Hello', 'Hi');
    expect(result).toContain('Hi world. Hi again.');
    expect(replacementCount).toBe(2);
  });

  it('respects expected_count safety check', () => {
    const md = '# Doc\n\nHello Hello Hello\n';
    const tree = parse(md);
    expect(() =>
      findReplace(md, tree, 'Hello', 'Hi', { expected_count: 2 }),
    ).toThrow('Expected 2 matches but found 3');
  });

  it('applies only selected matches', () => {
    const md = '# Doc\n\nA B A B A\n';
    const tree = parse(md);
    const { result, replacementCount, skippedCount } = findReplace(
      md, tree, 'A', 'X', { apply_matches: [0, 2] },
    );
    expect(result).toContain('X B A B X');
    expect(replacementCount).toBe(2);
    expect(skippedCount).toBe(1);
  });

  it('supports regex mode', () => {
    const md = '# Doc\n\nversion v1.2.3 and v4.5.6\n';
    const tree = parse(md);
    const { matches } = findReplace(md, tree, 'v\\d+\\.\\d+\\.\\d+', '', { regex: true, preview: true });
    expect(matches.length).toBe(2);
  });
});

describe('generateToc', () => {
  it('generates linked TOC', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const toc = generateToc(tree);
    expect(toc).toContain('- [Section One](#section-one)');
    expect(toc).toContain('  - [Subsection 2.1](#subsection-21)');
  });

  it('generates plain TOC', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const toc = generateToc(tree, 3, 'plain');
    expect(toc).toContain('- Section One');
    expect(toc).not.toContain('#');
  });

  it('respects maxDepth', () => {
    const md = loadFixture('simple.md');
    const tree = parse(md);
    const toc = generateToc(tree, 1);
    expect(toc).toContain('Section One');
    expect(toc).not.toContain('Subsection');
  });
});
