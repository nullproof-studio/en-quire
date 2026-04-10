// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { appendToSection } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocAppendSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  section: z.string().describe('Section address — heading text (e.g. "Overview") or path (e.g. "Parent > Child").'),
  content: z.string().describe('Content to append to the end of the section body (before its children). Must not contain headings at or above the section level — use doc_insert_section to add siblings.'),
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
  const newContent = appendToSection(content, tree, address, args.content);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Append to section',
    target: args.section,
    mode: args.mode,
    message: args.message,
  }, content, newContent, encoding);

  return { ...result, section: args.section };
}
