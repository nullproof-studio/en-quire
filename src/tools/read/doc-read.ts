// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { readDocument } from '../../shared/file-utils.js';
import { requirePermission } from '../../rbac/permissions.js';

export const DocReadSchema = z.object({
  file: z.string(),
  page: z.number().int().positive().default(1),
  page_size: z.number().int().positive().default(200),
});

export async function handleDocRead(
  args: z.infer<typeof DocReadSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content } = readDocument(ctx.documentRoot, args.file);
  const lines = content.split('\n');
  const totalLines = lines.length;
  const totalPages = Math.ceil(totalLines / args.page_size);

  const start = (args.page - 1) * args.page_size;
  const end = start + args.page_size;
  const pageContent = lines.slice(start, end).join('\n');

  return {
    content: pageContent,
    page: args.page,
    total_pages: totalPages,
    total_lines: totalLines,
  };
}
