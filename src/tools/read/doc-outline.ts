// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { readDocument } from '../../shared/file-utils.js';
import { parserRegistry } from '../../document/parser-registry.js';
import { buildOutline } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { resolveFilePath } from '../../config/roots.js';

export const DocOutlineSchema = z.object({
  file: z.string(),
  max_depth: z.number().int().positive().optional(),
  root_section: z.string().optional(),
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
  const headings = buildOutline(content, tree, rootAddress, args.max_depth);

  return { headings };
}
