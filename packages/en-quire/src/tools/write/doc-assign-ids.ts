// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { ValidationError } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite, assignAnchors, computeEtag } from '@nullproof-studio/en-core';

export const DocAssignIdsSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md"). Markdown only — stable ^id anchors do not apply to YAML or JSONL.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

/**
 * Backfill stable `^id` anchors onto every heading that lacks one. Existing
 * anchors are preserved and reserve their id so derived slugs never collide.
 * This is the migration path for documents authored before anchors, and the
 * way to give a whole document durable, rename-proof section addresses in one
 * call.
 */
export async function handleDocAssignIds(
  args: z.infer<typeof DocAssignIdsSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, parser } = loadDocument(ctx, args.file);

  if (parser.ops.deriveAnchorId === undefined || parser.ops.formatAnchor === undefined) {
    throw new ValidationError(
      'Stable `^id` anchors are only supported for markdown documents (.md, .mdx).',
    );
  }

  const { content: newContent, assigned } = assignAnchors(content);

  if (assigned.length === 0) {
    // Nothing to do — every heading already has an anchor. Report cleanly
    // rather than producing an empty write.
    return {
      success: true,
      file: args.file,
      assigned: [],
      unchanged: true,
      etag: computeEtag(content),
    };
  }

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Assign section ids',
    target: 'section anchors',
    mode: args.mode,
    message: args.message,
    if_match: args.if_match,
  }, content, newContent, encoding);

  return {
    ...result,
    assigned: assigned.map((a) => ({ heading: a.heading, id: a.anchorId, line: a.line })),
  };
}
