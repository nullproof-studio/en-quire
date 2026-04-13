// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { readDocument } from '../../shared/file-utils.js';
import { parserRegistry } from '../../document/parser-registry.js';
import { buildOutline } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { resolveFilePath } from '../../config/roots.js';
import { computeEtag } from '../../shared/etag.js';

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
  const headings = buildOutline(content, tree, rootAddress, args.max_depth, args.include_preview ? args.preview_chars : undefined);

  return { headings, etag: computeEtag(content) };
}
