// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import type { Root } from 'mdast';

const processor = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkGfm)
  .use(remarkStringify, {
    bullet: '-',
    emphasis: '*',
    strong: '*',
    rule: '-',
  });

/**
 * Serialize an mdast AST back to a markdown string.
 * Used primarily for validation — confirming that modified content
 * produces valid markdown. Not used for writing files (we use
 * string splicing to preserve original formatting).
 */
export function serializeMarkdown(ast: Root): string {
  return processor.stringify(ast);
}
