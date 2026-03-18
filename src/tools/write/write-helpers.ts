// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '../context.js';
import type { EncodingInfo } from '../../shared/types.js';
import { writeDocument, readDocument } from '../../shared/file-utils.js';
import { parseMarkdown } from '../../document/parser.js';
import { buildSectionTree } from '../../document/section-tree.js';
import { indexDocument } from '../../search/indexer.js';
import { buildCommitMessage, buildProposalBranch } from '../../git/commit-message.js';
import { generateDiff } from '../../shared/diff.js';
import { resolveWriteMode } from '../../rbac/permissions.js';
import { GitRequiredError } from '../../shared/errors.js';

export interface WriteOperationParams {
  file: string;
  operation: string;
  target: string;
  mode?: 'write' | 'propose';
  message?: string;
}

export interface WriteOperationResult {
  success: boolean;
  file: string;
  mode: 'write' | 'propose';
  branch?: string;
  commit?: string;
  diff?: string;
}

/**
 * Execute a write operation with git commit and index update.
 *
 * Handles:
 * 1. Mode resolution (write vs propose)
 * 2. Branch management for proposals
 * 3. File writing
 * 4. Git commit
 * 5. Search index update
 * 6. Diff generation
 */
export async function executeWrite(
  ctx: ToolContext,
  params: WriteOperationParams,
  oldContent: string,
  newContent: string,
  encoding: EncodingInfo,
): Promise<WriteOperationResult> {
  const mode = resolveWriteMode(ctx.caller, params.file, params.mode);

  if (mode === 'propose' && !ctx.git?.available) {
    throw new GitRequiredError('Proposal workflows');
  }

  let branch: string | undefined;
  const originalBranch = ctx.git?.available ? await ctx.git.getCurrentBranch() : undefined;

  try {
    // Create proposal branch if needed
    if (mode === 'propose' && ctx.git?.available) {
      branch = buildProposalBranch(ctx.caller.id, params.file);
      await ctx.git.createBranch(branch);
    }

    // Write the file
    writeDocument(ctx.documentRoot, params.file, newContent, encoding.lineEnding);

    // Git commit
    let commit: string | undefined;
    if (ctx.git?.available) {
      const commitMsg = buildCommitMessage({
        operation: params.operation,
        target: params.target,
        file: params.file,
        caller: ctx.caller.id,
        mode,
        userMessage: params.message,
      });
      commit = await ctx.git.commitFile(params.file, commitMsg);
    }

    // Update search index
    try {
      const ast = parseMarkdown(newContent);
      const tree = buildSectionTree(ast, newContent);
      indexDocument(ctx.db, params.file, tree, newContent);
    } catch {
      // Index update failure is non-fatal
    }

    // Generate diff
    const diff = generateDiff(params.file, oldContent, newContent);

    return { success: true, file: params.file, mode, branch, commit, diff };
  } finally {
    // Switch back to original branch after proposal
    if (mode === 'propose' && originalBranch && ctx.git?.available) {
      await ctx.git.switchBranch(originalBranch);
    }
  }
}

/**
 * Load a document's content, AST, and section tree.
 */
export function loadDocument(ctx: ToolContext, file: string) {
  const { content, encoding } = readDocument(ctx.documentRoot, file);
  const ast = parseMarkdown(content);
  const tree = buildSectionTree(ast, content);
  return { content, encoding, ast, tree };
}
