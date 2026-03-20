// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { setValue } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocSetValueSchema = z.object({
  file: z.string(),
  path: z.string(),
  value: z.string(),
  mode: z.enum(['write', 'propose']).optional(),
  message: z.string().optional(),
});

export async function handleDocSetValue(
  args: z.infer<typeof DocSetValueSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree, parser } = loadDocument(ctx, args.file);
  const address = parser.parseAddress(args.path);
  const newContent = setValue(content, tree, address, args.value);

  const result = await executeWrite(ctx, {
    file: args.file,
    operation: 'Set value',
    target: args.path,
    mode: args.mode,
    message: args.message,
  }, content, newContent, encoding);

  return { ...result, path: args.path };
}
