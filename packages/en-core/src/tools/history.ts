// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { requirePermission } from '../rbac/permissions.js';
import { resolveFilePath } from '../config/roots.js';
import { readDocument } from '../shared/file-utils.js';
import { parserRegistry } from '../document/parser-registry.js';
import { resolveSingleSection } from '../document/section-address.js';
import { AddressResolutionError } from '../shared/errors.js';
import { GitRequiredError } from '../shared/errors.js';

/**
 * Section-level commit history for a file. Resolves the section's line
 * range via the existing section model, then runs `git log -L` over that
 * range to return the commits that touched it. No new tables — pure git
 * surfacing on top of the section tree.
 *
 * When `section` is omitted, returns the recent history of the whole
 * file via the same mechanism (line range = full file).
 */

export interface HistoryEntry {
  sha: string;
  date: string;
  author: string;
  subject: string;
}

export const HistorySchema = z.object({
  file: z.string().describe('Root-prefixed path of the file (e.g. "docs/sops/runbook.md").'),
  section: z.string().optional().describe(
    'Section address — heading text or path. Omit for whole-file history.',
  ),
  limit: z.number().int().positive().max(200).default(20).describe(
    'Maximum number of commits to return (default 20, max 200). Newest first.',
  ),
});

export async function handleHistory(
  args: z.infer<typeof HistorySchema>,
  ctx: ToolContext,
): Promise<{ history: HistoryEntry[] }> {
  requirePermission(ctx.caller, 'read', args.file);

  const limit = args.limit ?? 20;

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const rootCtx = ctx.roots[resolved.root.name];
  const git = rootCtx?.git;
  if (!git?.available) {
    throw new GitRequiredError(`section history (root "${resolved.root.name}" has no git)`);
  }

  let lineStart = 1;
  let lineEnd: number;

  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  if (args.section !== undefined) {
    const parser = parserRegistry.getParser(resolved.relativePath);
    const tree = parser.parse(content);
    const address = parser.parseAddress(args.section);
    let node;
    try {
      node = resolveSingleSection(tree, address);
    } catch (err) {
      // The section may exist in older commits that the current parse
      // can't see. Surface that as an empty history rather than the
      // hard "section not found" error so agents can still query
      // historical sections by name.
      if (err instanceof AddressResolutionError) return { history: [] };
      throw err;
    }
    lineStart = node.heading.position?.start.line ?? 1;
    const upTo = content.slice(0, node.sectionEndOffset);
    lineEnd = upTo.split('\n').length;
  } else {
    lineEnd = content.split('\n').length;
  }

  const entries = await git.getLineHistory(resolved.relativePath, lineStart, lineEnd, limit);
  return { history: entries };
}
