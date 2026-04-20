// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ToolContext } from '@nullproof-studio/en-core';
import { safePath, writeDocument } from '@nullproof-studio/en-core';
import { computeEtag } from '@nullproof-studio/en-core';
import { parserRegistry } from '@nullproof-studio/en-core';
import { indexDocument } from '@nullproof-studio/en-core';
import { buildCommitMessage, buildProposalBranch } from '@nullproof-studio/en-core';
import { requirePermission, resolveWriteMode } from '@nullproof-studio/en-core';
import { GitRequiredError, ValidationError } from '@nullproof-studio/en-core';
import { resolveFilePath } from '@nullproof-studio/en-core';

export const DocCreateSchema = z.object({
  file: z.string().describe('Document path (e.g. "root/path/to/file.md"). Must not already exist — use doc_replace_section or doc_find_replace to modify existing files.'),
  content: z.string().describe('Full document content including headings. For markdown, start with a top-level heading (e.g. "# Title"). Structure is validated before writing.'),
  mode: z.enum(['write', 'propose']).optional().describe('Write mode: "write" applies immediately, "propose" creates a git branch for review.'),
  message: z.string().optional().describe('Commit message describing the change.'),
});

export async function handleDocCreate(
  args: z.infer<typeof DocCreateSchema>,
  ctx: ToolContext,
) {
  requirePermission(ctx.caller, 'read', args.file);

  const resolved = resolveFilePath(ctx.config.document_roots, args.file);
  const rootCtx = ctx.roots[resolved.rootName];
  const git = rootCtx?.git;
  const mode = resolveWriteMode(ctx.caller, args.file, args.mode);

  if (mode === 'propose' && !git?.available) {
    throw new GitRequiredError('Proposal workflows');
  }

  const absolutePath = safePath(resolved.root.path, resolved.relativePath);
  if (existsSync(absolutePath)) {
    throw new ValidationError(`File already exists: ${args.file}. Use doc_replace_section or doc_find_replace to modify existing files.`);
  }

  // Ensure directory exists
  const dir = dirname(absolutePath);
  mkdirSync(dir, { recursive: true });

  let branch: string | undefined;
  const originalBranch = git?.available ? await git.getCurrentBranch() : undefined;

  try {
    if (mode === 'propose' && git?.available) {
      branch = buildProposalBranch(ctx.caller.id, args.file);
      await git.createBranch(branch);
    }

    // Validate content before writing
    const parser = parserRegistry.getParser(resolved.relativePath);
    const createWarnings = parser.validate(args.content);
    const hasErrors = createWarnings.some((w) =>
      w.includes('syntax error') || w.includes('parse error') || w.includes('Duplicate sibling'));
    if (hasErrors) {
      throw new ValidationError(
        `Write blocked — content has structural issues:\n${createWarnings.join('\n')}`,
      );
    }

    writeDocument(resolved.root.path, resolved.relativePath, args.content);

    let commit: string | undefined;
    if (git?.available) {
      const commitMsg = buildCommitMessage({
        operation: 'Create document',
        target: args.file,
        file: args.file,
        caller: ctx.caller.id,
        mode,
        userMessage: args.message,
      });
      commit = await git.commitFile(resolved.relativePath, commitMsg);
    }

    // Index the new document (use prefixed path)
    try {
      const parser = parserRegistry.getParser(resolved.relativePath);
      const tree = parser.parse(args.content);
      indexDocument(ctx.db, resolved.prefixedPath, tree, args.content);
    } catch {
      // Non-fatal
    }

    return {
      success: true, file: args.file, mode, branch, commit, etag: computeEtag(args.content),
      ...(createWarnings.length > 0 && { warnings: createWarnings }),
    };
  } finally {
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}
