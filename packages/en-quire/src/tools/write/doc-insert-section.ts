// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { extname } from 'node:path';
import type { ToolContext } from '@nullproof-studio/en-core';
import { insertSection } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { ValidationError } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocInsertSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  anchor: z.string().describe('Section address of the reference point — heading text (e.g. "Introduction") or path (e.g. "Parent > Child").'),
  position: z.enum(['before', 'after', 'child_start', 'child_end']).describe('"before"/"after" insert as a sibling of the anchor. "child_start"/"child_end" insert as a child of the anchor. Fails if a sibling with the same heading already exists — use doc_replace_section to update existing sections.'),
  heading: z.string().describe('Plain text heading without # markers (e.g. "My Section", not "## My Section"). The heading level is set automatically from position context or the level parameter.'),
  content: z.string().describe('Body content for the new section (no heading line needed).'),
  level: z.number().int().min(1).max(6).optional().describe('Explicit heading level (1–6). If omitted, level is inferred: siblings match the anchor level, children are anchor level + 1.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
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
    args.heading, args.content, parser.ops, args.level,
  );

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Insert section',
    target: args.heading,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return { ...result, section: args.heading };
}
