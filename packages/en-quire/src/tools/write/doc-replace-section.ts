// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { replaceSection } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite } from '@nullproof-studio/en-core';
import { booleanish } from '@nullproof-studio/en-core';

export const DocReplaceSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  section: z.string().describe('Section address — heading text (e.g. "Financial Performance"), path (e.g. "Parent > Child"), or a stable "^id" anchor (e.g. "^store-map").'),
  content: z.string().describe('Replacement content. Do NOT include the section heading — it is preserved automatically (including its stable "^id" anchor, which survives a heading rename). If content contains subsection headings (e.g. ### child), all existing children of the target section are replaced. If content is plain text, existing children are preserved. To remove the section, do NOT pass empty content here (that only clears the body and leaves an orphan heading) — use doc_delete_section instead.'),
  replace_heading: booleanish().default(false).describe('When true, content must include the full heading line (e.g. "## New Title\\nBody"). When false (default), the existing heading is preserved.'),
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

  // Steer the "fake delete" footgun: replacing with empty content while
  // preserving the heading clears the body but leaves an orphan heading (and
  // children). Agents reach for this when they actually want a full removal.
  const warnings: string[] = [];
  if (args.replace_heading !== true && args.content.trim() === '') {
    warnings.push(
      'Section body cleared, but its heading and any children remain. ' +
      'To remove the section entirely (heading + body + children), use doc_delete_section instead.',
    );
  }

  return { ...result, section: args.section, ...(warnings.length > 0 && { warnings }) };
}
