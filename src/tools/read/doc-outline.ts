// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { readDocument } from '../../shared/file-utils.js';
import { parseMarkdown } from '../../document/parser.js';
import { buildSectionTree } from '../../document/section-tree.js';
import { buildOutline } from '../../document/section-ops.js';
import { parseAddress } from '../../document/section-address.js';
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
  const ast = parseMarkdown(content);
  const tree = buildSectionTree(ast, content);

  const rootAddress = args.root_section ? parseAddress(args.root_section) : undefined;
  const headings = buildOutline(content, tree, rootAddress, args.max_depth);

  return { headings };
}
