// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { extname } from 'node:path';
import type { ToolContext } from '@nullproof-studio/en-core';
import { moveSection } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { ValidationError } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite } from '@nullproof-studio/en-core';

export const DocMoveSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  section: z.string().describe('Section address of the section to move — heading text (e.g. "Changelog") or path (e.g. "Parent > Child").'),
  anchor: z.string().describe('Section address of the destination reference point — heading text or path.'),
  position: z.enum(['before', 'after', 'child_start', 'child_end']).describe(
    '"before"/"after" place the moved section as a sibling of the anchor. ' +
    '"child_start"/"child_end" place it as a child of the anchor. ' +
    'Heading levels are adjusted automatically (including all children). ' +
    'Fails if a sibling with the same heading already exists at the destination.',
  ),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocMoveSection(
  args: z.infer<typeof DocMoveSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const ext = extname(args.file).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    throw new ValidationError(
      'Section move is not supported for YAML files.',
    );
  }

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const sourceAddress = parser.parseAddress(args.section);
  const anchorAddress = parser.parseAddress(args.anchor);
  const newContent = moveSection(content, tree, sourceAddress, anchorAddress, args.position, parser.ops);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Move section',
    target: args.section,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return { ...result, section: args.section, anchor: args.anchor, position: args.position };
}
