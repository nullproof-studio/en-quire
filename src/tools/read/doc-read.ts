// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { readDocument } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { resolveFilePath } from '@nullproof-studio/en-core';
import { computeEtag } from '@nullproof-studio/en-core';

export const DocReadSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  page: z.number().int().positive().default(1).describe('Page number to read (default: 1). Use with total_pages from the response to paginate through large documents.'),
  page_size: z.number().int().positive().default(200).describe('Lines per page (default: 200).'),
});

export async function handleDocRead(
  args: z.infer<typeof DocReadSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
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
    etag: computeEtag(content),
  };
}
