// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE

export interface CommitMessageParams {
  operation: string;
  target: string;
  file: string;
  caller: string;
  mode: 'write' | 'propose';
  userMessage?: string;
}

/**
 * Build a structured commit message per the en-quire spec format.
 */
export function buildCommitMessage(params: CommitMessageParams): string {
  const { operation, target, file, caller, mode, userMessage } = params;

  const summary = `[en-quire] ${operation} "${target}" in ${file}`;
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
