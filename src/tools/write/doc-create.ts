// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { z } from 'zod';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { ToolContext } from '../context.js';
import { safePath, writeDocument } from '../../shared/file-utils.js';
import { parserRegistry } from '../../document/parser-registry.js';
import { indexDocument } from '../../search/indexer.js';
import { buildCommitMessage, buildProposalBranch } from '../../git/commit-message.js';
import { requirePermission, resolveWriteMode } from '../../rbac/permissions.js';
import { GitRequiredError, ValidationError } from '../../shared/errors.js';
import { resolveFilePath } from '../../config/roots.js';

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
      success: true, file: args.file, mode, branch, commit,
      ...(createWarnings.length > 0 && { warnings: createWarnings }),
    };
  } finally {
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}
