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
 */
export function parseCommitMessage(raw: string): ParsedCommitMetadata | null {
  const caller = /^Caller:\s*(.+?)\s*$/m.exec(raw)?.[1];
  const operation = /^Operation:\s*(.+?)\s*$/m.exec(raw)?.[1];
  const target = /^Target:\s*(.+?)\s*$/m.exec(raw)?.[1];
  const mode = /^Mode:\s*(write|propose)\s*$/m.exec(raw)?.[1];
  if (!caller || !operation || !target || !mode) return null;

  const userMessage = /^Message:\s*(.+?)\s*$/m.exec(raw)?.[1];

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
