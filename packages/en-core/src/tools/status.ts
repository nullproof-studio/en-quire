// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import type { ToolContext } from './context.js';
import { listDocumentFiles } from '../shared/file-utils.js';
import { getIndexedCount, getIndexedFiles } from '../search/indexer.js';
import { requirePermission } from '../rbac/permissions.js';
import { resolveScope } from '../config/roots.js';
import { parserRegistry } from '../document/parser-registry.js';

export const StatusSchema = z.object({
  scope: z.string().optional().describe('Limit to a specific root or path prefix. Omit to check status across all roots.'),
});

/**
 * Format-agnostic status handler.
 *
 * Reports:
 * - Active roots (name, description, git_active)
 * - Modified files across git-enabled roots
 * - Pending proposals (branch count)
 * - Indexed file count + list of unindexed files
 *
 * "Which files count" is driven by `parserRegistry.supportedExtensions()`,
 * so each MCP binary surfaces only the files its parsers claim — en-quire
 * shows md/yaml, en-scribe shows plain-text extensions. A single shared
 * handler without extension hardcoding.
 */
export async function handleStatus(
  args: z.infer<typeof StatusSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.scope ?? '**');

  const { rootName, scopeWithinRoot } = resolveScope(ctx.config.document_roots, args.scope);

  const rootsToCheck = rootName
    ? { [rootName]: ctx.config.document_roots[rootName] }
    : ctx.config.document_roots;

  const extensions = parserRegistry.supportedExtensions();

  const allFiles: string[] = [];
  for (const [name, root] of Object.entries(rootsToCheck)) {
    const files = listDocumentFiles(root.path, scopeWithinRoot, extensions);
    for (const file of files) {
      allFiles.push(`${name}/${file}`);
    }
  }

  const indexed = getIndexedCount(ctx.db);

  const modified: string[] = [];
  let pendingProposals = 0;

  for (const [name, rootCtx] of Object.entries(ctx.roots)) {
    if (rootName && name !== rootName) continue;
    const git = rootCtx.git;
    if (!git?.available) continue;

    try {
      const rootModified = await git.getModifiedFiles();
      modified.push(...rootModified.map((f) => `${name}/${f}`));
    } catch {
      // Non-fatal
    }

    try {
      const branches = await git.listBranches('propose/');
      pendingProposals += branches.length;
    } catch {
      // Non-fatal
    }
  }

  const indexedFileSet = new Set(getIndexedFiles(ctx.db));
  const unindexed = allFiles.filter((f) => !indexedFileSet.has(f));

  const rootStatus = Object.entries(ctx.roots).map(([name, rootCtx]) => ({
    name,
    description: ctx.config.document_roots[name]?.description,
    git_active: rootCtx.git?.available ?? false,
  }));

  return {
    roots: rootStatus,
    modified,
    pending_proposals: pendingProposals,
    indexed,
    unindexed,
  };
}
