// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ToolContext } from '../context.js';
import { safePath, writeDocument } from '../../shared/file-utils.js';
import { parseMarkdown } from '../../document/parser.js';
import { buildSectionTree } from '../../document/section-tree.js';
import { indexDocument } from '../../search/indexer.js';
import { buildCommitMessage, buildProposalBranch } from '../../git/commit-message.js';
import { requirePermission, resolveWriteMode } from '../../rbac/permissions.js';
import { GitRequiredError, ValidationError } from '../../shared/errors.js';

export const DocCreateSchema = z.object({
  file: z.string(),
  content: z.string(),
  mode: z.enum(['write', 'propose']).optional(),
  message: z.string().optional(),
});

export async function handleDocCreate(
  args: z.infer<typeof DocCreateSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);
  const mode = resolveWriteMode(ctx.caller, args.file, args.mode);

  if (mode === 'propose' && !ctx.git?.available) {
    throw new GitRequiredError('Proposal workflows');
  }

  const absolutePath = safePath(ctx.documentRoot, args.file);
  if (existsSync(absolutePath)) {
    throw new ValidationError(`File already exists: ${args.file}. Use doc_replace_section or doc_find_replace to modify existing files.`);
  }

  // Ensure directory exists
  const dir = dirname(absolutePath);
  mkdirSync(dir, { recursive: true });

  let branch: string | undefined;
  const originalBranch = ctx.git?.available ? await ctx.git.getCurrentBranch() : undefined;

  try {
    if (mode === 'propose' && ctx.git?.available) {
      branch = buildProposalBranch(ctx.caller.id, args.file);
      await ctx.git.createBranch(branch);
    }

    writeDocument(ctx.documentRoot, args.file, args.content);

    let commit: string | undefined;
    if (ctx.git?.available) {
      const commitMsg = buildCommitMessage({
        operation: 'Create document',
        target: args.file,
        file: args.file,
        caller: ctx.caller.id,
        mode,
        userMessage: args.message,
      });
      commit = await ctx.git.commitFile(args.file, commitMsg);
    }

    // Index the new document
    try {
      const ast = parseMarkdown(args.content);
      const tree = buildSectionTree(ast, args.content);
      indexDocument(ctx.db, args.file, tree, args.content);
    } catch {
      // Non-fatal
    }

    return { success: true, file: args.file, mode, branch, commit };
  } finally {
    if (mode === 'propose' && originalBranch && ctx.git?.available) {
      await ctx.git.switchBranch(originalBranch);
    }
  }
}
