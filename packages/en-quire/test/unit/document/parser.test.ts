// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../../../src/parsers/parser.js';

describe('parseMarkdown', () => {
  it('parses a simple markdown document', () => {
    const ast = parseMarkdown('# Hello\n\nWorld');
    expect(ast.type).toBe('root');
    expect(ast.children.length).toBeGreaterThan(0);
    expect(ast.children[0].type).toBe('heading');
  });

  it('parses frontmatter', () => {
    const md = '---\ntitle: Test\n---\n\n# Hello\n';
    const ast = parseMarkdown(md);
    expect(ast.children[0].type).toBe('yaml');
  });

  it('parses GFM tables', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |\n';
    const ast = parseMarkdown(md);
    expect(ast.children[0].type).toBe('table');
  });

  it('parses nested headings', () => {
    const md = '# H1\n## H2\n### H3\n';
    const ast = parseMarkdown(md);
    const headings = ast.children.filter((c) => c.type === 'heading');
    expect(headings.length).toBe(3);
  });

  it('preserves position information', () => {
    const md = '# Title\n\nParagraph\n';
    const ast = parseMarkdown(md);
    expect(ast.children[0].position).toBeDefined();
    expect(ast.children[0].position!.start.line).toBe(1);
  });
});
