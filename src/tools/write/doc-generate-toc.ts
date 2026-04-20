// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { requirePermission } from '../../rbac/permissions.js';
import { ValidationError } from '../../shared/errors.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocGenerateTocSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md"). Markdown only — not supported for YAML.'),
  max_depth: z.number().int().positive().default(3).describe('Maximum heading depth to include in the TOC (default: 3).'),
  style: z.enum(['links', 'plain']).default('links').describe('"links" generates markdown anchor links (default). "plain" generates a plain text list.'),
  position: z.enum(['top', 'after_heading']).default('after_heading').describe('Where to insert the TOC: "after_heading" places it after the first h1 (default), "top" places it at the start of the document. If a TOC already exists, it is replaced in place.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocGenerateToc(
  args: z.infer<typeof DocGenerateTocSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);

  if (!parser.capabilities.generateToc || !parser.ops.generateToc) {
    throw new ValidationError(
      'Table of contents generation is not supported for this file format.',
    );
  }

  const toc = parser.ops.generateToc(tree, args.max_depth, args.style);
  const tocSection = `## Table of Contents\n\n${toc}\n`;

  // Check if TOC already exists
  const tocRegex = /## Table of Contents\n[\s\S]*?(?=\n## |\n---|\n# |$)/;
  let newContent: string;

  if (tocRegex.test(content)) {
    // Replace existing TOC
    newContent = content.replace(tocRegex, tocSection);
  } else if (args.position === 'top') {
    newContent = tocSection + '\n' + content;
  } else {
    // Insert after first h1
    const h1End = content.indexOf('\n', content.indexOf('# '));
    if (h1End >= 0) {
      newContent = content.slice(0, h1End + 1) + '\n' + tocSection + '\n' + content.slice(h1End + 1);
    } else {
      newContent = tocSection + '\n' + content;
    }
  }

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Generate TOC',
    target: 'Table of Contents',
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return {
    ...result,
    toc,
    headings_count: tree.length,
  };
}
