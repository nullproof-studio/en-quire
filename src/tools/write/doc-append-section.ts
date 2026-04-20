// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { appendToSection } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocAppendSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  section: z.string().describe('Section address — heading text (e.g. "Overview") or path (e.g. "Parent > Child").'),
  content: z.string().describe('Content to append to the end of the section body (before its children). Must not contain headings at or above the section level — use doc_insert_section to add siblings.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocAppendSection(
  args: z.infer<typeof DocAppendSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const address = parser.parseAddress(args.section);
  const newContent = appendToSection(content, tree, address, args.content, parser.ops);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Append to section',
    target: args.section,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return { ...result, section: args.section };
}
