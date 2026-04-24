// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  readDocument,
  resolveFilePath,
  computeEtag,
  requirePermission,
  findText,
} from '@nullproof-studio/en-core';

export const TextFindSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.txt").'),
  query: z.string().min(1).describe('Literal substring to search for. Not a regex — special characters match literally.'),
  context_lines: z.number().int().min(0).optional().default(5).describe('Surrounding lines to return with each match. Default 5.'),
  case_sensitive: z.boolean().optional().default(true).describe('Default true. Set false to make A match a.'),
  whole_word: z.boolean().optional().default(false).describe('Default false. When true, "log" does not match inside "Logger". Word characters: [A-Za-z0-9_].'),
});

export async function handleTextFind(
  args: z.infer<typeof TextFindSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const etag = computeEtag(content);
  const matches = findText(content, args.query, {
    context_lines: args.context_lines,
    case_sensitive: args.case_sensitive,
    whole_word: args.whole_word,
  });

  return {
    etag,
    total_matches: matches.length,
    matches,
  };
}
