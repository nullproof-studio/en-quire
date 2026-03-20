// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { extname } from 'node:path';
import type { ToolContext } from '../context.js';
import { generateToc } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { ValidationError } from '../../shared/errors.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocGenerateTocSchema = z.object({
  file: z.string(),
  max_depth: z.number().int().positive().default(3),
  style: z.enum(['links', 'plain']).default('links'),
  position: z.enum(['top', 'after_heading']).default('after_heading'),
  mode: z.enum(['write', 'propose']).optional(),
  message: z.string().optional(),
});

export async function handleDocGenerateToc(
  args: z.infer<typeof DocGenerateTocSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const ext = extname(args.file).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    throw new ValidationError(
      'Table of contents generation is not supported for YAML files.',
    );
  }

  const { content, encoding, tree } = loadDocument(ctx, args.file);
  const toc = generateToc(tree, args.max_depth, args.style);
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
  }, content, newContent, encoding);

  return {
    ...result,
    toc,
    headings_count: tree.length,
  };
}
