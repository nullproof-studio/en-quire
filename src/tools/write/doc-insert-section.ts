// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { extname } from 'node:path';
import type { ToolContext } from '../context.js';
import { insertSection } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { ValidationError } from '../../shared/errors.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocInsertSectionSchema = z.object({
  file: z.string(),
  anchor: z.string(),
  position: z.enum(['before', 'after', 'child_start', 'child_end']),
  heading: z.string().describe('Plain text heading without # markers (e.g. "My Section", not "## My Section"). The heading level is set by the level parameter.'),
  content: z.string(),
  level: z.number().int().min(1).max(6).optional(),
  mode: z.enum(['write', 'propose']).optional(),
  message: z.string().optional(),
});

export async function handleDocInsertSection(
  args: z.infer<typeof DocInsertSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const ext = extname(args.file).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    throw new ValidationError(
      'Section insertion is not supported for YAML files. Use doc_replace_section or doc_find_replace to modify YAML content.',
    );
  }

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const address = parser.parseAddress(args.anchor);
  const newContent = insertSection(
    content, tree, address, args.position,
    args.heading, args.content, args.level,
  );

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Insert section',
    target: args.heading,
    mode: args.mode,
    message: args.message,
  }, content, newContent, encoding);

  return { ...result, section: args.heading };
}
