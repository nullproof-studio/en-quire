// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { parseAddress } from '../../document/section-address.js';
import { appendToSection } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocAppendSectionSchema = z.object({
  file: z.string(),
  section: z.string(),
  content: z.string(),
  mode: z.enum(['write', 'propose']).optional(),
  message: z.string().optional(),
});

export async function handleDocAppendSection(
  args: z.infer<typeof DocAppendSectionSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree } = loadDocument(ctx, args.file);
  const address = parseAddress(args.section);
  const newContent = appendToSection(content, tree, address, args.content);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Append to section',
    target: args.section,
    mode: args.mode,
    message: args.message,
  }, content, newContent, encoding);

  return { ...result, section: args.section };
}
