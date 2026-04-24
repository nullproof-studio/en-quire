// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { unlinkSync, existsSync } from 'node:fs';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  safePath,
  readDocument,
  computeEtag,
  validateEtag,
  removeFromIndex,
  buildCommitMessage,
  buildProposalBranch,
  requirePermission,
  resolveWriteMode,
  NotFoundError,
  GitRequiredError,
  resolveFilePath,
} from '@nullproof-studio/en-core';

export const TextDeleteSchema = z.object({
  file: z.string().describe('File path to delete (e.g. "root/file.txt").'),
  if_match: z.string().optional().describe('ETag from a prior read. Required when require_read_before_write is enabled.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleTextDelete(
  args: z.infer<typeof TextDeleteSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'write', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const rootCtx = ctx.roots[resolved.rootName];
  const git = rootCtx?.git;
  const mode = resolveWriteMode(ctx.caller, args.file, args.mode);

  if (mode === 'propose' && !git?.available) {
    throw new GitRequiredError('Proposal workflows');
  }

  const absolutePath = safePath(resolved.root.path, resolved.relativePath);
  if (!existsSync(absolutePath)) {
    throw new NotFoundError('file', args.file);
  }

  const { content } = readDocument(resolved.root.path, resolved.relativePath);
  const currentEtag = computeEtag(content);
  validateEtag(args.if_match, currentEtag, args.file, ctx.config.require_read_before_write);

  let branch: string | undefined;
  const originalBranch = git?.available ? await git.getCurrentBranch() : undefined;

  try {
    if (mode === 'propose' && git?.available) {
      branch = buildProposalBranch(ctx.caller.id, args.file);
      await git.createBranch(branch);
    }

    unlinkSync(absolutePath);

    let commit: string | undefined;
    const pushWarnings: string[] = [];
    if (git?.available) {
      const commitMsg = buildCommitMessage({
        operation: 'Delete text file',
        target: args.file,
        file: args.file,
        caller: ctx.caller.id,
        mode,
        userMessage: args.message,
      });
      commit = await git.commitFile(resolved.relativePath, commitMsg);

      if (mode === 'propose' && branch) {
        const pushResult = await git.pushProposalBranch(branch);
        if (pushResult.warning) pushWarnings.push(pushResult.warning);
      }
    }

    removeFromIndex(ctx.db, resolved.prefixedPath);

    return {
      success: true,
      file: args.file,
      mode,
      branch,
      commit,
      ...(pushWarnings.length > 0 && { warnings: pushWarnings }),
    };
  } finally {
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}
