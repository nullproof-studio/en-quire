// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { getProductName } from '../shared/logger.js';

export interface CommitMessageParams {
  operation: string;
  target: string;
  file: string;
  caller: string;
  mode: 'write' | 'propose';
  userMessage?: string;
}

/**
 * Build a structured commit message per the spec format. The leading tag
 * is the active product name (en-quire or en-scribe), set by whichever
 * bin is running, so git history records which binary produced each commit.
 */
export function buildCommitMessage(params: CommitMessageParams): string {
  const { operation, target, file, caller, mode, userMessage } = params;

  const summary = `[${getProductName()}] ${operation} "${target}" in ${file}`;
  const metadata = [
    `Caller: ${caller}`,
    `Operation: ${operation}`,
    `Target: ${target}`,
    `Mode: ${mode}`,
  ];

  if (userMessage) {
    metadata.push(`Message: ${userMessage}`);
  }

  return `${summary}\n\n${metadata.join('\n')}`;
}

/**
 * Build a branch name for a proposal.
 * Format: propose/{caller}/{document-path-with-extension}/{timestamp}
 *
 * The file extension is preserved in the branch name so that extension-
 * agnostic consumers (en-quire for md/yaml, en-scribe for plain text)
 * can reconstruct the exact file path without having to guess which
 * suffix the proposal operates on.
 */
export function buildProposalBranch(caller: string, filePath: string): string {
  const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

  const sanitisedPath = filePath.replace(/\//g, '-');

  return `propose/${caller}/${sanitisedPath}/${timestamp}`;
}
