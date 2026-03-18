// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { readDocument } from '../../shared/file-utils.js';
import { parseMarkdown } from '../../document/parser.js';
import { buildSectionTree } from '../../document/section-tree.js';
import { readSection } from '../../document/section-ops.js';
import { parseAddress } from '../../document/section-address.js';
import { requirePermission } from '../../rbac/permissions.js';

export const DocReadSectionSchema = z.object({
  file: z.string(),
  section: z.string(),
  include_children: z.boolean().default(true),
});

export async function handleDocReadSection(
  args: z.infer<typeof DocReadSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content } = readDocument(ctx.documentRoot, args.file);
  const ast = parseMarkdown(content);
  const tree = buildSectionTree(ast, content);
  const address = parseAddress(args.section);

  return readSection(content, tree, address, args.include_children);
}
