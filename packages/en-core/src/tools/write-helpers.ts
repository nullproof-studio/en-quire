// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import type { ToolContext } from './context.js';
import type { EncodingInfo } from '../shared/types.js';
import { writeDocument, readDocument } from '../shared/file-utils.js';
import { parserRegistry } from '../document/parser-registry.js';
import type { DocumentParser } from '../document/parser-registry.js';
import { indexDocument } from '../search/indexer.js';
import { buildCommitMessage, buildProposalBranch } from '../git/commit-message.js';
import { runPostProposeHooks } from '../git/post-propose.js';
import { generateDiff } from '../shared/diff.js';
import { resolveWriteMode } from '../rbac/permissions.js';
import { GitRequiredError, ValidationError } from '../shared/errors.js';
import { resolveFilePath } from '../config/roots.js';
import { computeEtag, validateEtag } from '../shared/etag.js';
import { getLogger } from '../shared/logger.js';
export interface WriteOperationParams {
  file: string;
  operation: string;
  target: string;
  mode?: 'write' | 'propose';
  message?: string;
  if_match?: string;
}

export interface WriteOperationResult {
  success: boolean;
  file: string;
  mode: 'write' | 'propose';
  branch?: string;
  commit?: string;
  diff?: string;
  warnings?: string[];
  etag?: string;
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
  const logger = getLogger();
  const start = performance.now();
  logger.info('write:start', { operation: params.operation, file: params.file, target: params.target });

  // ETag validation — must happen before any side effects
  const currentEtag = computeEtag(oldContent);
  validateEtag(params.if_match, currentEtag, params.file, ctx.config.require_read_before_write);
  logger.debug('write:etag-validated', { file: params.file });

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
  logger.debug('write:content-validated', { file: params.file, warningCount: warnings.length });

  try {
    // Create proposal branch if needed
    if (mode === 'propose' && git?.available) {
      branch = buildProposalBranch(ctx.caller.id, params.file);
      await git.createBranch(branch);
      logger.debug('write:branch-created', { file: params.file, branch });
    }

    // Write the file
    writeDocument(resolved.root.path, resolved.relativePath, newContent, encoding.lineEnding);
    logger.debug('write:file-written', { file: params.file });

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
      logger.debug('write:git-committed', { file: params.file, commit });

      if (mode === 'propose' && branch) {
        warnings.push(...await runPostProposeHooks(
          git,
          { branch, file: params.file, caller: ctx.caller.id },
          logger,
        ));
      }
    }

    // Update search index (use prefixed path for index key)
    try {
      const parser = parserRegistry.getParser(resolved.relativePath);
      const tree = parser.parse(newContent);
      indexDocument(ctx.db, resolved.prefixedPath, tree, newContent);
      logger.debug('write:index-updated', { file: params.file });
    } catch (indexErr) {
      // Index update failure is non-fatal
      logger.warn('write:index-failed', { file: params.file, error: String(indexErr) });
    }

    // Generate diff
    const diff = generateDiff(params.file, oldContent, newContent);

    const durationMs = Math.round(performance.now() - start);
    const newEtag = computeEtag(newContent);
    logger.info('write:complete', { file: params.file, mode, durationMs });
    return {
      success: true, file: params.file, mode, branch, commit, diff, etag: newEtag,
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
  const etag = computeEtag(content);
  return { content, encoding, tree, parser, etag };
}
