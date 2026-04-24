// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { getProductName } from '../shared/logger.js';
import { ValidationError } from '../shared/errors.js';

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
 * Format: propose/{caller}/{document-path}/{timestamp}
 *
 * Path separators are kept as literal `/` — git allows arbitrary slashes
 * in branch names, and a lossless encoding means the branch → path
 * round-trip works for any file name, including paths that already
 * contain hyphens (e.g. `skills/triage-agent.md`). The timestamp segment
 * is a fixed-length ISO-compact form (YYYYMMDDTHHMMSSZ) that serves as
 * the parse anchor — everything between the caller and the timestamp
 * is the file path.
 */
export function buildProposalBranch(caller: string, filePath: string): string {
  const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

  return `propose/${caller}/${filePath}/${timestamp}`;
}

export interface ParsedCommitMetadata {
  operation: string;
  target: string;
  caller: string;
  mode: 'write' | 'propose';
  userMessage?: string;
}

/**
 * Parse the structured metadata block that `buildCommitMessage` emits.
 * Returns null if any required field is missing — proposal branches are
 * expected to carry this block on their tip commit, so a null return is a
 * signal that either the commit predates the metadata convention or the
 * commit wasn't produced by en-quire/en-scribe. User messages that span
 * multiple lines will have only their first line captured — the metadata
 * grammar is line-oriented by design.
 *
 * Implemented as a line-by-line scan rather than per-field regex to avoid
 * polynomial backtracking on pathological whitespace input (flagged by
 * CodeQL on an earlier regex-based version).
 */
export function parseCommitMessage(raw: string): ParsedCommitMetadata | null {
  let caller: string | undefined;
  let operation: string | undefined;
  let target: string | undefined;
  let mode: string | undefined;
  let userMessage: string | undefined;

  for (const line of raw.split('\n')) {
    // Simple `Field: value` recogniser. trim() on the value is linear,
    // startsWith() on the prefix is linear, no backtracking.
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    if (value === '') continue;

    switch (name) {
      case 'Caller': caller ??= value; break;
      case 'Operation': operation ??= value; break;
      case 'Target': target ??= value; break;
      case 'Mode':
        if (value === 'write' || value === 'propose') mode ??= value;
        break;
      case 'Message': userMessage ??= value; break;
    }
  }

  if (!caller || !operation || !target || !mode) return null;

  return {
    operation,
    target,
    caller,
    mode: mode as 'write' | 'propose',
    ...(userMessage && { userMessage }),
  };
}

const PROPOSAL_BRANCH_RE = /^propose\/([^/]+)\/(.+)\/(\d{8}T\d{6}Z)$/;

/**
 * Parse a proposal branch name back into its parts.
 * The timestamp's fixed format anchors the parse: caller is the first
 * segment, timestamp is the last, and the file path is whatever sits
 * between. Passing a branch name not produced by `buildProposalBranch`
 * throws `ValidationError`.
 */
export function parseProposalBranch(
  branch: string,
  root: string,
): { caller: string; file: string; timestamp: string } {
  const match = branch.match(PROPOSAL_BRANCH_RE);
  if (!match) {
    throw new ValidationError(`Malformed proposal branch name: ${branch}`);
  }
  const [, caller, filePath, timestamp] = match;
  return { caller, file: `${root}/${filePath}`, timestamp };
}
