// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm);

/**
 * Parse a markdown string into an mdast AST.
 * Supports frontmatter (YAML) and GFM extensions (tables, strikethrough, etc.).
 */
export function parseMarkdown(markdown: string): Root {
  return processor.parse(markdown);
}
