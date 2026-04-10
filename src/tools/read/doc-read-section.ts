// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { readDocument } from '../../shared/file-utils.js';
import { parserRegistry } from '../../document/parser-registry.js';
import { readSection } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { resolveFilePath } from '../../config/roots.js';

export const DocReadSectionSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  section: z.string().describe('Section address — heading text (e.g. "Financial Performance") or path (e.g. "Parent > Child").'),
  include_children: z.boolean().default(true).describe('When true (default), returns the section body AND all child sections. When false, returns only the section body text (content between the heading and the first child heading).'),
});

export async function handleDocReadSection(
  args: z.infer<typeof DocReadSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const parser = parserRegistry.getParser(resolved.relativePath);
  const tree = parser.parse(content);
  const address = parser.parseAddress(args.section);

  return readSection(content, tree, address, args.include_children);
}
