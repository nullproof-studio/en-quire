// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { replaceSection } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocReplaceSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  section: z.string().describe('Section address — heading text (e.g. "Financial Performance") or path (e.g. "Parent > Child").'),
  content: z.string().describe('Replacement content. Do NOT include the section heading — it is preserved automatically. If content contains subsection headings (e.g. ### child), all existing children of the target section are replaced. If content is plain text, existing children are preserved.'),
  replace_heading: z.boolean().default(false).describe('When true, content must include the full heading line (e.g. "## New Title\\nBody"). When false (default), the existing heading is preserved.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocReplaceSection(
  args: z.infer<typeof DocReplaceSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const address = parser.parseAddress(args.section);
  const newContent = replaceSection(content, tree, address, args.content, args.replace_heading, parser.ops);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Replace section',
    target: args.section,
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return { ...result, section: args.section };
}
