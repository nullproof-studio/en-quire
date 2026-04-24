// Copyright (c) 2026 Nullproof Studio. MIT License — see LICENSE
import { describe, it, expect } from 'vitest';
import { buildCommitMessage, buildProposalBranch, parseProposalBranch } from '@nullproof-studio/en-core';
import { ValidationError } from '@nullproof-studio/en-core';

describe('buildCommitMessage', () => {
  it('builds a structured commit message', () => {
    const msg = buildCommitMessage({
      operation: 'Replace section',
      target: '2.7 Checks',
      file: 'sops/deployment.md',
      caller: 'michelle',
      mode: 'write',
    });

    expect(msg).toContain('[en-quire] Replace section "2.7 Checks" in sops/deployment.md');
    expect(msg).toContain('Caller: michelle');
    expect(msg).toContain('Operation: Replace section');
    expect(msg).toContain('Mode: write');
  });

  it('includes user message when provided', () => {
    const msg = buildCommitMessage({
      operation: 'Append',
      target: 'Overview',
      file: 'docs/readme.md',
      caller: 'bot',
      mode: 'propose',
      userMessage: 'Added new requirement',
    });

    expect(msg).toContain('Message: Added new requirement');
    expect(msg).toContain('Mode: propose');
  });
});

describe('buildProposalBranch', () => {
  it('encodes paths with literal / separators (git allows them in branch names)', () => {
    const branch = buildProposalBranch('michelle', 'skills/triage-agent.md');
    expect(branch).toMatch(/^propose\/michelle\/skills\/triage-agent\.md\/\d{8}T\d{6}Z$/);
  });

  it('works for plain-text extensions too', () => {
    const branch = buildProposalBranch('bot', 'notes/todo.txt');
    expect(branch).toMatch(/^propose\/bot\/notes\/todo\.txt\/\d{8}T\d{6}Z$/);
  });

  it('handles nested paths', () => {
    const branch = buildProposalBranch('alice', 'docs/sops/deploy.md');
    expect(branch).toMatch(/^propose\/alice\/docs\/sops\/deploy\.md\/\d{8}T\d{6}Z$/);
  });
});

describe('parseProposalBranch', () => {
  it('round-trips a simple path', () => {
    const branch = buildProposalBranch('michelle', 'skills/triage.md');
    const parsed = parseProposalBranch(branch, 'notes');
    expect(parsed.caller).toBe('michelle');
    expect(parsed.file).toBe('notes/skills/triage.md');
  });

  it('round-trips a path that contains hyphens (the case the old - encoding corrupted)', () => {
    const branch = buildProposalBranch('michelle', 'skills/triage-agent.md');
    const parsed = parseProposalBranch(branch, 'notes');
    expect(parsed.caller).toBe('michelle');
    expect(parsed.file).toBe('notes/skills/triage-agent.md');
  });

  it('round-trips nested paths', () => {
    const branch = buildProposalBranch('alice', 'docs/sops/rollback-plan.md');
    const parsed = parseProposalBranch(branch, 'root');
    expect(parsed.file).toBe('root/docs/sops/rollback-plan.md');
  });

  it('round-trips plain-text paths with hyphens', () => {
    const branch = buildProposalBranch('bot', 'notes/to-do-list.txt');
    const parsed = parseProposalBranch(branch, 'scratch');
    expect(parsed.file).toBe('scratch/notes/to-do-list.txt');
  });

  it('extracts a well-formed ISO-compact timestamp', () => {
    const branch = buildProposalBranch('m', 'a.md');
    const parsed = parseProposalBranch(branch, 'r');
    expect(parsed.timestamp).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('rejects malformed branch names', () => {
    expect(() => parseProposalBranch('not-a-proposal-branch', 'root'))
      .toThrow(ValidationError);
    expect(() => parseProposalBranch('propose/caller/no-timestamp', 'root'))
      .toThrow(ValidationError);
  });
});
