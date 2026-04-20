// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { findReplace } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';
import { loadDocument, executeWrite } from '@nullproof-studio/en-core';
import { computeEtag } from '@nullproof-studio/en-core';

export const DocFindReplaceSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md").'),
  find: z.string().describe('Text or regex pattern to search for.'),
  replace: z.string().describe('Replacement text. In regex mode, supports backreferences ($1, $2, etc.).'),
  regex: z.boolean().default(false).describe('When true, treat find as a regular expression. When false (default), find is matched literally.'),
  flags: z.string().default('g').describe('Regex flags (default: "g" for global). Allowed: g, i, m, s, u, y.'),
  preview: z.boolean().default(false).describe('When true, return matches without applying replacements. Use this to verify matches before committing changes.'),
  apply_matches: z.array(z.number().int()).optional().describe('Apply only specific matches by ID (from preview results). Omit to apply all matches.'),
  expected_count: z.number().int().optional().describe('Safety check: if the actual match count differs from this value, the operation fails. Use with preview to verify first.'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled. Obtain from doc_read, doc_read_section, doc_outline, or doc_find_replace preview.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocFindReplace(
  args: z.infer<typeof DocFindReplaceSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  // Early check: find and replace are identical — no change would be made
  if (!args.regex && args.find === args.replace) {
    return {
      success: false,
      file: args.file,
      replacements: 0,
      skipped: 0,
      warning: `No changes made: find and replace strings are identical ("${args.find}"). Double-check the replacement value.`,
    };
  }

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
    return { matches: findResult.matches, total: findResult.matches.length, etag: computeEtag(content) };
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
    if_match: args.if_match,
  }, content, findResult.result, encoding);

  return {
    ...writeResult,
    replacements: findResult.replacementCount,
    skipped: findResult.skippedCount,
  };
}
