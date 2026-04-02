// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { deleteSection } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocDeleteSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  section: z.string().describe('Section address — heading text (e.g. "Appendix") or path (e.g. "Parent > Child"). WARNING: deleting a section removes its heading, body, AND all children. Deleting an h1 section removes the entire document content beneath that heading.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocDeleteSection(
  args: z.infer<typeof DocDeleteSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const address = parser.parseAddress(args.section);
  const newContent = deleteSection(content, tree, address);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Delete section',
    target: args.section,
    mode: args.mode,
    message: args.message,
  }, content, newContent, encoding);

  return { ...result, section: args.section };
}
