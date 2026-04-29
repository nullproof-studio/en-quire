// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ToolContext } from '@nullproof-studio/en-core';
import {
  safePath,
  writeDocument,
  computeEtag,
  parserRegistry,
  indexDocument,
  buildCommitMessage,
  buildProposalBranch,
  runPostProposeHooks,
  getLogger,
  requirePermission,
  resolveWriteMode,
  GitRequiredError,
  ValidationError,
  resolveFilePath,
} from '@nullproof-studio/en-core';

export const TextCreateSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.txt"). Must not already exist — use text_replace_range or text_edit to modify existing files.'),
  content: z.string().describe('Full file content. Typically ends with "\\n".'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleTextCreate(
  args: z.infer<typeof TextCreateSchema>,
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
  if (existsSync(absolutePath)) {
    throw new ValidationError(
      `File already exists: ${args.file}. Use text_replace_range or text_edit to modify existing files.`,
    );
  }

  mkdirSync(dirname(absolutePath), { recursive: true });

  let branch: string | undefined;
  const originalBranch = git?.available ? await git.getCurrentBranch() : undefined;

  try {
    if (mode === 'propose' && git?.available) {
      branch = buildProposalBranch(ctx.caller.id, args.file);
      await git.createBranch(branch);
    }

    writeDocument(resolved.root.path, resolved.relativePath, args.content);

    let commit: string | undefined;
    const pushWarnings: string[] = [];
    if (git?.available) {
      const commitMsg = buildCommitMessage({
        operation: 'Create text file',
        target: args.file,
        file: args.file,
        caller: ctx.caller.id,
        mode,
        userMessage: args.message,
      });
      commit = await git.commitFile(resolved.relativePath, commitMsg);

      if (mode === 'propose' && branch) {
        pushWarnings.push(...await runPostProposeHooks(
          git,
          { branch, file: args.file, caller: ctx.caller.id },
          getLogger(),
        ));
      }
    }

    try {
      const parser = parserRegistry.getParser(resolved.relativePath);
      const tree = parser.parse(args.content);
      indexDocument(ctx.db, resolved.prefixedPath, tree, args.content);
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      file: args.file,
      mode,
      branch,
      commit,
      etag: computeEtag(args.content),
      ...(pushWarnings.length > 0 && { warnings: pushWarnings }),
    };
  } finally {
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}
