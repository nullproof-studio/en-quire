// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from '../context.js';
import { searchDocuments } from '../../search/query.js';
import { requirePermission } from '../../rbac/permissions.js';

export const DocSearchSchema = z.object({
  query: z.string(),
  scope: z.string().optional(),
  section_filter: z.string().optional(),
  search_type: z.enum(['fulltext', 'semantic', 'hybrid']).default('fulltext'),
  max_results: z.number().int().positive().default(10),
  include_context: z.boolean().default(true),
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
