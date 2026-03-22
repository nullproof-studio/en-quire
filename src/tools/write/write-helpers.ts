// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from '../context.js';
import type { EncodingInfo } from '../../shared/types.js';
import { writeDocument, readDocument } from '../../shared/file-utils.js';
import { parserRegistry } from '../../document/parser-registry.js';
import type { DocumentParser } from '../../document/parser-registry.js';
import { indexDocument } from '../../search/indexer.js';
import { buildCommitMessage, buildProposalBranch } from '../../git/commit-message.js';
import { generateDiff } from '../../shared/diff.js';
import { resolveWriteMode } from '../../rbac/permissions.js';
import { GitRequiredError, ValidationError } from '../../shared/errors.js';
import { resolveFilePath } from '../../config/roots.js';

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
  warnings?: string[];
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
  const resolved = resolveFilePath(ctx.config.document_roots, params.file);
  const rootCtx = ctx.roots[resolved.rootName];
  const git = rootCtx?.git;
  const mode = resolveWriteMode(ctx.caller, params.file, params.mode);

  if (mode === 'propose' && !git?.available) {
    throw new GitRequiredError('Proposal workflows');
  }

  let branch: string | undefined;
  const originalBranch = git?.available ? await git.getCurrentBranch() : undefined;

  // Validate output before writing
  const parser = parserRegistry.getParser(resolved.relativePath);
  const warnings = parser.validate(newContent);
  const hasErrors = warnings.some((w) =>
    w.includes('syntax error') || w.includes('parse error') || w.includes('Duplicate sibling'));
  if (hasErrors) {
    throw new ValidationError(
      `Write blocked — output has structural issues:\n${warnings.join('\n')}`,
    );
  }

  try {
    // Create proposal branch if needed
    if (mode === 'propose' && git?.available) {
      branch = buildProposalBranch(ctx.caller.id, params.file);
      await git.createBranch(branch);
    }

    // Write the file
    writeDocument(resolved.root.path, resolved.relativePath, newContent, encoding.lineEnding);

    // Git commit
    let commit: string | undefined;
    if (git?.available) {
      const commitMsg = buildCommitMessage({
        operation: params.operation,
        target: params.target,
        file: params.file,
        caller: ctx.caller.id,
        mode,
        userMessage: params.message,
      });
      commit = await git.commitFile(resolved.relativePath, commitMsg);
    }

    // Update search index (use prefixed path for index key)
    try {
      const parser = parserRegistry.getParser(resolved.relativePath);
      const tree = parser.parse(newContent);
      indexDocument(ctx.db, resolved.prefixedPath, tree, newContent);
    } catch {
      // Index update failure is non-fatal
    }

    // Generate diff
    const diff = generateDiff(params.file, oldContent, newContent);

    return {
      success: true, file: params.file, mode, branch, commit, diff,
      ...(warnings.length > 0 && { warnings }),
    };
  } finally {
    // Switch back to original branch after proposal
    if (mode === 'propose' && originalBranch && git?.available) {
      await git.switchBranch(originalBranch);
    }
  }
}

/**
 * Load a document's content, section tree, and parser.
 */
export function loadDocument(ctx: ToolContext, file: string) {
  const resolved = resolveFilePath(ctx.config.document_roots, file);
  const { content, encoding } = readDocument(resolved.root.path, resolved.relativePath);
  const parser = parserRegistry.getParser(resolved.relativePath);
  const tree = parser.parse(content);
  return { content, encoding, tree, parser };
}
