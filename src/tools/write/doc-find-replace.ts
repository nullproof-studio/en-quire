// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { findReplace } from '../../document/section-ops.js';
import { requirePermission } from '../../rbac/permissions.js';
import { loadDocument, executeWrite } from './write-helpers.js';

export const DocFindReplaceSchema = z.object({
  file: z.string(),
  find: z.string(),
  replace: z.string(),
  regex: z.boolean().default(false),
  flags: z.string().default('g'),
  preview: z.boolean().default(false),
  apply_matches: z.array(z.number().int()).optional(),
  expected_count: z.number().int().optional(),
  mode: z.enum(['write', 'propose']).optional(),
  message: z.string().optional(),
});

export async function handleDocFindReplace(
  args: z.infer<typeof DocFindReplaceSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const { content, encoding, tree } = loadDocument(ctx, args.file);

  const findResult = findReplace(content, tree, args.find, args.replace, {
    regex: args.regex,
    flags: args.flags,
    preview: args.preview,
    apply_matches: args.apply_matches,
    expected_count: args.expected_count,
  });

  // Preview mode: return matches only
  if (args.preview) {
    return { matches: findResult.matches, total: findResult.matches.length };
  }

  // Apply mode: write the result
  if (!findResult.result) {
    return { success: true, file: args.file, replacements: 0, skipped: 0 };
  }

  const writeResult = await executeWrite(ctx, {
    file: args.file,
    operation: 'Find and replace',
    target: args.find,
    mode: args.mode,
    message: args.message,
  }, content, findResult.result, encoding);

  return {
    ...writeResult,
    replacements: findResult.replacementCount,
    skipped: findResult.skippedCount,
  };
}
