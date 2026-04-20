// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { readDocument } from '@nullproof-studio/en-core';
import { parserRegistry } from '@nullproof-studio/en-core';
import { buildOutline } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { resolveFilePath } from '@nullproof-studio/en-core';
import { computeEtag } from '@nullproof-studio/en-core';
import { countWords } from '@nullproof-studio/en-core';
import { extname } from 'node:path';

export const DocOutlineSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  max_depth: z.number().int().positive().optional().describe('Maximum heading depth to return. Omit for full depth.'),
  root_section: z.string().optional().describe('Section address to use as the root of the outline. Omit to outline the entire document.'),
  include_preview: z.boolean().optional().default(false).describe('When true, includes the first preview_chars characters of each section body in a "preview" field. Useful for summarisation without reading full sections.'),
  preview_chars: z.number().int().positive().optional().default(200).describe('Maximum characters to include in preview (default: 200). Only used when include_preview is true.'),
});

export async function handleDocOutline(
  args: z.infer<typeof DocOutlineSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const parser = parserRegistry.getParser(resolved.relativePath);
  const tree = parser.parse(content);

  const rootAddress = args.root_section ? parser.parseAddress(args.root_section) : undefined;
  const isProse = isProseFormat(resolved.relativePath);
  const headings = buildOutline(
    content,
    tree,
    rootAddress,
    args.max_depth,
    args.include_preview ? args.preview_chars : undefined,
    isProse,
  );

  const response: { headings: typeof headings; total_word_count?: number; etag: string } = {
    headings,
    etag: computeEtag(content),
  };
  if (isProse) {
    response.total_word_count = countWords(content);
  }
  return response;
}

/** Formats where prose word counts are meaningful. YAML and similar structured
 * formats are excluded because "words" in structured data don't correspond to
 * a user-facing concept. */
function isProseFormat(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return ext === '.md' || ext === '.mdx' || ext === '.markdown';
}
