// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMarkdown } from '../../../src/document/parser.js';
import { buildSectionTree } from '../../../src/document/markdown-parser.js';
import { getBreadcrumb, getSectionPath, flattenTree } from '@nullproof-studio/en-core';

const fixturesDir = resolve(import.meta.dirname, '../../fixtures/docs');

function loadFixture(name: string): string {
  return readFileSync(resolve(fixturesDir, name), 'utf-8');
}

describe('buildSectionTree', () => {
  it('builds a tree from a simple document', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    // Should have one root: "Simple Document"
    expect(tree.length).toBe(1);
    expect(tree[0].heading.text).toBe('Simple Document');
    expect(tree[0].heading.level).toBe(1);

    // Root has 3 children: Section One, Section Two, Section Three
    expect(tree[0].children.length).toBe(3);
    expect(tree[0].children[0].heading.text).toBe('Section One');
    expect(tree[0].children[1].heading.text).toBe('Section Two');
    expect(tree[0].children[2].heading.text).toBe('Section Three');
  });

  it('nests subsections correctly', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    const sectionTwo = tree[0].children[1];
    expect(sectionTwo.children.length).toBe(2);
    expect(sectionTwo.children[0].heading.text).toBe('Subsection 2.1');
    expect(sectionTwo.children[1].heading.text).toBe('Subsection 2.2');
  });

  it('handles deeply nested headings', () => {
    const md = loadFixture('nested-headings.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    // Root: "Deployment Procedures"
    expect(tree[0].heading.text).toBe('Deployment Procedures');

    // Find "2.2 Deploy" > "2.2.1 Staging"
    const deploy = tree[0].children[1].children[1]; // 2. Deployment Steps > 2.2 Deploy
    expect(deploy.heading.text).toBe('2.2 Deploy');
    expect(deploy.children.length).toBe(2);
    expect(deploy.children[0].heading.text).toBe('2.2.1 Staging');
    expect(deploy.children[1].heading.text).toBe('2.2.2 Production');
  });

  it('returns empty array for document with no headings', () => {
    const md = loadFixture('no-headings.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);
    expect(tree).toEqual([]);
  });

  it('sets parent references correctly', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    const sub = tree[0].children[1].children[0]; // Subsection 2.1
    expect(sub.parent).toBe(tree[0].children[1]); // Section Two
    expect(sub.parent!.parent).toBe(tree[0]); // Simple Document
    expect(tree[0].parent).toBeNull();
  });

  it('sets index and depth correctly', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    expect(tree[0].index).toBe(0);
    expect(tree[0].depth).toBe(0);

    expect(tree[0].children[0].index).toBe(0);
    expect(tree[0].children[0].depth).toBe(1);

    expect(tree[0].children[1].index).toBe(1);
    expect(tree[0].children[1].children[1].index).toBe(1);
    expect(tree[0].children[1].children[1].depth).toBe(2);
  });

  it('sets section offsets correctly', () => {
    const md = '# Title\n\nIntro text.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.\n';
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    // The root "Title" section should span the whole doc
    expect(tree[0].headingStartOffset).toBe(0);
    expect(tree[0].sectionEndOffset).toBe(md.length);

    // Section A body should contain "Content A."
    const sectionA = tree[0].children[0];
    const bodyA = md.slice(sectionA.bodyStartOffset, sectionA.bodyEndOffset).trim();
    expect(bodyA).toBe('Content A.');

    // Section B body should contain "Content B."
    const sectionB = tree[0].children[1];
    const bodyB = md.slice(sectionB.bodyStartOffset, sectionB.bodyEndOffset).trim();
    expect(bodyB).toBe('Content B.');
  });
});

describe('getBreadcrumb', () => {
  it('returns full breadcrumb path', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    const sub = tree[0].children[1].children[0];
    expect(getBreadcrumb(sub)).toEqual(['Simple Document', 'Section Two', 'Subsection 2.1']);
  });

  it('returns single element for root', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    expect(getBreadcrumb(tree[0])).toEqual(['Simple Document']);
  });
});

describe('getSectionPath', () => {
  it('returns path string with > separator', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    const sub = tree[0].children[1].children[0];
    expect(getSectionPath(sub)).toBe('Simple Document > Section Two > Subsection 2.1');
  });
});

describe('flattenTree', () => {
  it('returns all nodes in depth-first order', () => {
    const md = loadFixture('simple.md');
    const ast = parseMarkdown(md);
    const tree = buildSectionTree(ast, md);

    const flat = flattenTree(tree);
    const headings = flat.map((n) => n.heading.text);
    expect(headings).toEqual([
      'Simple Document',
      'Section One',
      'Section Two',
      'Subsection 2.1',
      'Subsection 2.2',
      'Section Three',
    ]);
  });
});
