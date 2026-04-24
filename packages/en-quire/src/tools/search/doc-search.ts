// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '@nullproof-studio/en-core';
import { searchDocuments } from '@nullproof-studio/en-core';
import { requirePermission } from '@nullproof-studio/en-core';

export const DocSearchSchema = z.object({
  query: z.string().describe('Search query text.'),
  scope: z.string().optional().describe('Limit search to a specific root (e.g. "agents"), subfolder (e.g. "localllm/spec"), or single file (e.g. "localllm/spec/SPEC-AUTHOR-AGENT.md"). Omit to search all roots.'),
  section_filter: z.string().optional().describe('Filter results to sections matching this heading text or path pattern.'),
  search_type: z.enum(['fulltext', 'semantic', 'hybrid']).default('fulltext').describe('Search mode: "fulltext" (default) for keyword matching, "semantic" for meaning-based search, "hybrid" for both.'),
  max_results: z.number().int().positive().default(10).describe('Maximum number of results to return (default: 10).'),
  include_context: z.boolean().default(true).describe('When true (default), includes surrounding text context with each result.'),
});

export async function handleDocSearch(
  args: z.infer<typeof DocSearchSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'search', args.scope ?? '**');

  const results = searchDocuments(ctx.db, args.query, {
    scope: args.scope,
    section_filter: args.section_filter,
    max_results: args.max_results,
    include_context: args.include_context,
  });

  return { results };
}
